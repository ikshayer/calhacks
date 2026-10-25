import { cacheKey, lookup, store } from '../cache.ts';
import { config } from '../config.ts';
import { calibrate, calibration } from '../calibration.ts';
import { JevAuthError, QUESTIONS, scoreMember, type JevState } from '../jev.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import { reportStage, setStage } from '../stage.ts';
import type { AudienceMember, CompanyProfile, ContentSignals, DecisionInput, Job, Video } from '../module_bindings/types.ts';

/** Decisions are written in chunks so one reducer call stays small. */
const DECISION_BATCH = 50;
/** Members between live progress updates. */
const PROGRESS_EVERY = 25;
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const FAILED_EXPLANATION = 'Scoring failed for this member - no prediction.';

/** The model id jev.ts sends; part of the cache key so a model change is a miss. */
const JEV_MODEL = 'jev-latest';

interface RawScore {
  watch: number;
  like: number;
  comment: number;
  share: number;
}

function validateScoreMap(value: unknown): Record<string, RawScore> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected an object of raw scores');
  const map: Record<string, RawScore> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null) throw new Error(`score ${key} is not an object`);
    const out: RawScore = { watch: 0, like: 0, comment: 0, share: 0 };
    for (const field of ['watch', 'like', 'comment', 'share'] as const) {
      const v: unknown = (entry as Record<string, unknown>)[field];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`score ${key}.${field} is not a probability`);
      out[field] = v;
    }
    map[key] = out;
  }
  return map;
}

const round2 = (x: number) => x.toFixed(2);

function signalsLine(s: ContentSignals): string {
  return (
    `Signals: hookStrength ${round2(s.hookStrength)}, clarityOfAsk ${round2(s.clarityOfAsk)}, ` +
    `pacing ${round2(s.pacing)}, warmth ${round2(s.warmth)} (all 0-1); topics: ${s.topics.join(', ')}; duration ${s.durationSec}s`
  );
}

function stateFor(member: AudienceMember, profile: CompanyProfile, video: Video, signals: ContentSignals): JevState {
  const group = profile.groups.find((g) => g.id === member.groupId);
  return {
    person: {
      audience_group: group?.label ?? member.groupId,
      group_description: group?.blurb ?? '',
      interests: member.interests,
      habits: member.persona,
      responds_to: member.hotButtons,
      turned_off_by: member.ignores,
    },
    reel: {
      account: `${profile.name}: ${profile.pitch}`,
      content: `${video.summary}\n${signalsLine(signals)}`,
    },
  };
}

function missingDecision(memberId: number): DecisionInput {
  return { memberId, pWatch: 0, pLike: 0, pComment: 0, pShare: 0, explanation: FAILED_EXPLANATION, missing: true };
}

/**
 * Runs `work` over `items` with at most `limit` in flight. `work` must not
 * throw; it returns false to stop every lane from taking further items.
 */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<boolean>): Promise<void> {
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped && next < items.length) {
      if (!(await work(items[next++]!))) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export async function scoreRun(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.jevApiKey;
  if (!apiKey) throw new Error('JEV_API_KEY is not set on the worker, so runs cannot be scored.');

  const runId = BigInt(job.targetId);
  const run = conn.db.run.id.find(runId);
  if (!run) throw new Error(`score_run: unknown run ${job.targetId}`);
  const video = conn.db.video.id.find(run.videoId);
  if (!video) throw new Error(`score_run: run ${job.targetId} references unknown video ${run.videoId}`);
  if (video.status !== 'ready' || !video.signals) {
    throw new Error(`score_run: video ${video.id} is ${video.status} and has ${video.signals ? '' : 'no '}signals; it must be analysed first`);
  }
  const profile = conn.db.companyProfile.id.find(run.profileId);
  if (!profile) throw new Error(`score_run: run ${job.targetId} references unknown profile ${run.profileId}`);
  const members = [...conn.db.audienceMember.iter()]
    .filter((m) => m.profileId === run.profileId && m.audienceVersion === run.options.audienceVersion)
    .sort((a, b) => a.memberId - b.memberId);
  if (members.length === 0) {
    throw new Error(`score_run: no audience members for profile ${run.profileId} version ${run.options.audienceVersion}`);
  }

  if (calibration.uncalibrated) {
    console.warn(`[score ${runId}] WARNING: calibration is a placeholder (${calibration.source}); probabilities are raw JEV output`);
  }

  const started = performance.now();
  const signals = video.signals;
  const decisions: DecisionInput[] = [];
  let inputTokens = 0;
  let firstError: string | undefined;
  let authError: JevAuthError | undefined;

  const mapKey = cacheKey([JEV_MODEL, QUESTIONS, video.summary, signalsLine(signals), profile.name, profile.pitch]);
  const scoreMap = (await lookup('jev-scores', mapKey, validateScoreMap)) ?? {};
  const states = new Map(members.map((m) => [m.memberId, stateFor(m, profile, video, signals)]));
  const hashes = new Map([...states].map(([id, state]) => [id, cacheKey(state)]));
  const allCached = members.every((m) => hashes.get(m.memberId)! in scoreMap);
  let cachedCount = 0;
  let scoredCount = 0;

  const scoring = (done: number) => `Scoring ${done}/${members.length} members${allCached ? ' (cached)' : ''}`;
  await setStage(conn, job, scoring(0));
  await pool(members, Math.max(1, config.jevConcurrency), async (member) => {
    try {
      // Fire-and-forget progress after each batch, so the lanes are not slowed.
      if (decisions.length > 0 && decisions.length % PROGRESS_EVERY === 0) reportStage(conn, job, scoring(decisions.length));
      const hash = hashes.get(member.memberId)!;
      const hit = scoreMap[hash];
      let raw: RawScore;
      if (hit) {
        raw = hit;
        cachedCount++;
      } else {
        const scored = await scoreMember(apiKey, states.get(member.memberId)!);
        raw = scored.p;
        scoreMap[hash] = { watch: raw.watch, like: raw.like, comment: raw.comment, share: raw.share };
        inputTokens += scored.inputTokens;
        scoredCount++;
      }
      const p = calibrate(raw);
      // Explanations are written on demand by Claude later; scoring leaves them empty.
      decisions.push({ memberId: member.memberId, pWatch: p.watch, pLike: p.like, pComment: p.comment, pShare: p.share, explanation: '', missing: false });
      return true;
    } catch (error) {
      if (error instanceof JevAuthError) {
        authError ??= error;
        return false;
      }
      firstError ??= error instanceof Error ? error.message : String(error);
      console.error(`[score ${runId}] member ${member.memberId} failed: ${error instanceof Error ? error.message : String(error)}`);
      decisions.push(missingDecision(member.memberId));
      return true;
    }
  });
  // A bad key is not a per-member failure: fail the run with the real cause.
  if (authError) throw authError;
  if (scoredCount > 0) await store('jev-scores', mapKey, scoreMap);

  decisions.sort((a, b) => a.memberId - b.memberId);
  await setStage(conn, job, 'Saving predictions');
  for (let i = 0; i < decisions.length; i += DECISION_BATCH) {
    await conn.reducers.writeDecisions({ runId, decisions: decisions.slice(i, i + DECISION_BATCH) });
  }
  await setStage(conn, job, 'Running the sharing simulation');
  await conn.reducers.runCascadeForRun({ runId });

  const missing = decisions.filter((d) => d.missing).length;
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `[score ${runId}] scored ${decisions.length - missing}/${decisions.length}, missing ${missing}, ${cachedCount} cached / ${scoredCount} scored, ${seconds.toFixed(1)}s, ` +
      `${inputTokens} JEV input tokens, $${(inputTokens * USD_PER_INPUT_TOKEN).toFixed(4)}` +
      (firstError ? `; first failure: ${firstError}` : ''),
  );
}
