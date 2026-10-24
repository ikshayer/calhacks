import { pipeline } from '@huggingface/transformers';
import { models } from '../models.ts';
import { extractAudio } from './ffmpeg.ts';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

type Recogniser = (audio: Float32Array, options: { return_timestamps: true; chunk_length_s: number }) => Promise<unknown>;

let recogniser: Promise<Recogniser> | undefined;

/** Loaded once per process; the first call downloads the ONNX model into the local cache. */
function loadRecogniser(): Promise<Recogniser> {
  recogniser ??= pipeline('automatic-speech-recognition', models.transcription.id).then((asr) => (audio, options) => asr(audio, options));
  return recogniser;
}

/** Timestamped transcript of the audio track; empty if the video has no audio. */
export async function transcribe(path: string, hasAudio: boolean, durationSec: number): Promise<TranscriptSegment[]> {
  if (!hasAudio) return [];
  const audio = await extractAudio(path);
  if (audio.length === 0) return [];

  const asr = await loadRecogniser();
  const result = await asr(audio, { return_timestamps: true, chunk_length_s: 30 });
  const chunks = (result as { chunks?: { timestamp: [number, number | null]; text: string }[] }).chunks;
  if (!Array.isArray(chunks)) throw new Error(`Whisper returned no timestamped chunks: ${JSON.stringify(result).slice(0, 200)}`);

  return chunks
    .map((c) => ({ start: c.timestamp[0], end: Math.min(c.timestamp[1] ?? durationSec, durationSec), text: c.text.trim() }))
    .filter((c) => c.text.length > 0);
}
