import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** 16 kHz mono f32 for 10 minutes is ~38 MB; allow generous output buffers. */
const MAX_BUFFER = 512 * 1024 * 1024;

export interface Probe {
  durationSec: number;
  hasAudio: boolean;
}

export async function probe(path: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-show_entries', 'format=duration', '-of', 'json', path]);
  const info = JSON.parse(stdout) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
  const durationSec = Number(info.format?.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`ffprobe could not read a duration from the video: ${stdout.slice(0, 200)}`);
  return { durationSec, hasAudio: (info.streams ?? []).some((s) => s.codec_type === 'audio') };
}

export interface Frame {
  at: number;
  jpegBase64: string;
}

const FRAME_INTERVAL_SEC = 1.5;
const MAX_FRAMES = 16;
const FRAME_WIDTH = 512;

/** About one frame per 1.5 s (max 16), each taken at the middle of its slice. */
export async function extractFrames(path: string, durationSec: number, dir: string): Promise<Frame[]> {
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(durationSec / FRAME_INTERVAL_SEC)));
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.round(((i + 0.5) * durationSec) / count * 10) / 10;
    const out = `${dir}/frame-${i}.jpg`;
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', path, '-frames:v', '1', '-vf', `scale=${FRAME_WIDTH}:-2`, '-q:v', '4', out]);
    frames.push({ at, jpegBase64: (await readFile(out)).toString('base64') });
  }
  return frames;
}

/** Mono 16 kHz PCM, the input Whisper expects. */
export async function extractAudio(path: string): Promise<Float32Array> {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: MAX_BUFFER,
  });
  // Copy into an aligned buffer: a Buffer's byteOffset is not guaranteed to be a multiple of 4.
  const aligned = new Uint8Array(stdout).buffer;
  return new Float32Array(aligned, 0, Math.floor(aligned.byteLength / 4));
}
