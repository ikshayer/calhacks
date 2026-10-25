import type { DbConnection } from './module_bindings/index.ts';
import type { Job } from './module_bindings/types.ts';

/** Publishes what a job is doing, for the UI. Awaited: a failed stage update fails the job like any reducer error. */
export async function setStage(conn: DbConnection, job: Job, stage: string): Promise<void> {
  await conn.reducers.setJobStage({ jobId: job.id, stage });
}

/**
 * For progress updates sent from inside concurrent work, where awaiting would
 * slow the lanes down. The update is best effort, so a failure is logged, not thrown.
 */
export function reportStage(conn: DbConnection, job: Job, stage: string): void {
  setStage(conn, job, stage).catch((error: unknown) => {
    console.error(`[job ${job.id}] could not set stage "${stage}": ${error instanceof Error ? error.message : String(error)}`);
  });
}
