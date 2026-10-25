import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { DbConnection } from './module_bindings/index.ts';
import type { Job } from './module_bindings/types.ts';

export interface JobEligibility {
  canClaim: boolean;
  /** Invalid sources are claimed and failed promptly, rather than left queued. */
  error?: Error;
}

/**
 * Upload UUIDs refer to files on the receiving machine, not shared DB storage.
 * The eligible worker is one with a readable regular file in its upload folder.
 * This also supports existing upload:<uuid> rows and shared upload folders.
 */
export async function videoJobEligibility(conn: DbConnection, job: Job, uploadsDir: string): Promise<JobEligibility> {
  if (job.kind !== 'analyse_video') return { canClaim: true };
  let id: bigint;
  try { id = BigInt(job.targetId); }
  catch { return { canClaim: true, error: new Error('Invalid video analysis job target.') }; }
  const video = conn.db.video.id.find(id);
  // A job callback can arrive before its dependent video is available locally.
  // The worker reconsiders it when the video table catches up.
  if (!video) return { canClaim: false };
  const source = video.sourceUrl;
  if (!source?.startsWith('upload:')) return { canClaim: true };
  const name = source.slice('upload:'.length);
  const root = resolve(uploadsDir);
  const path = resolve(root, name);
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.') || !path.startsWith(root + sep)) {
    return { canClaim: true, error: new Error('Invalid uploaded video source. Re-upload the original video.') };
  }
  try {
    const file = await stat(path);
    if (!file.isFile()) return { canClaim: false };
    await access(path, constants.R_OK);
    return { canClaim: true };
  } catch {
    // Another worker may own this upload. Never claim or fail its job merely
    // because the shared DB references a file unavailable on this machine.
    return { canClaim: false };
  }
}
