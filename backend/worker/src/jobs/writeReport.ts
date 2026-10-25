import Anthropic from '@anthropic-ai/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from '../config.ts';
import { buildGrounding, groundingText, type Grounding } from '../grounding.ts';
import { models } from '../models.ts';
import { lookup, store } from '../cache.ts';
import { setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Job, ReferenceExample, RewrittenHook, TimestampedNote } from '../module_bindings/types.ts';

const CACHE_DIR = new URL('../../cache/', import.meta.url);

export interface ReportDraft {
  summary: string;
  notes: TimestampedNote[];
  hooks: RewrittenHook[];
  references: { reelIndex: number; whyRelevant: string }[];
}

const text = { type: 'string' } as const;
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'notes', 'hooks', 'references'],
  properties: {
    summary: text,
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'severity', 'title', 'detail'],
        properties: { at: { type: 'number' }, severity: { type: 'string', enum: ['strength', 'risk', 'fix'] }, title: text, detail: text },
      },
    },
    hooks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'original', 'suggestion', 'rationale'],
        properties: { label: text, original: text, suggestion: text, rationale: text },
      },
    },
    references: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reelIndex', 'whyRelevant'],
        properties: { reelIndex: { type: 'integer' }, whyRelevant: text },
      },
    },
  },
} as const;

const INSTRUCTIONS = `You write the report for a small business that simulated how a short Instagram reel might spread through a synthetic audience. Use only the grounding provided in the user message. Do not invent numbers, quotes, accounts or facts that are not in it. Member probabilities come from a synthetic simulation, not from real people.

Return JSON matching the schema.

summary: 2-4 sentences on what the simulated run suggests and the single most important change to make. State plainly that the audience is simulated.

notes: 3-6 items. Each has 'at' (a real second inside the video), a severity ('strength', 'risk' or 'fix'), a short title and one or two sentences of detail. Tie each to a real moment in the transcript, on-screen text or analysis notes.

hooks: 2-3 rewritten openings. 'label' names the idea, 'original' quotes the video's current opening from the transcript or on-screen text, 'suggestion' is the new opening in the business's own tone, 'rationale' says why it should work for this audience.

references: 0-4 reference reels worth learning from. 'reelIndex' is the number in [R#] from the grounding, and 'whyRelevant' says in one or two sentences what this business can take from that reel. Use each reel at most once. If the grounding lists no reference reels, return [].`;

function fail(problem: string): never {
  throw new Error(`Claude's report was invalid: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fail(`${what} must be a non-empty string`);
  return value;
}

/** Throws on anything the model returned that the rest of the pipeline cannot trust. */
export function validateReport(value: unknown, durationSec: number, referenceCount: number): ReportDraft {
  if (!isRecord(value)) return fail('expected a JSON object');
  const { summary, notes, hooks, references } = value;
  if (!Array.isArray(notes)) return fail('notes must be an array');
  if (!Array.isArray(hooks)) return fail('hooks must be an array');
  if (!Array.isArray(references)) return fail('references must be an array');

  const checkedNotes = notes.map((item): TimestampedNote => {
    if (!isRecord(item)) return fail('notes entries must be objects');
    const { at, severity, title, detail } = item;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > durationSec) {
      return fail(`note timestamp ${JSON.stringify(at)} is outside 0-${durationSec}s`);
    }
    if (severity !== 'strength' && severity !== 'risk' && severity !== 'fix') return fail(`bad note severity ${JSON.stringify(severity)}`);
    return { at, severity, title: nonEmpty(title, 'note title'), detail: nonEmpty(detail, 'note detail') };
  });
  if (checkedNotes.length === 0) return fail('no notes');

  const checkedHooks = hooks.map((item): RewrittenHook => {
    if (!isRecord(item)) return fail('hooks entries must be objects');
    return {
      label: nonEmpty(item.label, 'hook label'),
      original: nonEmpty(item.original, 'hook original'),
      suggestion: nonEmpty(item.suggestion, 'hook suggestion'),
      rationale: nonEmpty(item.rationale, 'hook rationale'),
    };
  });
  if (checkedHooks.length === 0) return fail('no hooks');

  const seen = new Set<number>();
  const checkedRefs = references.map((item) => {
    if (!isRecord(item)) return fail('references entries must be objects');
    const { reelIndex } = item;
    if (typeof reelIndex !== 'number' || !Number.isInteger(reelIndex) || reelIndex < 0 || reelIndex >= referenceCount) {
      return fail(`reelIndex ${JSON.stringify(reelIndex)} is not one of the ${referenceCount} reference reels`);
    }
    if (seen.has(reelIndex)) return fail(`reelIndex ${reelIndex} is used twice`);
    seen.add(reelIndex);
    return { reelIndex, whyRelevant: nonEmpty(item.whyRelevant, 'reference whyRelevant') };
  });

  return { summary: nonEmpty(summary, 'summary'), notes: checkedNotes, hooks: checkedHooks, references: checkedRefs };
}

function referenceExample(reel: Grounding['references'][number], whyRelevant: string): ReferenceExample {
  const firstLine = reel.caption.split('\n')[0]?.trim() ?? '';
  const title = firstLine ? (firstLine.length > 80 ? `${firstLine.slice(0, 79).trimEnd()}…` : firstLine) : `@${reel.ownerUsername} reel`;
  return {
    title,
    account: `@${reel.ownerUsername}`,
    url: reel.url,
    observed: { plays: reel.plays, likes: reel.likes, comments: reel.comments },
    whyRelevant,
  };
}

function assumptionsFor(g: Grounding): string[] {
  const { run } = g;
  const pct = (x: number) => Math.round(x * 100);
  return [
    `The audience is synthetic: ${g.audienceSize} simulated members generated from the company profile, not real followers.`,
    `Starting exposure: ${pct(run.options.seedExposure)}% of the audience is shown the video in round 0 (declared assumption).`,
    'Share chance is calibrated to a declared 10% per exposure for a typical reel, far above real Instagram rates, so cascades are visible.',
    'Like and comment rates are calibrated to scraped public reels in the niche; watch-through is uncalibrated model output.',
    `Coverage: ${pct(g.metrics.coverage)}% of members had a valid prediction; ${g.metrics.missing} could not be scored.`,
    'Results rank versions against each other; they are not forecasts of real views.',
  ];
}

/** One Claude call for the report draft. Returns the validated draft and the token usage. */
async function draftWithClaude(apiKey: string, g: Grounding, userText: string): Promise<{ draft: ReportDraft; usage: Anthropic.Usage }> {
  const client = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: models.report.id,
      max_tokens: models.report.maxTokens,
      system: INSTRUCTIONS,
      messages: [{ role: 'user', content: userText }],
      output_config: { effort: models.report.effort, format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude refused to write this report.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens before finishing the report.');
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new Error('Claude returned no text content.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch (error) {
    throw new Error(`Claude's report was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { draft: validateReport(parsed, g.durationSec, g.references.length), usage: response.usage };
}

export async function writeReport(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so reports cannot be written.');

  const started = performance.now();
  const runId = BigInt(job.targetId);
  const g = buildGrounding(conn, runId);

  // Same grounding (same video, audience, seed and scores) and same prompt give the same report.
  const userText = `Grounding:\n\n${groundingText(g)}`;
  const cacheParts = [models.report.id, INSTRUCTIONS, SCHEMA, userText];
  let draft = await lookup('report', cacheParts, (value) => validateReport(value, g.durationSec, g.references.length));
  let usage: Anthropic.Usage | undefined;
  if (draft) {
    await setStage(conn, job, 'Writing the report (cached)');
  } else {
    await setStage(conn, job, 'Writing the report with Claude');
    ({ draft, usage } = await draftWithClaude(apiKey, g, userText));
    await store('report', cacheParts, draft);
  }

  const references = draft.references.map((r) => {
    const reel = g.references[r.reelIndex];
    if (!reel) throw new Error(`write_report: reference ${r.reelIndex} vanished from the grounding`);
    return referenceExample(reel, r.whyRelevant);
  });
  const assumptions = assumptionsFor(g);

  await conn.reducers.setReport({ runId, summary: draft.summary, notes: draft.notes, hooks: draft.hooks, references, assumptions });

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    new URL(`report-${runId}.json`, CACHE_DIR),
    JSON.stringify(
      { runId: runId.toString(), model: models.report.id, report: { ...draft, references, assumptions } },
      // Observed reel metrics are u64 (bigint), which JSON cannot hold natively.
      (_key, value: unknown) => (typeof value === 'bigint' ? Number(value) : value),
      2,
    ),
  );

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const counts = `${draft.notes.length} notes, ${draft.hooks.length} hooks, ${references.length} references`;
  if (!usage) {
    console.log(`[report ${runId}] ${counts}, cached, ${seconds}s`);
    return;
  }
  const cost = usage.input_tokens * models.report.usdPerInputToken + usage.output_tokens * models.report.usdPerOutputToken;
  console.log(`[report ${runId}] ${counts}, ${usage.input_tokens} in / ${usage.output_tokens} out tokens, ${seconds}s, $${cost.toFixed(4)}`);
}
