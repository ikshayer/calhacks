/**
 * The single home for the JEV audience-scoring call. Each audience member is
 * asked four yes/no (Noul) questions about one reel; the answers are the raw
 * probabilities the cascade later rolls.
 */

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 500;

const SCROLLED = 'They scrolled past or gave up before the end.';
export const QUESTIONS = {
  watch: {
    type: 'noul',
    instructions: 'This person has just been shown this reel in their Instagram feed. Do they watch it through to the end instead of scrolling past?',
    criteria: { true: 'They watch to the end.', false: SCROLLED },
  },
  like: {
    type: 'noul',
    instructions: 'Assume this person watched the reel to the end. Do they tap like?',
    criteria: { true: 'They like it.', false: 'They do not like it.' },
  },
  comment: {
    type: 'noul',
    instructions: 'Assume this person watched the reel to the end. Do they write a comment?',
    criteria: { true: 'They comment.', false: 'They do not comment.' },
  },
  share: {
    type: 'noul',
    instructions: 'Assume this person watched the reel to the end. Do they share it or send it to someone?',
    criteria: { true: 'They share or send it.', false: 'They keep it to themselves.' },
  },
} as const;
export type Signal = keyof typeof QUESTIONS;
const SIGNALS = Object.keys(QUESTIONS) as Signal[];

export interface JevState {
  person: {
    audience_group: string;
    group_description: string;
    interests: string[];
    habits: string;
    responds_to: string[];
    turned_off_by: string[];
    /** The resident's full profile (Millbrook: age, occupation, Big Five personality, values, goals, beliefs, memories). */
    profile?: Record<string, unknown>;
  };
  reel: { account: string; content: string };
}

export interface JevScore {
  /** Raw, uncalibrated probabilities in [0, 1]. like/comment/share are conditional on watching. */
  p: Record<Signal, number>;
  inputTokens: number;
}

export interface JevBody {
  answers?: Record<string, { noul?: unknown } | undefined>;
  usage?: { input_tokens?: unknown };
}

/** The key is missing, wrong or revoked: no member can be scored, so the whole run should stop. */
export class JevAuthError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Calls JEV with the given state and questions. Retries 429s with exponential backoff; any other failure throws. */
export async function askJev(apiKey: string, state: unknown, questions: object): Promise<JevBody> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    });
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new JevAuthError(`JEV rejected the API key (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    if (!res.ok) throw new Error(`JEV ${res.status}${res.status === 429 ? ` after ${attempt} attempts` : ''}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as JevBody;
  }
}

/** Reads one Noul answer, which must be a probability in [0, 1]. */
export function noulAnswer(body: JevBody, id: string): number {
  const value = body.answers?.[id]?.noul;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`JEV returned an invalid "${id}" answer: ${JSON.stringify(body.answers?.[id])}`);
  }
  return value;
}

export function inputTokensOf(body: JevBody): number {
  const inputTokens = body.usage?.input_tokens;
  if (typeof inputTokens !== 'number') throw new Error(`JEV response has no usage.input_tokens: ${JSON.stringify(body.usage)}`);
  return inputTokens;
}

/** Score one member. */
export async function scoreMember(apiKey: string, state: JevState): Promise<JevScore> {
  const body = await askJev(apiKey, state, QUESTIONS);
  const p = {} as Record<Signal, number>;
  for (const signal of SIGNALS) p[signal] = noulAnswer(body, signal);
  return { p, inputTokens: inputTokensOf(body) };
}
