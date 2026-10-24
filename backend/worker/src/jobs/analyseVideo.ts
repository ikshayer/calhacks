import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.ts';
import { models } from '../models.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Job } from '../module_bindings/types.ts';
import { readVideo } from '../video/analyse.ts';
import { extractFrames, probe } from '../video/ffmpeg.ts';
import { resolveSource } from '../video/source.ts';
import { transcribe } from '../video/transcribe.ts';

const CACHE_DIR = new URL('../../cache/', import.meta.url);

export async function analyseVideo(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so videos cannot be analysed.');

  const started = performance.now();
  const videoId = BigInt(job.targetId);
  const video = conn.db.video.id.find(videoId);
  if (!video) throw new Error(`analyse_video: unknown video ${job.targetId}`);
  const company = conn.db.companyProfile.id.find(video.profileId);
  if (!company) throw new Error(`analyse_video: video ${job.targetId} references unknown profile "${video.profileId}"`);

  const source = await resolveSource(video.sourceUrl);
  const work = await mkdtemp(join(tmpdir(), 'frames-'));
  try {
    const { durationSec, hasAudio } = await probe(source.path);
    const [frames, transcript] = await Promise.all([extractFrames(source.path, durationSec, work), transcribe(source.path, hasAudio, durationSec)]);
    const { reading, inputTokens, outputTokens } = await readVideo({ apiKey, company, durationSec, frames, transcript });

    await conn.reducers.setVideoAnalysis({ videoId, signals: { ...reading.signals, durationSec }, summary: reading.summary });

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      new URL(`analysis-${videoId}.json`, CACHE_DIR),
      JSON.stringify({ videoId: videoId.toString(), durationSec, model: models.videoAnalysis.id, reading, transcript }, null, 2),
    );

    const cost = inputTokens * models.videoAnalysis.usdPerInputToken + outputTokens * models.videoAnalysis.usdPerOutputToken;
    console.log(
      `[analyse ${videoId}] ${durationSec.toFixed(1)}s, ${frames.length} frames, ${transcript.length} transcript segments, ` +
        `${inputTokens} in / ${outputTokens} out tokens, ${((performance.now() - started) / 1000).toFixed(1)}s, $${cost.toFixed(4)}`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
    await source.cleanup();
  }
}
