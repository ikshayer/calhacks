import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';

export interface ResolvedSource {
  path: string;
  /** Removes anything downloaded; a no-op for local files. */
  cleanup: () => Promise<void>;
}

/**
 * Turns `video.sourceUrl` into a local file. The demo uses pre-loaded videos
 * (`demo:original.mp4` resolves inside config.demoVideosDir); http(s) URLs,
 * file:// URLs and plain paths also work for local testing.
 */
export async function resolveSource(sourceUrl: string | undefined): Promise<ResolvedSource> {
  if (!sourceUrl) throw new Error('This video has no sourceUrl, so there is nothing to analyse.');

  if (sourceUrl.startsWith('demo:')) {
    const name = sourceUrl.slice('demo:'.length);
    if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error(`Invalid demo video name "${name}"`);
    return resolveSource(join(config.demoVideosDir, name));
  }

  if (sourceUrl.startsWith('upload:')) {
    const name = sourceUrl.slice('upload:'.length);
    if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error(`Invalid uploaded video name "${name}"`);
    return resolveSource(join(config.uploadsDir, name));
  }

  if (/^https?:\/\//i.test(sourceUrl)) {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`Could not download the video (${res.status}) from ${new URL(sourceUrl).host}`);
    const dir = await mkdtemp(join(tmpdir(), 'video-'));
    const path = join(dir, 'source');
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  const path = sourceUrl.startsWith('file://') ? fileURLToPath(sourceUrl) : sourceUrl;
  try {
    await access(path);
  } catch (error) {
    throw new Error(`Video file is not readable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path, cleanup: async () => {} };
}
