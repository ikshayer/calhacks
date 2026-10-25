import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileHash, lookup, store } from '../cache.ts';
import { config } from '../config.ts';
import { models } from '../models.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Job } from '../module_bindings/types.ts';
import { setStage } from '../stage.ts';
import { readVideo, validateReading, type VideoReading } from '../video/analyse.ts';
import { extractFrames, probe } from '../video/ffmpeg.ts';
import { resolveSource } from '../video/source.ts';
import { transcribe, type TranscriptSegment } from '../video/transcribe.ts';

const CACHE_DIR = new URL('../../cache/', import.meta.url);
const MAX_DURATION_SEC = 180; // Instagram reel limit
/** Bump when the analysis prompt (video/analyse.ts) or frame sampling changes, so cached analyses are not reused. */
const ANALYSIS_VERSION = 'analysis-v1';

interface CachedAnalysis {
  reading: VideoReading;
  transcript: TranscriptSegment[];
}

function validateTranscript(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) throw new Error('transcript is not an array');
  return value.map((segment: unknown, i) => {
    if (typeof segment !== 'object' || segment === null) throw new Error(`transcript[${i}] is not an object`);
    const { start, end, text } = segment as Record<string, unknown>;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof text !== 'string') {
      throw new Error(`transcript[${i}] must be {start:number,end:number,text:string}`);
    }
    return { start, end, text };
  });
}

export async function analyseVideo(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so videos cannot be analysed.');

  const started = performance.now();
  const videoId = BigInt(job.targetId);
  const video = conn.db.video.id.find(videoId);
  if (!video) throw new Error(`analyse_video: unknown video ${job.targetId}`);
  const company = conn.db.companyProfile.id.find(video.profileId);
  if (!company) throw new Error(`analyse_video: video ${job.targetId} references unknown profile "${video.profileId}"`);

  await setStage(conn, job, 'Loading the video');
  const source = await resolveSource(video.sourceUrl);
  const work = await mkdtemp(join(tmpdir(), 'frames-'));
  try {
    const { durationSec, hasAudio } = await probe(source.path);
    if (durationSec > MAX_DURATION_SEC) {
      throw new Error(`Video is ${durationSec.toFixed(0)}s long; the limit is ${MAX_DURATION_SEC}s (Instagram reel limit).`);
    }
    const keyParts = [
      await fileHash(source.path),
      company.name,
      company.pitch,
      models.videoAnalysis.id,
      models.videoAnalysis.effort,
      ANALYSIS_VERSION,
    ];
    const cached = await lookup<CachedAnalysis>('analysis', keyParts, (value) => {
      if (typeof value !== 'object' || value === null) throw new Error('entry is not an object');
      const entry = value as Record<string, unknown>;
      return { reading: validateReading(entry.reading, durationSec), transcript: validateTranscript(entry.transcript) };
    });

    let reading: VideoReading;
    let transcript: TranscriptSegment[];
    let live: { frameCount: number; inputTokens: number; outputTokens: number } | undefined;
    if (cached) {
      await setStage(conn, job, 'Reading the video (cached)');
      ({ reading, transcript } = cached);
    } else {
      await setStage(conn, job, 'Sampling frames and transcribing speech');
      const [frames, segments] = await Promise.all([extractFrames(source.path, durationSec, work), transcribe(source.path, hasAudio, durationSec)]);
      await setStage(conn, job, 'Reading the video with Claude');
      const result = await readVideo({ apiKey, company, durationSec, frames, transcript: segments });
      reading = result.reading;
      transcript = segments;
      live = { frameCount: frames.length, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      await store('analysis', keyParts, { reading, transcript });
    }

    const analysisJson = JSON.stringify({ transcript, onScreenText: reading.onScreenText, notes: reading.notes });
    await conn.reducers.setVideoAnalysis({ videoId, signals: { ...reading.signals, durationSec }, summary: reading.summary, analysisJson });

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      new URL(`analysis-${videoId}.json`, CACHE_DIR),
      JSON.stringify({ videoId: videoId.toString(), durationSec, model: models.videoAnalysis.id, reading, transcript }, null, 2),
    );

    if (!live) {
      console.log(`[analyse ${videoId}] cached`);
    } else {
      const { frameCount, inputTokens, outputTokens } = live;
      const cost = inputTokens * models.videoAnalysis.usdPerInputToken + outputTokens * models.videoAnalysis.usdPerOutputToken;
      console.log(
        `[analyse ${videoId}] ${durationSec.toFixed(1)}s, ${frameCount} frames, ${transcript.length} transcript segments, ` +
          `${inputTokens} in / ${outputTokens} out tokens, ${((performance.now() - started) / 1000).toFixed(1)}s, $${cost.toFixed(4)}`,
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
    await source.cleanup();
  }
}
