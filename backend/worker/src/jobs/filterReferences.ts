import { config } from '../config.ts';
import { JevAuthError } from '../jev.ts';
import { routeRelevance, scoreRelevance, type RelevanceStatus } from '../relevance.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import { reportStage, setStage } from '../stage.ts';
import type { Job } from '../module_bindings/types.ts';

const PROGRESS_EVERY = 25;
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/** Runs `work` over `items` with at most `limit` in flight; `work` must not throw and returns false to stop all lanes. */
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

/**
 * Scores every not-yet-scored reference reel of a profile for niche relevance
 * and records retained / rejected / uncertain. Reels that fail to score stay
 * 'unscored' (grounding only excludes 'rejected'), and the failure is logged.
 */
export async function filterReferenceReels(conn: DbConnection, job: Job, profileId: string): Promise<void> {
  const apiKey = config.jevApiKey;
  if (!apiKey) throw new Error('JEV_API_KEY is not set on the worker, so reference reels cannot be filtered.');
  const profile = conn.db.companyProfile.id.find(profileId);
  if (!profile) throw new Error(`filter_references: unknown profile ${profileId}`);

  const reels = [...conn.db.referenceReel.iter()].filter((r) => r.profileId === profileId && r.relevanceStatus === 'unscored');
  const counts: Record<RelevanceStatus, number> = { retained: 0, rejected: 0, uncertain: 0 };
  let failed = 0;
  let done = 0;
  let inputTokens = 0;
  let firstError: string | undefined;
  let authError: JevAuthError | undefined;
  const company = { name: profile.name, pitch: profile.pitch, location: profile.location };

  const stage = () => `Filtering reference reels for relevance ${done}/${reels.length}`;
  await setStage(conn, job, stage());
  await pool(reels, Math.max(1, config.jevConcurrency), async (reel) => {
    try {
      const scored = await scoreRelevance(apiKey, company, reel);
      const status = routeRelevance(scored.relevance);
      await conn.reducers.setReelRelevance({ reelId: reel.id, relevance: scored.relevance, relevanceStatus: status });
      inputTokens += scored.inputTokens;
      counts[status]++;
    } catch (error) {
      if (error instanceof JevAuthError) {
        authError ??= error;
        return false;
      }
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      firstError ??= message;
      console.error(`[filter ${profileId}] reel ${reel.shortCode} failed: ${message}`);
    }
    done++;
    if (done % PROGRESS_EVERY === 0) reportStage(conn, job, stage());
    return true;
  });
  if (authError) throw authError;

  console.log(
    `[filter ${profileId}] ${reels.length} reels: ${counts.retained} retained, ${counts.rejected} rejected, ${counts.uncertain} uncertain, ${failed} failed, ` +
      `${inputTokens} JEV input tokens, $${(inputTokens * USD_PER_INPUT_TOKEN).toFixed(4)}` +
      (firstError ? `; first failure: ${firstError}` : ''),
  );
}

export const filterReferences = (conn: DbConnection, job: Job): Promise<void> => filterReferenceReels(conn, job, job.targetId);
