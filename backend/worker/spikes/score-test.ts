/**
 * Spike: can JEV score the simulated audience?
 *
 * Scores 50 personas (TM's generator, same groups as onboarding) on the two
 * Remotion test videos, 3 repeats, then runs the module's cascade on the
 * result. Checks: valid output, realistic rates, revised > original, stable
 * across repeats, latency and cost.
 *
 * Run from backend/worker:
 *   npx tsx --env-file=../../.env --tsconfig ../../frontend/tsconfig.app.json spikes/score-test.ts
 */
import { generateAudience } from '../../../frontend/src/data/mock/personas.ts';
import { emptyProfile, suggestedGroups } from '../../../frontend/src/onboarding/suggestAudience.ts';
import type { AudienceMember, CompanyProfile } from '../../../frontend/src/data/types.ts';
import { QUESTIONS, scoreMember, type JevState, type Signal } from '../src/jev.ts';
import { runCascade } from '../../spacetime/spacetimedb/src/sim/cascade.ts';

const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const MEMBERS = 50;
const REPEATS = 3;
const CONCURRENCY = 8;

/**
 * Hand-written stand-ins for the Claude video analysis, which is not built yet.
 * Both describe videos/src/campaigns.json exactly; nothing else differs.
 */
const VIDEOS = {
  original: [
    '18-second vertical Instagram reel. Text-only animation on a plain green background, no people or footage. Robotic text-to-speech voiceover.',
    '0-4s: "The Giving Garden" / voice: "The Giving Garden is a nonprofit farm."',
    '4-9s: "We grow sustainable food" / voice: "We grow sustainable food for our community."',
    '9-14s: "Volunteers needed" / voice: "We are looking for volunteers to help on the farm."',
    '14-18s: "Link in bio" / voice: "Visit the link in our bio to sign up."',
  ].join('\n'),
  revised: [
    '18-second vertical Instagram reel. Text-only animation on a plain green background, no people or footage. Robotic text-to-speech voiceover.',
    `0-4s: "We couldn't harvest it all." / voice: "Last season, we couldn't harvest it all."`,
    '4-9s: "Half the volunteers we needed" / voice: "We had less than half the volunteers we needed."',
    '9-14s: "One morning. Real food. Real people." / voice: "Give us one morning, and help get fresh food to real people."',
    '14-18s: "Sign up: link in bio" / voice: "Sign up at the link in our bio. Bring a friend."',
  ].join('\n'),
} as const;
type VideoKey = keyof typeof VIDEOS;


interface Score {
  memberId: number;
  p: Record<Signal, number>;
  ms: number;
  tokens: number;
}

const groups = suggestedGroups();
const groupById = new Map(groups.map((g) => [g.id, g]));
const profile: CompanyProfile = {
  ...emptyProfile(),
  id: 'spike',
  name: 'The Giving Garden',
  pitch: 'A nonprofit farm growing sustainable food for the community, recruiting volunteers to help harvest and distribute it.',
  groups,
};
const audience = generateAudience(profile, { total: MEMBERS, onIsland: 0 }, 42);

function stateFor(member: AudienceMember, video: VideoKey): JevState {
  const group = groupById.get(member.groupId);
  return {
    person: {
      audience_group: group?.label ?? member.groupId,
      group_description: group?.blurb ?? '',
      interests: member.interests,
      habits: member.persona,
      responds_to: member.hotButtons,
      turned_off_by: member.ignores,
    },
    reel: { account: 'The Giving Garden (small local nonprofit farm)', content: VIDEOS[video] },
  };
}

async function scoreOne(member: AudienceMember, video: VideoKey): Promise<Score> {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new Error('Missing JEV_API_KEY in .env');
  const started = performance.now();
  const { p, inputTokens } = await scoreMember(key, stateFor(member, video));
  return { memberId: member.id, p, ms: performance.now() - started, tokens: inputTokens };
}

async function scoreAll(video: VideoKey): Promise<{ scores: Score[]; failures: string[] }> {
  const scores: Score[] = [];
  const failures: string[] = [];
  let next = 0;
  async function lane() {
    while (next < audience.members.length) {
      const member = audience.members[next++]!;
      try {
        scores.push(await scoreOne(member, video));
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return { scores: scores.sort((a, b) => a.memberId - b.memberId), failures };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const percentile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] ?? 0;

/** Unconditional per-exposure rates, matching how the cascade rolls them. */
function rates(scores: Score[]) {
  return {
    watch: mean(scores.map((s) => s.p.watch)),
    like: mean(scores.map((s) => s.p.watch * s.p.like)),
    comment: mean(scores.map((s) => s.p.watch * s.p.comment)),
    share: mean(scores.map((s) => s.p.watch * s.p.share)),
  };
}

const runs: Record<VideoKey, Score[][]> = { original: [], revised: [] };
let totalTokens = 0;
const allMs: number[] = [];
const started = performance.now();

for (let repeat = 0; repeat < REPEATS; repeat++) {
  for (const video of Object.keys(VIDEOS) as VideoKey[]) {
    const { scores, failures } = await scoreAll(video);
    runs[video].push(scores);
    for (const s of scores) {
      totalTokens += s.tokens;
      allMs.push(s.ms);
    }
    const r = rates(scores);
    console.log(
      `repeat ${repeat + 1} ${video.padEnd(8)} ok=${scores.length}/${MEMBERS} fail=${failures.length}` +
        `  watch ${pct(r.watch)}  like ${pct(r.like)}  comment ${pct(r.comment)}  share ${pct(r.share)}`,
    );
    if (failures.length) console.log(`  first failure: ${failures[0]}`);
  }
}

console.log('\n--- stability: mean |difference| of the same member across repeats');
for (const video of Object.keys(VIDEOS) as VideoKey[]) {
  const [a, ...rest] = runs[video];
  if (!a) continue;
  const drift = (Object.keys(QUESTIONS) as Signal[]).map((signal) => {
    const diffs: number[] = [];
    for (const other of rest) {
      for (const s of a) {
        const match = other.find((o) => o.memberId === s.memberId);
        if (match) diffs.push(Math.abs(match.p[signal] - s.p[signal]));
      }
    }
    return `${signal} ${mean(diffs).toFixed(4)}`;
  });
  console.log(`${video.padEnd(8)} ${drift.join('  ')}`);
}

console.log('\n--- spread across members (repeat 1): min / median / max of P(watch) and P(share | watched)');
for (const video of Object.keys(VIDEOS) as VideoKey[]) {
  const s = runs[video][0] ?? [];
  const w = s.map((x) => x.p.watch);
  const sh = s.map((x) => x.p.share);
  console.log(
    `${video.padEnd(8)} watch ${pct(Math.min(...w))} / ${pct(percentile(w, 0.5))} / ${pct(Math.max(...w))}` +
      `   share|watched ${pct(Math.min(...sh))} / ${pct(percentile(sh, 0.5))} / ${pct(Math.max(...sh))}`,
  );
}

console.log('\n--- by group (repeat 1): P(watch) original -> revised');
for (const group of groups) {
  const ids = new Set(audience.members.filter((m) => m.groupId === group.id).map((m) => m.id));
  const w = (video: VideoKey) => mean((runs[video][0] ?? []).filter((s) => ids.has(s.memberId)).map((s) => s.p.watch));
  console.log(`${group.label.padEnd(22)} n=${ids.size}  ${pct(w('original'))} -> ${pct(w('revised'))}`);
}

console.log('\n--- cascade (module code, seed 42, 10% seeded, 6 rounds, 200 trials) on repeat 1');
for (const video of Object.keys(VIDEOS) as VideoKey[]) {
  const decisions = (runs[video][0] ?? []).map((s) => ({
    memberId: s.memberId,
    pWatch: s.p.watch,
    pLike: s.p.like,
    pComment: s.p.comment,
    pShare: s.p.share,
    missing: false,
  }));
  const { metrics } = runCascade(
    audience.members.map((m) => ({ id: m.id, groupId: m.groupId })),
    audience.edges,
    decisions,
    { seed: 42, seedExposure: 0.1, maxRounds: 6 },
  );
  console.log(
    `${video.padEnd(8)} exposed ${metrics.uniqueExposed}/${MEMBERS}  watch ${metrics.watch}  likes ${metrics.likes}` +
      `  comments ${metrics.comments}  shares ${metrics.shares}  rounds ${metrics.rounds}` +
      `  actions p10/p50/p90 ${metrics.spread.p10}/${metrics.spread.p50}/${metrics.spread.p90}`,
  );
}

const calls = allMs.length;
console.log(
  `\n--- ${calls} calls in ${((performance.now() - started) / 1000).toFixed(1)}s (concurrency ${CONCURRENCY})` +
    `  latency p50 ${percentile(allMs, 0.5).toFixed(0)}ms p90 ${percentile(allMs, 0.9).toFixed(0)}ms` +
    `  tokens/call ${(totalTokens / Math.max(calls, 1)).toFixed(0)}  cost $${(totalTokens * PRICE_PER_INPUT_TOKEN).toFixed(4)}`,
);
