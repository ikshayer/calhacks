import Anthropic from '@anthropic-ai/sdk';
import { models } from '../models.ts';
import type { Frame } from './ffmpeg.ts';
import type { TranscriptSegment } from './transcribe.ts';

export interface Signals {
  hookStrength: number;
  clarityOfAsk: number;
  pacing: number;
  warmth: number;
  topics: string[];
}
export interface OnScreenText {
  at: number;
  text: string;
}
export interface Note {
  at: number;
  severity: 'strength' | 'risk' | 'fix';
  title: string;
  detail: string;
}
export interface VideoReading {
  summary: string;
  signals: Signals;
  onScreenText: OnScreenText[];
  notes: Note[];
}
export interface ReadingResult {
  reading: VideoReading;
  inputTokens: number;
  outputTokens: number;
}

const unit = { type: 'number' } as const;
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'signals', 'onScreenText', 'notes'],
  properties: {
    summary: { type: 'string' },
    signals: {
      type: 'object',
      additionalProperties: false,
      required: ['hookStrength', 'clarityOfAsk', 'pacing', 'warmth', 'topics'],
      properties: { hookStrength: unit, clarityOfAsk: unit, pacing: unit, warmth: unit, topics: { type: 'array', items: { type: 'string' } } },
    },
    onScreenText: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['at', 'text'], properties: { at: { type: 'number' }, text: { type: 'string' } } },
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'severity', 'title', 'detail'],
        properties: {
          at: { type: 'number' },
          severity: { type: 'string', enum: ['strength', 'risk', 'fix'] },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `You are analysing a short vertical Instagram reel for a small business. You are given frames sampled across the video (each labelled with its timestamp) and a timestamped speech transcript.

Return JSON matching the schema.

summary: a factual timeline with [mm:ss] markers, 80-200 words. Describe what a viewer actually sees and hears, moment by moment: on-screen text, visuals, spoken words, and the ask. Describe only; give no advice and no opinions.

signals, each a number from 0 to 1:
- hookStrength: how strongly the first ~2 seconds earn the next second of attention.
- clarityOfAsk: whether a viewer knows exactly what to do after watching.
- pacing: how well the edit rhythm fits the content and platform.
- warmth: real faces, real places and a human tone (low for abstract graphics and robotic voices).
- topics: 3-6 short topic phrases.
Score honestly across the full range. Do not default to the middle.

onScreenText: each distinct piece of on-screen text, with the second it first appears.

notes: 3-6 observations for a later report. Each has a real timestamp 'at' in seconds inside the video, a severity ('strength', 'risk' or 'fix'), a short title and one or two sentences of detail.`;

const SIGNAL_KEYS = ['hookStrength', 'clarityOfAsk', 'pacing', 'warmth'] as const;

function fail(problem: string): never {
  throw new Error(`Claude's video analysis was invalid: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(item: unknown, durationSec: number): number {
  const at = isRecord(item) ? item.at : undefined;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > durationSec) {
    fail(`timestamp ${JSON.stringify(at)} is outside 0-${durationSec}s`);
  }
  return at;
}

/** Throws on anything the model returned that the rest of the pipeline cannot trust. */
export function validateReading(value: unknown, durationSec: number): VideoReading {
  if (!isRecord(value)) return fail('expected a JSON object');
  const { summary, signals, onScreenText, notes } = value;
  if (typeof summary !== 'string' || summary.trim().length === 0) return fail('empty summary');
  if (!isRecord(signals)) return fail('missing signals');

  const scores = { hookStrength: 0, clarityOfAsk: 0, pacing: 0, warmth: 0 };
  for (const key of SIGNAL_KEYS) {
    const v = signals[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      return fail(`signals.${key} must be a number in [0, 1], got ${JSON.stringify(v)}`);
    }
    scores[key] = v;
  }
  const topics = signals.topics;
  if (!Array.isArray(topics) || topics.length === 0 || !topics.every((t): t is string => typeof t === 'string')) {
    return fail('signals.topics must be a non-empty string array');
  }

  if (!Array.isArray(onScreenText)) return fail('onScreenText must be an array');
  if (!Array.isArray(notes)) return fail('notes must be an array');
  const checkedText: OnScreenText[] = onScreenText.map((item) => {
    const text = isRecord(item) ? item.text : undefined;
    if (typeof text !== 'string') return fail('onScreenText entries need a text string');
    return { at: timestamp(item, durationSec), text };
  });
  const checkedNotes: Note[] = notes.map((item) => {
    if (!isRecord(item)) return fail('notes entries must be objects');
    const { severity, title, detail } = item;
    if (severity !== 'strength' && severity !== 'risk' && severity !== 'fix') return fail(`bad note severity ${JSON.stringify(severity)}`);
    if (typeof title !== 'string' || typeof detail !== 'string') return fail('notes need a title and detail string');
    return { at: timestamp(item, durationSec), severity, title, detail };
  });

  return { summary, signals: { ...scores, topics }, onScreenText: checkedText, notes: checkedNotes };
}

export async function readVideo(args: {
  apiKey: string;
  company: { name: string; pitch: string };
  durationSec: number;
  frames: Frame[];
  transcript: TranscriptSegment[];
}): Promise<ReadingResult> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const { company, durationSec, frames, transcript } = args;

  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: `Business: ${company.name}. ${company.pitch}\nVideo duration: ${durationSec.toFixed(1)} s.\n\nFrames follow, each preceded by its timestamp.` },
  ];
  for (const frame of frames) {
    content.push({ type: 'text', text: `Frame at ${frame.at}s` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame.jpegBase64 } });
  }
  const transcriptText = transcript.length
    ? transcript.map((t) => `[${t.start.toFixed(1)}s-${t.end.toFixed(1)}s] ${t.text}`).join('\n')
    : '(no speech: the video has no audio track or no spoken words)';
  content.push({ type: 'text', text: `Speech transcript:\n${transcriptText}` });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: models.videoAnalysis.id,
      max_tokens: models.videoAnalysis.maxTokens,
      system: INSTRUCTIONS,
      messages: [{ role: 'user', content }],
      output_config: { effort: models.videoAnalysis.effort, format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude refused to analyse this video.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens before finishing the analysis.');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!text) throw new Error('Claude returned no text content.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch (error) {
    throw new Error(`Claude's analysis was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    reading: validateReading(parsed, durationSec),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
