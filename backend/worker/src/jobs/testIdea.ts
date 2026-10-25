import Anthropic from '@anthropic-ai/sdk';
import { cacheKey, lookup, store } from '../cache.ts';
import { config } from '../config.ts';
import { JevAuthError, askJev, inputTokensOf, noulAnswer } from '../jev.ts';
import { models } from '../models.ts';
import { reportStage, setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type {
  AudienceMember,
  CampaignOption,
  CompanyProfile,
  IdeaAnalysis,
  IdeaMetrics,
  IdeaResident,
  Job,
} from '../module_bindings/types.ts';

/** Members between live progress updates. */
const PROGRESS_EVERY = 10;
const USD_PER_JEV_INPUT_TOKEN = 0.042 / 1_000_000;
const MAX_CITED = 6;
const MAX_AGE = 120;
/** Residents with a known age below this are not buyers for these ideas, so they are left out unless the target names them. */
const MIN_DECISION_AGE = 13;
/** Longest slice of one profile field shown to the analyst, so 100+ residents stay within the prompt. */
const FIELD_CHARS = 220;

/** The model id jev.ts sends; part of the cache key so a model change is a miss. */
const JEV_MODEL = 'jev-latest';

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

function fail(problem: string): never {
  throw new Error(`Claude's idea test output was invalid: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fail(`${what} must be a non-empty string`);
  return value;
}

function stringList(value: unknown, what: string, min: number, max: number): string[] {
  if (!Array.isArray(value)) return fail(`${what} must be an array`);
  if (value.length < min || value.length > max) return fail(`${what} must have ${min}-${max} entries, got ${value.length}`);
  return value.map((item, i) => nonEmpty(item, `${what}[${i}]`));
}

// ---------------------------------------------------------------------------
// Step 1: parse the prompt
// ---------------------------------------------------------------------------

export interface ParsedIdea {
  idea: string;
  targetLabel: string;
  minAge: number | null;
  maxAge: number | null;
}

const text = { type: 'string' } as const;
const nullableAge = { type: ['integer', 'null'] } as const;

const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['idea', 'targetLabel', 'minAge', 'maxAge'],
  properties: { idea: text, targetLabel: text, minAge: nullableAge, maxAge: nullableAge },
} as const;

const PARSE_INSTRUCTIONS = `You read a small business owner's description of an idea they want to test with a town's residents, and split it into parts.

Return JSON matching the schema.

idea: one line saying what is being launched or offered, in the owner's terms. Do not add details that are not in the description.
targetLabel: a short label for the audience the owner asked about, such as 'ages 18-21' or 'students' or 'everyone'. Use 'everyone' when the description names no specific audience.
minAge, maxAge: whole numbers when the description gives an age range or limit for the audience ('18-21' gives 18 and 21; 'over 65' gives 65 and null; 'under 30' gives null and 29). Use null for a bound that is not stated. Audiences that are not defined by age (for example 'students') have both null.`;

function ageBound(value: unknown, what: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_AGE) {
    return fail(`${what} ${JSON.stringify(value)} must be a whole number from 0 to ${MAX_AGE}, or null`);
  }
  return value;
}

/** Throws on anything the model returned that the rest of the pipeline cannot trust. */
export function validateParsedIdea(value: unknown): ParsedIdea {
  if (!isRecord(value)) return fail('expected a JSON object');
  const minAge = ageBound(value.minAge, 'minAge');
  const maxAge = ageBound(value.maxAge, 'maxAge');
  if (minAge !== null && maxAge !== null && minAge > maxAge) return fail(`minAge ${minAge} is above maxAge ${maxAge}`);
  return { idea: nonEmpty(value.idea, 'idea'), targetLabel: nonEmpty(value.targetLabel, 'targetLabel'), minAge, maxAge };
}

// ---------------------------------------------------------------------------
// Step 3: JEV scoring
// ---------------------------------------------------------------------------

interface RawIdeaScore {
  visit: number;
  return: number;
  share: number;
  options: number[];
}

function probability(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${what} is not a probability`);
  return value;
}

/** Cached raw answers, keyed by resident state hash; `optionCount` guards against a stale entry for a different option list. */
export function validateIdeaScoreMap(value: unknown, optionCount: number): Record<string, RawIdeaScore> {
  if (!isRecord(value)) throw new Error('expected an object of raw scores');
  const map: Record<string, RawIdeaScore> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) throw new Error(`score ${key} is not an object`);
    const options = entry.options;
    if (!Array.isArray(options) || options.length !== optionCount) throw new Error(`score ${key}.options must have ${optionCount} entries`);
    map[key] = {
      visit: probability(entry.visit, `score ${key}.visit`),
      return: probability(entry.return, `score ${key}.return`),
      share: probability(entry.share, `score ${key}.share`),
      options: options.map((p, i) => probability(p, `score ${key}.options[${i}]`)),
    };
  }
  return map;
}

function questionsFor(options: readonly CampaignOption[]) {
  const questions: Record<string, object> = {
    visit: {
      type: 'noul',
      instructions: 'If this opened near them, would this person go at least once?',
      criteria: { true: 'They go at least once.', false: 'They never go.' },
    },
    return: {
      type: 'noul',
      instructions: 'Assume this person went once. Would they come back?',
      criteria: { true: 'They come back.', false: 'They do not come back.' },
    },
    share: {
      type: 'noul',
      instructions: 'Assume this person went once. Would they tell a friend or post about it?',
      criteria: { true: 'They tell a friend or post about it.', false: 'They keep it to themselves.' },
    },
  };
  options.forEach((option, i) => {
    questions[`option_${i}`] = {
      type: 'noul',
      instructions: `Would this person notice "${option.name}" and be moved to go because of it?`,
      criteria: { true: 'They notice it and go because of it.', false: 'They do not notice it, or it does not move them to go.' },
    };
  });
  return questions;
}

interface Resident {
  member: AudienceMember;
  profile: Record<string, unknown>;
  /** Undefined when the profile has no usable age. */
  age: number | undefined;
}

/** The stored resident profile. A malformed one fails the job (residents are read before scoring) rather than silently scoring a thinner persona. */
function parseProfile(member: AudienceMember): Record<string, unknown> {
  if (!member.profileJson) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(member.profileJson);
  } catch (error) {
    throw new Error(`member ${member.memberId} has an invalid profileJson: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`member ${member.memberId} profileJson is not an object`);
  return parsed;
}

function ageOf(profile: Record<string, unknown>): number | undefined {
  const { age } = profile;
  return typeof age === 'number' && Number.isInteger(age) && age >= 0 ? age : undefined;
}

function stateFor(r: Resident, profile: CompanyProfile, parsed: ParsedIdea, prompt: string, options: readonly CampaignOption[]) {
  const group = profile.groups.find((g) => g.id === r.member.groupId);
  return {
    person: {
      audience_group: group?.label ?? r.member.groupId,
      interests: r.member.interests,
      habits: r.member.persona,
      profile: r.profile,
    },
    idea: { description: parsed.idea, asked: prompt, campaigns: options },
  };
}

/** Runs `work` over `items` with at most `limit` in flight. `work` must not throw; it returns false to stop every lane. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<boolean>): Promise<void> {
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped && next < items.length) {
      if (!(await work(items[next++]!))) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// ---------------------------------------------------------------------------
// Step 4: metrics, in code
// ---------------------------------------------------------------------------

export function computeMetrics(residents: readonly IdeaResident[], optionCount: number): IdeaMetrics {
  const scored = residents.filter((r) => !r.missing);
  const interested = scored.filter((r) => r.pVisit >= 0.5);
  return {
    scored: scored.length,
    inTarget: scored.filter((r) => r.inTarget).length,
    interested: interested.length,
    interestedInTarget: interested.filter((r) => r.inTarget).length,
    expectedVisits: scored.reduce((sum, r) => sum + r.pVisit, 0),
    expectedShares: scored.reduce((sum, r) => sum + r.pVisit * r.pShare, 0),
    optionVisits: Array.from({ length: optionCount }, (_, i) => scored.reduce((sum, r) => sum + (r.optionInterest[i] ?? 0) * r.pVisit, 0)),
  };
}

// ---------------------------------------------------------------------------
// Step 5: the analyst
// ---------------------------------------------------------------------------

export interface PlainPair {
  what: string;
  because: string;
}

/** The plain-language read of the result, shown to the owner. Serialised into the `plainJson` column. */
export interface PlainAnswer {
  answer: { text: string; because: string };
  bestBet: PlainPair;
  experiment: PlainPair;
  howYouKnow: PlainPair;
  objections: { reason: string; because: string }[];
}

export interface AnalysisDraft {
  analysis: IdeaAnalysis;
  plain: PlainAnswer;
  reasons: { memberId: number; reason: string }[];
}

const pairOf = (first: string) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: [first, 'because'],
    properties: { [first]: text, because: text },
  }) as const;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recommendedCampaign',
    'evidence',
    'segments',
    'objections',
    'budgetAllocation',
    'experiment',
    'successMetric',
    'assumptions',
    'limitations',
    'reasons',
    'plain',
  ],
  properties: {
    recommendedCampaign: text,
    evidence: { type: 'array', items: text },
    segments: { type: 'array', items: text },
    objections: { type: 'array', items: text },
    budgetAllocation: text,
    experiment: text,
    successMetric: text,
    assumptions: { type: 'array', items: text },
    limitations: { type: 'array', items: text },
    plain: {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'bestBet', 'experiment', 'howYouKnow', 'objections'],
      properties: {
        answer: pairOf('text'),
        bestBet: pairOf('what'),
        experiment: pairOf('what'),
        howYouKnow: pairOf('what'),
        objections: { type: 'array', items: pairOf('reason') },
      },
    },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['memberId', 'reason'],
        properties: { memberId: { type: 'integer' }, reason: text },
      },
    },
  },
} as const;

const ANALYSIS_INSTRUCTIONS = `ROLE: Campaign Strategy Analyst. You are analyzing synthetic customer simulation results for a small business. Compare campaigns using the same evaluation methodology. Calculate the number of exposed agents, interested agents, simulated visits, and shares (use the provided computed metrics; do not recompute differently). Identify recurring objections and distinct audience segments. Identify which campaign performs best within the business budget. Explain tradeoffs and uncertainty. Recommend one low-cost real-world experiment. Define a measurable KPI, such as coupon redemption or first-time purchases.

Inputs, all in the user message: the business profile, the idea and the audience it was aimed at, the budget and campaign options with their costs (or 'none given'), the computed metrics, how many residents under 13 were excluded from the simulation, and one row per simulated resident (name, age, occupation, whether they are in the target audience, their simulated probabilities, and their values, goals and beliefs).

Rules:
- Never describe simulated responses as actual consumer research.
- Never convert synthetic visit intent directly into predicted revenue.
- Do not fabricate engagement, conversion, or sales data.
- State when evidence is insufficient.
- Distinguish observations, assumptions, and recommendations.
- If fewer than 5 residents are in the target audience, say the sample is too small to read the target on its own and lean on the whole-town result.
- If no budget or no campaign options were given, say a budget comparison is not possible, and do not invent options or costs.
- Always refer to residents by name (for example 'Maria, 34'). Never refer to them by row number, list position or memberId in any text field; memberId appears only in the 'memberId' field of reasons.
- If any residents under 13 were excluded, mention it once in assumptions (they were left out because young children are not decision-makers for this idea).
- Use only the numbers in the user message. Do not invent quotes, accounts or facts about the town.

Return JSON matching the schema.

recommendedCampaign: the one option you recommend, named exactly as given, or a plain statement that no option can be recommended from this evidence.
evidence: 2-5 observations from the simulation that support the recommendation, each citing the provided metrics or resident rows. Observations only.
segments: 1-4 distinct audience segments most interested, each with who they are and why, drawn from the resident rows.
objections: exactly the top three recurring objections (fewer only if the rows support fewer, never more than three, at least one), drawn from the residents' values, goals and beliefs.
budgetAllocation: how to spend the budget across the options given, with amounts that do not exceed it; or a statement that a budget comparison is not possible.
experiment: one low-cost real-world experiment to check the recommendation with real people.
successMetric: one measurable KPI for that experiment, with how to count it.
assumptions: the assumptions this analysis rests on (recommendations that are not observations belong here or in budgetAllocation).
limitations: confidence limitations, including that residents are simulated and probabilities are uncalibrated.
reasons: up to ${MAX_CITED} residents worth citing, each with 'memberId' exactly as shown in the rows and a one-sentence 'reason' that names the resident and ties their answer to their values, goals or beliefs. Cite only residents that appear in the rows.
plain: the same result told to a shop owner who has never seen a research report. Fields:
- answer.text: the overall result in 1-2 sentences. answer.because: why the town reacted that way. Say 'simulated residents' at least once in answer.because. If the evidence is thin (for example nobody is in the target age, or fewer than 5 are), say so plainly in answer.because.
- bestBet.what: which campaign or approach to pick. bestBet.because: why, citing the simulated visit numbers you were given, compared with the alternatives and their costs. If no options were given, say so and do not invent any.
- experiment.what: one cheap real-world test to run first. experiment.because: why it is the right first step.
- howYouKnow.what: the one number to measure. howYouKnow.because: why that number shows success.
- objections: 1-3 entries. Each reason says why some residents would say no; each because points to what in their profiles shows it and names 1-2 residents (for example 'Maria, 34').
Writing rules for plain: plain everyday language, like a friend explaining. Short sentences. No jargon (no 'KPI', 'segment', 'conversion', 'cohort'). Every 'because' must point to specific simulated evidence from the input (counts, visit numbers, named residents and their values or goals). Never invent numbers. Never refer to residents by row number or memberId.`;

export function validatePlain(value: unknown): PlainAnswer {
  if (!isRecord(value)) return fail('plain must be an object');
  const pair = (field: string, first: string) => {
    const v = value[field];
    if (!isRecord(v)) return fail(`plain.${field} must be an object`);
    return { first: nonEmpty(v[first], `plain.${field}.${first}`), because: nonEmpty(v.because, `plain.${field}.because`) };
  };
  const answer = pair('answer', 'text');
  const bestBet = pair('bestBet', 'what');
  const experiment = pair('experiment', 'what');
  const howYouKnow = pair('howYouKnow', 'what');
  const { objections } = value;
  if (!Array.isArray(objections)) return fail('plain.objections must be an array');
  if (objections.length < 1 || objections.length > 3) return fail(`plain.objections must have 1-3 entries, got ${objections.length}`);
  return {
    answer: { text: answer.first, because: answer.because },
    bestBet: { what: bestBet.first, because: bestBet.because },
    experiment: { what: experiment.first, because: experiment.because },
    howYouKnow: { what: howYouKnow.first, because: howYouKnow.because },
    objections: objections.map((item, i) => {
      if (!isRecord(item)) return fail(`plain.objections[${i}] must be an object`);
      return { reason: nonEmpty(item.reason, `plain.objections[${i}].reason`), because: nonEmpty(item.because, `plain.objections[${i}].because`) };
    }),
  };
}

/** Throws on anything the model returned that the rest of the pipeline cannot trust. */
export function validateAnalysis(value: unknown, memberIds: ReadonlySet<number>): AnalysisDraft {
  if (!isRecord(value)) return fail('expected a JSON object');
  const { reasons } = value;
  if (!Array.isArray(reasons)) return fail('reasons must be an array');
  // A bad citation (an unscored resident such as an excluded child, or a repeat) is dropped with a
  // warning rather than failing the whole test: citations only add reasons to the resident list.
  const seen = new Set<number>();
  const checkedReasons: { memberId: number; reason: string }[] = [];
  for (const item of reasons) {
    if (!isRecord(item)) return fail('reasons entries must be objects');
    const { memberId } = item;
    if (typeof memberId !== 'number' || !Number.isInteger(memberId) || !memberIds.has(memberId)) {
      console.warn(`[idea] dropping citation of ${JSON.stringify(memberId)}: not a scored resident`);
      continue;
    }
    if (seen.has(memberId)) {
      console.warn(`[idea] dropping repeat citation of resident ${memberId}`);
      continue;
    }
    if (checkedReasons.length >= MAX_CITED) {
      console.warn(`[idea] dropping citation of resident ${memberId}: more than ${MAX_CITED} cited`);
      continue;
    }
    seen.add(memberId);
    checkedReasons.push({ memberId, reason: nonEmpty(item.reason, 'reason') });
  }

  return {
    analysis: {
      recommendedCampaign: nonEmpty(value.recommendedCampaign, 'recommendedCampaign'),
      evidence: stringList(value.evidence, 'evidence', 1, 8),
      segments: stringList(value.segments, 'segments', 1, 6),
      objections: stringList(value.objections, 'objections', 1, 3),
      budgetAllocation: nonEmpty(value.budgetAllocation, 'budgetAllocation'),
      experiment: nonEmpty(value.experiment, 'experiment'),
      successMetric: nonEmpty(value.successMetric, 'successMetric'),
      assumptions: stringList(value.assumptions, 'assumptions', 1, 10),
      limitations: stringList(value.limitations, 'limitations', 1, 10),
    },
    plain: validatePlain(value.plain),
    reasons: checkedReasons,
  };
}

function clip(value: unknown): string {
  if (value === undefined || value === null) return 'n/a';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > FIELD_CHARS ? `${s.slice(0, FIELD_CHARS - 1).trimEnd()}…` : s;
}

const p2 = (x: number) => x.toFixed(2);

function residentRow(r: IdeaResident, profile: Record<string, unknown>): string {
  return (
    `${r.name} (memberId ${r.memberId}), age ${r.age || 'unknown'}, ${clip(profile.occupation)}, in target: ${r.inTarget ? 'yes' : 'no'}; ` +
    `visit ${p2(r.pVisit)}, return ${p2(r.pReturn)}, share ${p2(r.pShare)}` +
    (r.optionInterest.length > 0 ? `, options ${r.optionInterest.map(p2).join('/')}` : '') +
    `; values: ${clip(profile.values)}; goals: ${clip(profile.goals)}; beliefs: ${clip(profile.beliefs)}`
  );
}

function analysisInput(
  profile: CompanyProfile,
  parsed: ParsedIdea,
  budgetUsd: number | undefined,
  options: readonly CampaignOption[],
  metrics: IdeaMetrics,
  rows: string[],
  excludedUnderage: number,
): string {
  const optionLines =
    options.length > 0 ? options.map((o, i) => `${i + 1}. ${o.name} (cost $${o.costUsd}): ${metrics.optionVisits[i]!.toFixed(1)} simulated visits`) : ['none given'];
  const target = [parsed.minAge === null ? null : `min age ${parsed.minAge}`, parsed.maxAge === null ? null : `max age ${parsed.maxAge}`]
    .filter((x) => x !== null)
    .join(', ');
  return [
    `Business: ${profile.name}. ${profile.pitch}${profile.location ? ` Location: ${profile.location}.` : ''}`,
    `Idea: ${parsed.idea}`,
    `Target audience: ${parsed.targetLabel}${target ? ` (${target})` : ''}`,
    `Budget: ${budgetUsd === undefined ? 'none given' : `$${budgetUsd}`}`,
    `Campaign options:\n${optionLines.join('\n')}`,
    `Computed metrics (whole town, ${metrics.scored} scored residents): ${metrics.inTarget} in target; ${metrics.interested} interested (visit >= 0.5), ${metrics.interestedInTarget} of them in target; ` +
      `expected visits ${metrics.expectedVisits.toFixed(1)}; expected shares ${metrics.expectedShares.toFixed(1)}`,
    `Excluded from the simulation: ${excludedUnderage} residents under age ${MIN_DECISION_AGE}${excludedUnderage === 0 ? ' (none)' : ' (assumed not to be decision-makers for this idea)'}`,
    `Residents (probabilities are simulated, raw, uncalibrated):\n${rows.join('\n')}`,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Claude calls
// ---------------------------------------------------------------------------

interface ClaudeCall {
  model: typeof models.ideaParse | typeof models.ideaAnalysis;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  what: string;
}

/** One structured Claude call. Returns the parsed JSON (not yet validated) and the token usage. */
async function askClaude(apiKey: string, call: ClaudeCall): Promise<{ parsed: unknown; usage: Anthropic.Usage }> {
  const client = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: call.model.id,
      max_tokens: call.model.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content: call.user }],
      output_config: { effort: call.model.effort, format: { type: 'json_schema', schema: call.schema } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error(`Claude refused to ${call.what}.`);
  if (response.stop_reason === 'max_tokens') throw new Error(`Claude ran out of output tokens while trying to ${call.what}.`);
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new Error('Claude returned no text content.');

  try {
    return { parsed: JSON.parse(block.text), usage: response.usage };
  } catch (error) {
    throw new Error(`Claude's answer to "${call.what}" was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function costOf(model: ClaudeCall['model'], usage: Anthropic.Usage): number {
  return usage.input_tokens * model.usdPerInputToken + usage.output_tokens * model.usdPerOutputToken;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export async function testIdea(conn: DbConnection, job: Job): Promise<void> {
  const anthropicKey = config.anthropicApiKey;
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so ideas cannot be tested.');
  const jevKey = config.jevApiKey;
  if (!jevKey) throw new Error('JEV_API_KEY is not set on the worker, so ideas cannot be tested.');

  const id = BigInt(job.targetId);
  const row = conn.db.ideaTest.id.find(id);
  if (!row) throw new Error(`test_idea: unknown idea test ${job.targetId}`);
  if (row.status !== 'running') throw new Error(`test_idea: idea test ${id} is ${row.status}, not running`);
  const profile = conn.db.companyProfile.id.find(row.profileId);
  if (!profile) throw new Error(`test_idea: idea test ${id} references unknown profile ${row.profileId}`);
  const members = [...conn.db.audienceMember.iter()]
    .filter((m) => m.profileId === row.profileId && m.audienceVersion === profile.audienceVersion)
    .sort((a, b) => a.memberId - b.memberId);
  if (members.length === 0) throw new Error(`test_idea: no audience members for profile ${row.profileId} version ${profile.audienceVersion}`);
  const everyone = members.map((member): Resident => {
    const parsedProfile = parseProfile(member);
    return { member, profile: parsedProfile, age: ageOf(parsedProfile) };
  });
  const options = row.options;

  const started = performance.now();
  let claudeCost = 0;
  let claudeIn = 0;
  let claudeOut = 0;

  // 2. Parse the prompt.
  await setStage(conn, job, 'Reading the idea');
  const parseCacheParts = [models.ideaParse.id, PARSE_INSTRUCTIONS, PARSE_SCHEMA, row.prompt];
  let parsed = await lookup('idea-parse', parseCacheParts, validateParsedIdea);
  if (!parsed) {
    const { parsed: raw, usage } = await askClaude(anthropicKey, {
      model: models.ideaParse,
      system: PARSE_INSTRUCTIONS,
      user: row.prompt,
      schema: PARSE_SCHEMA,
      what: 'read the idea',
    });
    parsed = validateParsedIdea(raw);
    await store('idea-parse', parseCacheParts, parsed);
    claudeCost += costOf(models.ideaParse, usage);
    claudeIn += usage.input_tokens;
    claudeOut += usage.output_tokens;
  }
  const idea = parsed;

  // Young children are excluded from scoring, metrics and the analyst unless the target explicitly includes them. Unknown ages stay.
  const targetIncludesMinors =
    (idea.maxAge !== null && idea.maxAge < MIN_DECISION_AGE) || (idea.minAge !== null && idea.minAge < MIN_DECISION_AGE);
  const residents = targetIncludesMinors ? everyone : everyone.filter((r) => r.age === undefined || r.age >= MIN_DECISION_AGE);
  const excludedUnderage = everyone.length - residents.length;
  console.log(`[idea ${id}] excluded ${excludedUnderage} residents under age ${MIN_DECISION_AGE} (${residents.length} of ${everyone.length} kept)`);
  if (residents.length === 0) throw new Error(`test_idea: every resident is under age ${MIN_DECISION_AGE}, so there is nobody to score`);

  // 3. Score every resident.
  const questions = questionsFor(options);
  const mapKey = cacheKey([JEV_MODEL, questions, idea.idea, row.prompt, profile.name, profile.pitch]);
  const scoreMap = (await lookup('jev-idea-scores', mapKey, (v) => validateIdeaScoreMap(v, options.length))) ?? {};
  const states = new Map(residents.map((r) => [r.member.memberId, stateFor(r, profile, idea, row.prompt, options)]));
  const hashes = new Map([...states].map(([memberId, state]) => [memberId, cacheKey(state)]));

  const scores = new Map<number, RawIdeaScore>();
  let failed = 0;
  let firstError: string | undefined;
  let authError: JevAuthError | undefined;
  let inputTokens = 0;
  let cachedCount = 0;
  let scoredCount = 0;
  let done = 0;
  const asking = (n: number) => `Asking ${n}/${residents.length} residents`;
  await setStage(conn, job, asking(0));
  await pool(residents, Math.max(1, config.jevConcurrency), async (r) => {
    const memberId = r.member.memberId;
    try {
      if (done > 0 && done % PROGRESS_EVERY === 0) reportStage(conn, job, asking(done));
      const hash = hashes.get(memberId)!;
      const hit = scoreMap[hash];
      if (hit) {
        scores.set(memberId, hit);
        cachedCount++;
      } else {
        const body = await askJev(jevKey, states.get(memberId)!, questions);
        const raw: RawIdeaScore = {
          visit: noulAnswer(body, 'visit'),
          return: noulAnswer(body, 'return'),
          share: noulAnswer(body, 'share'),
          options: options.map((_, i) => noulAnswer(body, `option_${i}`)),
        };
        scoreMap[hash] = raw;
        scores.set(memberId, raw);
        inputTokens += inputTokensOf(body);
        scoredCount++;
      }
    } catch (error) {
      if (error instanceof JevAuthError) {
        authError ??= error;
        return false;
      }
      failed++;
      firstError ??= error instanceof Error ? error.message : String(error);
      console.error(`[idea ${id}] member ${memberId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    done++;
    return true;
  });
  // A bad key is not a per-member failure: fail the job with the real cause.
  if (authError) throw authError;
  if (scoredCount > 0) await store('jev-idea-scores', mapKey, scoreMap);

  // 4. Residents and metrics, in code.
  const inTarget = (age: number | undefined) =>
    idea.minAge === null && idea.maxAge === null ? true : age !== undefined && (idea.minAge === null || age >= idea.minAge) && (idea.maxAge === null || age <= idea.maxAge);
  const ideaResidents = residents.map((r): IdeaResident => {
    const score = scores.get(r.member.memberId);
    return {
      memberId: r.member.memberId,
      name: r.member.name,
      age: r.age ?? 0,
      groupId: r.member.groupId,
      inTarget: inTarget(r.age),
      pVisit: score?.visit ?? 0,
      pReturn: score?.return ?? 0,
      pShare: score?.share ?? 0,
      optionInterest: score?.options ?? options.map(() => 0),
      reason: '',
      missing: score === undefined,
    };
  });
  const metrics = computeMetrics(ideaResidents, options.length);
  if (metrics.scored === 0) throw new Error(`test_idea: no resident could be scored; first failure: ${firstError}`);

  // 5. The analyst.
  const scoredResidents = ideaResidents.filter((r) => !r.missing);
  const profiles = new Map(residents.map((r) => [r.member.memberId, r.profile]));
  const rows = scoredResidents.map((r) => residentRow(r, profiles.get(r.memberId)!));
  const userText = analysisInput(profile, idea, row.budgetUsd, options, metrics, rows, excludedUnderage);
  const citable = new Set(scoredResidents.map((r) => r.memberId));
  const analysisCacheParts = [models.ideaAnalysis.id, ANALYSIS_INSTRUCTIONS, ANALYSIS_SCHEMA, userText];
  let draft = await lookup('idea-analysis', analysisCacheParts, (v) => validateAnalysis(v, citable));
  if (draft) {
    await setStage(conn, job, 'Analysing the results (cached)');
  } else {
    await setStage(conn, job, 'Analysing the results');
    const { parsed: raw, usage } = await askClaude(anthropicKey, {
      model: models.ideaAnalysis,
      system: ANALYSIS_INSTRUCTIONS,
      user: userText,
      schema: ANALYSIS_SCHEMA,
      what: 'analyse the idea test',
    });
    draft = validateAnalysis(raw, citable);
    await store('idea-analysis', analysisCacheParts, raw);
    claudeCost += costOf(models.ideaAnalysis, usage);
    claudeIn += usage.input_tokens;
    claudeOut += usage.output_tokens;
  }

  const reasons = new Map(draft.reasons.map((r) => [r.memberId, r.reason]));
  const finalResidents = ideaResidents.map((r) => ({ ...r, reason: reasons.get(r.memberId) ?? '' }));

  await setStage(conn, job, 'Saving the result');
  await conn.reducers.setIdeaResult({
    id,
    idea: idea.idea,
    targetLabel: idea.targetLabel,
    minAge: idea.minAge ?? undefined,
    maxAge: idea.maxAge ?? undefined,
    residents: finalResidents,
    metrics,
    analysis: draft.analysis,
    plainJson: JSON.stringify(draft.plain),
  });

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const total = claudeCost + inputTokens * USD_PER_JEV_INPUT_TOKEN;
  console.log(
    `[idea ${id}] scored ${metrics.scored}/${residents.length}, missing ${failed}, ${metrics.inTarget} in target, ${cachedCount} cached / ${scoredCount} scored, ` +
      `${draft.reasons.length} cited, ${inputTokens} JEV input tokens, Claude ${claudeIn} in / ${claudeOut} out tokens, ${seconds}s, $${total.toFixed(4)}` +
      (firstError ? `; first failure: ${firstError}` : ''),
  );
}
