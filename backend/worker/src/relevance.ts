import { askJev, inputTokensOf, noulAnswer } from './jev.ts';

/** JEV P(relevant) at or above this keeps the reel as grounding. */
export const RETAIN_AT_OR_ABOVE = 0.6;
/** At or below this the reel is excluded from grounding. Between the two it is 'uncertain'. */
export const REJECT_AT_OR_BELOW = 0.3;

export type RelevanceStatus = 'retained' | 'rejected' | 'uncertain';

export function routeRelevance(relevance: number): RelevanceStatus {
  if (relevance >= RETAIN_AT_OR_ABOVE) return 'retained';
  if (relevance <= REJECT_AT_OR_BELOW) return 'rejected';
  return 'uncertain';
}

const QUESTION_ID = 'relevant';
const QUESTIONS = {
  [QUESTION_ID]: {
    type: 'noul',
    instructions:
      'Is this Instagram reel relevant to the company\'s niche, so that it is a useful example of content the company could learn from or make itself? ' +
      'Reels from an unrelated topic or industry are not relevant.',
    criteria: { true: 'The reel is relevant to the company\'s niche.', false: 'The reel is off-niche or unrelated.' },
  },
} as const;

export interface RelevanceCompany {
  name: string;
  pitch: string;
  location: string | undefined;
}

export interface RelevanceReel {
  ownerUsername: string;
  caption: string;
  hashtags: string[];
}

/** Asks JEV whether one reel fits the company's niche. */
export async function scoreRelevance(
  apiKey: string,
  company: RelevanceCompany,
  reel: RelevanceReel,
): Promise<{ relevance: number; inputTokens: number }> {
  const state = {
    company: { name: company.name, pitch: company.pitch, location: company.location },
    reel: { owner: reel.ownerUsername, caption: reel.caption, hashtags: reel.hashtags },
  };
  const body = await askJev(apiKey, state, QUESTIONS);
  return { relevance: noulAnswer(body, QUESTION_ID), inputTokens: inputTokensOf(body) };
}
