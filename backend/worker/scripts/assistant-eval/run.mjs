import Anthropic from '@anthropic-ai/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { config } from '../../src/config.ts';
import { models } from '../../src/models.ts';
import { cases, probes } from './cases.mjs';
import { JUDGE, PROPERTIES, judge, judgeCost } from './judge.mjs';
import { applyPromptVariant } from './prompts.mjs';

/**
 * Reliability suite for the marketing assistant: the follow-up chat over an
 * uploaded reel, the same chat over an idea test, and the A/B comparison
 * summary. Each case runs the worker's real prompt against fixed grounding,
 * then grades the answer with deterministic checks plus an LLM judge.
 *
 *   node --env-file=../../../../.env run.mjs [--reps 2] [--filter upload/]
 *                                    [--model claude-sonnet-5-5] [--effort medium]
 *                                    [--prompt v2]
 *
 * The three overrides exist so one arm can be compared against another on the
 * same cases: a bigger model, more thinking, or a different prompt.
 *
 * Attempts that never produced a scorable answer (rate limits, timeouts, a
 * refusal, a truncated reply) go to errors.jsonl, never into the pass rate:
 * plumbing must not be able to masquerade as a model failure.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const REPS = Number(flag('reps', '2'));
const CONCURRENCY = Number(flag('concurrency', '4'));
const FILTER = flag('filter', '');
const MODEL = flag('model', models.chat.id);
const EFFORT = flag('effort', models.chat.effort);
const PROMPT = flag('prompt', 'v1');
const MAX_ATTEMPTS = 3;
const ARM = `${MODEL}-${EFFORT}-prompt${PROMPT}`;
const OUT_DIR = new URL(`../../.tmp/assistant-eval/${new Date().toISOString().replace(/[:.]/g, '-')}-${ARM}/`, import.meta.url);

if (!config.anthropicApiKey) {
  console.error('ANTHROPIC_API_KEY is not set. Run with: node --env-file=../../../../.env run.mjs');
  process.exit(2);
}

const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
const selected = cases.filter((c) => !FILTER || c.id.includes(FILTER));
if (selected.length === 0) {
  console.error(`No cases match --filter ${FILTER}`);
  process.exit(2);
}

/** Per-million rates for the arm's model, so cost is not read off a flat assumption. */
const RATES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
if (!RATES[MODEL]) {
  console.error(`No price on file for ${MODEL}; add it to RATES in run.mjs before measuring cost.`);
  process.exit(2);
}
const PRICE = { input: RATES[MODEL].input / 1_000_000, output: RATES[MODEL].output / 1_000_000 };

const spend = { model: 0, judge: 0, modelTokens: { input: 0, output: 0 }, judgeTokens: { input: 0, output: 0 } };
const errors = [];
const results = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retryable: rate limits, overload, 5xx and connection failures. */
function retryable(error) {
  if (error instanceof Anthropic.APIConnectionError) return true;
  const status = error?.status;
  return status === 408 || status === 429 || status === 529 || (typeof status === 'number' && status >= 500);
}

async function withRetries(what, call) {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      return { value: await call(), attempts };
    } catch (error) {
      if (!retryable(error) || attempts >= MAX_ATTEMPTS) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts, what });
      }
      // Jittered backoff: a tight retry loop turns one 429 into a torn-down run.
      await sleep(Math.round((2 ** attempts) * 400 * (0.5 + Math.random())));
    }
  }
}

function answerOf(response) {
  if (response.stop_reason === 'refusal') return { failure: 'refusal' };
  if (response.stop_reason === 'max_tokens') return { failure: 'truncated' };
  const block = response.content.find((b) => b.type === 'text');
  if (!block) return { failure: 'no_text_block' };
  const text = block.text.trim();
  if (text.length === 0) return { failure: 'empty_text' };
  return { text };
}

/** The shipped request, with whichever arm overrides this run applies. */
function requestFor(testCase) {
  const { params, grounding } = testCase.request();
  const armed = { ...params, model: MODEL, output_config: { ...params.output_config, effort: EFFORT } };
  // The comparison summary has its own system prompt, so a chat variant does
  // not apply to it; swapping it in anyway would measure the wrong prompt.
  if (testCase.subject !== 'abtest') armed.system = applyPromptVariant(params.system, PROMPT);
  return { params: armed, grounding };
}

/** Style facts recorded for every answer, reported as metrics rather than graded. */
function style(answer) {
  return {
    words: answer.trim().split(/\s+/).length,
    markdown: /(^|\n)\s*[-*\u2022]\s|\*\*|(^|\n)#{1,6}\s/.test(answer),
    mmss: /\b\d{1,2}:\d{2}\b/.test(answer),
  };
}

/** One (case, rep): the real request, the deterministic checks, then the judge. */
async function runOne(testCase, rep) {
  const { params, grounding } = requestFor(testCase);
  const started = performance.now();
  const { value: response, attempts } = await withRetries('assistant', () => client.messages.create(params));
  const latencyMs = Math.round(performance.now() - started);

  // A score served by a different model measures nothing.
  if (!response.model.startsWith(params.model)) {
    throw Object.assign(new Error(`asked for ${params.model}, served ${response.model}`), { attempts, what: 'served_model_mismatch' });
  }

  spend.modelTokens.input += response.usage.input_tokens;
  spend.modelTokens.output += response.usage.output_tokens;
  spend.model += response.usage.input_tokens * PRICE.input + response.usage.output_tokens * PRICE.output;

  const { text, failure } = answerOf(response);
  if (failure) throw Object.assign(new Error(`assistant produced no scorable answer (${failure})`), { attempts, what: failure });

  const checkFailures = testCase.checks
    .map((check) => ({ name: check.name, detail: check.test(text) }))
    .filter((check) => check.detail !== null);

  const { value: graded, attempts: judgeAttempts } = await withRetries('judge', () =>
    judge(client, { grounding, question: testCase.question, answer: text, rubric: testCase.rubric }));
  spend.judgeTokens.input += graded.usage.input_tokens;
  spend.judgeTokens.output += graded.usage.output_tokens;
  spend.judge += judgeCost(graded.usage);

  const judgeFailures = PROPERTIES.filter((property) => !graded.verdicts[property].pass)
    .map((property) => ({ name: property, detail: graded.verdicts[property].reason }));

  return {
    caseId: testCase.id,
    subject: testCase.subject,
    rep,
    pass: checkFailures.length === 0 && judgeFailures.length === 0,
    checkFailures,
    judgeFailures,
    model: response.model,
    judgeModel: graded.model,
    stopReason: response.stop_reason,
    latencyMs,
    attempts,
    judgeAttempts,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    judgeUsage: { input: graded.usage.input_tokens, output: graded.usage.output_tokens },
    question: testCase.question,
    answer: text,
    style: style(text),
    verdicts: graded.verdicts,
    groundingChars: grounding.length,
  };
}

async function pool(items, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Known-good and known-bad through the grader before anything is paid for in
 * bulk: if the oracle fails or a null answer passes, the suite is measuring
 * its own judge, not the assistant.
 */
async function calibrateJudge() {
  // The probes share the chat grounding, so they do not depend on the arm.
  console.log(`Calibrating the judge (${JUDGE.id}) on ${probes.length} probes...`);
  let broken = 0;
  let unreached = 0;
  await pool(probes, async (probe) => {
    const { grounding } = probe.case.request();
    let graded;
    try {
      ({ value: graded } = await withRetries('judge', () =>
        judge(client, { grounding, question: probe.case.question, answer: probe.answer, rubric: probe.case.rubric })));
    } catch (error) {
      console.log(`  ${probe.id}: ERROR ${error.message}`);
      unreached += 1;
      return;
    }
    spend.judgeTokens.input += graded.usage.input_tokens;
    spend.judgeTokens.output += graded.usage.output_tokens;
    spend.judge += judgeCost(graded.usage);
    const passed = PROPERTIES.every((property) => graded.verdicts[property].pass);
    const ok = probe.expect === 'pass' ? passed : !passed;
    if (!ok) broken += 1;
    const failed = PROPERTIES.filter((p) => !graded.verdicts[p].pass);
    console.log(`  ${ok ? 'ok  ' : 'BAD '} ${probe.id} (expected to ${probe.expect}) ${failed.length ? `failed: ${failed.join(', ')}` : 'passed every property'}`);
  });
  return { broken, unreached };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const usd = (n) => `$${n.toFixed(4)}`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const resultsFile = new URL('results.jsonl', OUT_DIR);
  const errorsFile = new URL('errors.jsonl', OUT_DIR);

  console.log(`Assistant reliability suite: ${selected.length} cases x ${REPS} reps.`);
  console.log(`Arm: model ${MODEL}, effort ${EFFORT}, chat prompt ${PROMPT}${MODEL === models.chat.id && EFFORT === models.chat.effort && PROMPT === 'v1' ? ' (what the worker ships)' : ''}.`);
  const { broken, unreached } = await calibrateJudge();
  if (unreached > 0) {
    console.error(`\n${unreached} probe(s) never reached the judge; the error above is the reason. Nothing was measured.`);
    process.exit(2);
  }
  if (broken > 0) {
    console.error(`\n${broken} judge probe(s) came out wrong. Fix the judge before trusting a full pass.`);
    process.exit(1);
  }

  const work = selected.flatMap((testCase) => Array.from({ length: REPS }, (_, rep) => ({ testCase, rep })));
  console.log(`\nRunning ${work.length} attempts at concurrency ${CONCURRENCY}...`);

  await pool(work, async ({ testCase, rep }) => {
    try {
      const row = await runOne(testCase, rep);
      results.push(row);
      appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      const reasons = [...row.checkFailures, ...row.judgeFailures].map((f) => f.name).join(', ');
      console.log(`  ${row.pass ? 'pass' : 'FAIL'} ${testCase.id} #${rep}${reasons ? ` [${reasons}]` : ''}`);
    } catch (error) {
      const row = {
        caseId: testCase.id, rep, failureClass: error.what ?? 'unknown',
        message: error.message, status: error.status ?? null, attempts: error.attempts ?? 1,
      };
      errors.push(row);
      appendFileSync(errorsFile, `${JSON.stringify(row)}\n`);
      console.log(`  ERROR ${testCase.id} #${rep} (${row.failureClass}): ${row.message}`);
    }
  });

  // --- report ---------------------------------------------------------------
  const byCase = new Map();
  for (const row of results) {
    const entry = byCase.get(row.caseId) ?? { pass: 0, total: 0, failures: new Map(), subject: row.subject };
    entry.total += 1;
    if (row.pass) entry.pass += 1;
    for (const failure of [...row.checkFailures, ...row.judgeFailures]) {
      entry.failures.set(failure.name, (entry.failures.get(failure.name) ?? 0) + 1);
    }
    byCase.set(row.caseId, entry);
  }

  console.log('\n--- per case -------------------------------------------------');
  for (const testCase of selected) {
    const entry = byCase.get(testCase.id);
    if (!entry) {
      console.log(`  n/a   ${testCase.id} (no scorable attempt; see errors.jsonl)`);
      continue;
    }
    const failures = [...entry.failures].map(([name, count]) => `${name} x${count}`).join(', ');
    console.log(`  ${entry.pass}/${entry.total} ${testCase.id}${failures ? `  <- ${failures}` : ''}`);
  }

  const failed = results.filter((row) => !row.pass);
  if (failed.length > 0) {
    console.log('\n--- failures in detail ---------------------------------------');
    for (const row of failed) {
      console.log(`\n[${row.caseId} #${row.rep}] ${row.question}`);
      for (const failure of row.checkFailures) console.log(`  check  ${failure.name}: ${failure.detail}`);
      for (const failure of row.judgeFailures) console.log(`  judge  ${failure.name}: ${failure.detail}`);
      console.log(`  answer: ${row.answer.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }

  const subjects = new Map();
  for (const row of results) {
    const entry = subjects.get(row.subject) ?? { pass: 0, total: 0 };
    entry.total += 1;
    if (row.pass) entry.pass += 1;
    subjects.set(row.subject, entry);
  }
  const propertyFailures = new Map();
  for (const row of results) {
    for (const failure of [...row.checkFailures, ...row.judgeFailures]) {
      propertyFailures.set(failure.name, (propertyFailures.get(failure.name) ?? 0) + 1);
    }
  }

  const latencies = results.map((row) => row.latencyMs);
  const chatRows = results.filter((row) => row.subject !== 'abtest');
  const words = chatRows.map((row) => row.style.words);
  const summary = {
    arm: ARM,
    model: MODEL,
    effort: EFFORT,
    promptVariant: PROMPT,
    judgeModel: JUDGE.id,
    reps: REPS,
    cases: selected.length,
    scored: results.length,
    passed: results.filter((row) => row.pass).length,
    errors: errors.length,
    bySubject: Object.fromEntries([...subjects].map(([key, value]) => [key, `${value.pass}/${value.total}`])),
    failuresByProperty: Object.fromEntries(propertyFailures),
    latencyMs: { p50: percentile(latencies, 50), p90: percentile(latencies, 90) },
    chatStyle: {
      wordsP50: percentile(words, 50),
      wordsP90: percentile(words, 90),
      overLengthShare: Number((chatRows.filter((row) => row.style.words > 180).length / Math.max(chatRows.length, 1)).toFixed(2)),
      markdownShare: Number((chatRows.filter((row) => row.style.markdown).length / Math.max(chatRows.length, 1)).toFixed(2)),
    },
    tokens: spend.modelTokens,
    judgeTokens: spend.judgeTokens,
    costUsd: { assistant: Number(spend.model.toFixed(4)), judge: Number(spend.judge.toFixed(4)), total: Number((spend.model + spend.judge).toFixed(4)) },
  };
  await writeFile(new URL('summary.json', OUT_DIR), `${JSON.stringify(summary, null, 2)}\n`);

  console.log('\n--- summary --------------------------------------------------');
  console.log(`  scored      ${summary.passed}/${summary.scored} attempts passed every check`);
  for (const [subject, ratio] of Object.entries(summary.bySubject)) console.log(`  ${subject.padEnd(11)} ${ratio}`);
  if (propertyFailures.size > 0) {
    console.log(`  failures    ${[...propertyFailures].map(([name, count]) => `${name} x${count}`).join(', ')}`);
  }
  console.log(`  infra       ${errors.length} attempt(s) never scored`);
  console.log(`  latency     p50 ${summary.latencyMs.p50}ms, p90 ${summary.latencyMs.p90}ms`);
  console.log(`  chat style  ${summary.chatStyle.wordsP50} words p50 / ${summary.chatStyle.wordsP90} p90, ${Math.round(summary.chatStyle.overLengthShare * 100)}% over 180 words, ${Math.round(summary.chatStyle.markdownShare * 100)}% used markdown`);
  console.log(`  cost        assistant ${usd(spend.model)} + judge ${usd(spend.judge)} = ${usd(spend.model + spend.judge)}`);
  console.log(`  written to  ${new URL('.', OUT_DIR).pathname.slice(1)}`);

  const brokenCases = [...byCase].filter(([, entry]) => entry.pass < entry.total).length;
  if (brokenCases > 0 || errors.length > 0 || byCase.size < selected.length) {
    console.error(`\n${brokenCases} case(s) failed at least one rep.`);
    process.exit(1);
  }
  console.log('\nEvery case passed every rep.');
}

await main();
