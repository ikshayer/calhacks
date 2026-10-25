import type { DbConnection } from './module_bindings/index.ts';
import type { Job } from './module_bindings/types.ts';
import type { JobEligibility } from './videoJobEligibility.ts';

type Handler = (conn: DbConnection, job: Job) => Promise<void>;

/** Claim/execute lifecycle, with local-file eligibility checked before claiming. */
export function createJobRunner(
  handlers: Readonly<Record<string, Handler>>,
  eligibility: (conn: DbConnection, job: Job) => Promise<JobEligibility>,
) {
  const seen = new Set<bigint>();
  return async function handleJob(conn: DbConnection, job: Job): Promise<void> {
    const handler = handlers[job.kind];
    if (!handler || job.status !== 'queued' || seen.has(job.id)) return;
    const eligible = await eligibility(conn, job);
    if (!eligible.canClaim) return;
    // File checks await IO. Multiple callbacks can pass the initial check;
    // only one may add the job and send a claim after those checks finish.
    if (seen.has(job.id)) return;
    seen.add(job.id);
    try {
      await conn.reducers.claimJob({ jobId: job.id });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('job already claimed')) return;
      console.error(`[job ${job.id}] could not claim ${job.kind}: ${message}`);
      seen.delete(job.id);
      return;
    }
    try {
      if (eligible.error) throw eligible.error;
      await handler(conn, job);
      await conn.reducers.finishJob({ jobId: job.id });
    } catch (error) {
      const message = errorMessage(error);
      console.error(`[job ${job.id}] ${job.kind} failed: ${message}`);
      try { await conn.reducers.failJob({ jobId: job.id, error: message }); }
      catch (reportError) { console.error(`[job ${job.id}] could not record the failure; job stays claimed: ${errorMessage(reportError)}`); }
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
