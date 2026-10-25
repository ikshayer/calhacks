import assert from 'node:assert/strict'
import test from 'node:test'
import { runIdeaPipeline, computeMetrics, validateParsedIdea, validateIdeaScoreMap, validateAnalysis, validatePlain, questionsFor, askClaude } from '../../../backend/worker/src/jobs/ideaPipeline.ts'
import { askJev, noulAnswer, inputTokensOf, JevAuthError } from '../../../backend/worker/src/jev.ts'
import { verdictOf } from '../../src/data/ideaVerdict.ts'
import { memoryCache } from './cache.mjs'
import { cases, loadAudience } from './fixtures.mjs'
import { main } from './run.mjs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const usage = { input_tokens: 10, output_tokens: 10 }
export const parsed = { idea: 'A local shop', targetLabel: 'ages 18-21', minAge: 18, maxAge: 21 }
export function analyst() {
  const pair = { what: 'Try a small event.', because: 'The simulated residents provide limited evidence.' }
  return {
    recommendedCampaign: 'No option recommended.', evidence: ['Simulated probabilities only.'], segments: ['Residents ages 18-21.'],
    objections: ['Cost.'], budgetAllocation: 'No budget comparison.', experiment: 'Run a small event.', successMetric: 'Count visitors.',
    assumptions: ['Local access.'], limitations: ['Fictional residents and uncalibrated probabilities.'], reasons: [{ memberId: 0, reason: 'A is interested.' }],
    plain: { answer: { text: 'There is some interest.', because: 'The simulated residents have mixed interests.' }, bestBet: pair, experiment: pair, howYouKnow: pair, objections: [{ reason: 'Cost.', because: 'A has limited funds.' }] },
  }
}
export function input() {
  const { profile, members } = loadAudience()
  return {
    id: 1n, profile, members: [18, 21, 22, undefined].map((age, memberId) => ({ ...members[memberId], memberId, persona: String(memberId), profileJson: JSON.stringify({ age, occupation: 'student' }) })),
    prompt: 'A local shop for ages 18-21.', options: [],
  }
}
export function dependencies(overrides = {}) {
  return {
    cache: memoryCache(), concurrency: 2, stage: async () => {},
    claude: async (call) => ({ parsed: call.what === 'read the idea' ? parsed : analyst(), usage }),
    jev: async (state, questions) => ({
      answers: Object.fromEntries(Object.keys(questions).map((q) => [q, { noul: q === 'visit' ? [.299999, .3, .5, 1][Number(state.person.habits)] : .4 }])),
      usage: { input_tokens: 10 },
    }), ...overrides,
  }
}

test('verdict boundaries include exact cutoffs and exclude missing predictions', () => {
  for (const [pVisit, expected] of [[0, 'not'], [.299999, 'not'], [.3, 'maybe'], [.499999, 'maybe'], [.5, 'going'], [1, 'going']]) assert.equal(verdictOf({ pVisit, missing: false }), expected)
  assert.equal(verdictOf({ pVisit: 1, missing: true }), undefined)
})

test('48 realistic fixtures preserve paraphrase facts and change only price in contrasts', () => {
  assert.equal(cases.length, 48)
  assert.equal(new Set(cases.map((c) => c.family)).size, 12)
  for (const original of cases.filter((c) => c.variant === 'original')) {
    const siblings = cases.filter((c) => c.family === original.family)
    for (const c of siblings) {
      assert.deepEqual(c.expectedAge, original.expectedAge)
      assert.deepEqual(c.options, original.options)
      assert.ok(c.prompt.includes(`$${c.facts.price}`))
      if (c.variant !== 'contrast') assert.deepEqual(c.facts, original.facts)
      else {
        assert.deepEqual({ ...c.facts, price: original.facts.price }, original.facts)
        assert.equal(c.prompt, original.prompt.replace(`$${original.facts.price}`, `$${c.facts.price}`))
      }
    }
  }
  const a = loadAudience(), b = loadAudience()
  assert.equal(a.members.length, 50)
  assert.equal(a.datasetHash, b.datasetHash)
  assert.deepEqual(a.members, b.members)
  assert.ok(a.members.every((m) => JSON.parse(m.profileJson).occupation))
})

test('pipeline uses production questions, target bounds, all residents and metrics', async () => {
  const output = await runIdeaPipeline(input(), dependencies())
  assert.deepEqual(output.result.residents.map((r) => r.inTarget), [true, true, false, false])
  assert.deepEqual(output.result.residents.map(verdictOf), ['not', 'maybe', 'going', 'going'])
  assert.equal(output.result.metrics.scored, 4)
  assert.equal(output.result.metrics.interested, 2)
  assert.equal(output.result.metrics.interestedInTarget, 0)
  assert.equal(output.result.metrics.expectedVisits, .299999 + .3 + .5 + 1)
  assert.equal(output.result.metrics.expectedShares, (.299999 + .3 + .5 + 1) * .4)
  assert.deepEqual(Object.keys(questionsFor([])), ['visit', 'return', 'share'])
})

test('age-unbounded audience includes unknown ages; one-sided bounds are inclusive', async () => {
  for (const bounds of [{ minAge: null, maxAge: null }, { minAge: 21, maxAge: null }, { minAge: null, maxAge: 21 }]) {
    const output = await runIdeaPipeline(input(), dependencies({ claude: async (call) => ({ parsed: call.what === 'read the idea' ? { ...parsed, ...bounds } : analyst(), usage }) }))
    const expected = bounds.minAge === null && bounds.maxAge === null ? [true, true, true, true] : bounds.minAge === 21 ? [false, true, true, false] : [true, true, false, false]
    assert.deepEqual(output.result.residents.map((r) => r.inTarget), expected)
  }
})

test('zero, one and three campaign options have matching questions and weighted metrics', async () => {
  for (const n of [0, 1, 3]) {
    const data = input()
    data.options = Array.from({ length: n }, (_, i) => ({ name: `Campaign ${i}`, costUsd: i * 50 }))
    const output = await runIdeaPipeline(data, dependencies())
    assert.equal(Object.keys(questionsFor(data.options)).length, 3 + n)
    assert.deepEqual(output.result.metrics.optionVisits, Array(n).fill(output.result.metrics.expectedVisits * .4))
    assert.ok(output.result.residents.every((r) => r.optionInterest.length === n))
  }
})

test('isolated cache replays all output exactly and makes zero external calls', async () => {
  let calls = 0
  const deps = dependencies()
  const claude = deps.claude, jev = deps.jev
  deps.claude = (...args) => { calls++; return claude(...args) }
  deps.jev = (...args) => { calls++; return jev(...args) }
  const first = await runIdeaPipeline(input(), deps)
  assert.equal(calls, 6)
  calls = 0
  const second = await runIdeaPipeline(input(), deps)
  assert.equal(calls, 0)
  assert.equal(second.cachedCount, 4)
  assert.deepEqual(first.result, second.result)
})

test('cache invalidates prompt, profile and options; disabled cache always calls APIs', async () => {
  const deps = dependencies()
  await runIdeaPipeline(input(), deps)
  const promptChange = await runIdeaPipeline({ ...input(), prompt: 'A different local shop.' }, deps)
  assert.equal(promptChange.scoredCount, 4)
  const data = input()
  data.members[0].profileJson = JSON.stringify({ age: 19, occupation: 'teacher' })
  assert.equal((await runIdeaPipeline(data, deps)).scoredCount, 1)
  data.options = [{ name: 'New flyer', costUsd: 1 }]
  assert.equal((await runIdeaPipeline(data, deps)).scoredCount, 4)
  const fresh = dependencies({ cache: memoryCache(true) })
  await runIdeaPipeline(input(), fresh)
  assert.equal((await runIdeaPipeline(input(), fresh)).scoredCount, 4)
})

test('invalid cached scores are validated and recomputed', async () => {
  const deps = dependencies()
  await runIdeaPipeline(input(), deps)
  for (const [key] of deps.cache.entries) if (key.startsWith('jev-idea-scores/')) deps.cache.entries.set(key, { bad: { visit: -1 } })
  assert.equal((await runIdeaPipeline(input(), deps)).scoredCount, 4)
  assert.ok(deps.cache.events.some((e) => e.invalid))
})

test('partial failure is missing, excluded from metrics, and retried on replay', async () => {
  let fail = true
  const deps = dependencies()
  const jev = deps.jev
  deps.jev = async (state, questions) => { if (fail && state.person.habits === '0') throw new Error('Timeout'); return jev(state, questions) }
  const a = await runIdeaPipeline(input(), deps)
  assert.equal(a.result.residents[0].missing, true)
  assert.equal(a.result.metrics.scored, 3)
  assert.equal(verdictOf(a.result.residents[0]), undefined)
  fail = false
  const b = await runIdeaPipeline(input(), deps)
  assert.equal(b.scoredCount, 1)
  assert.equal(b.cachedCount, 3)
})

test('bad usage metadata cannot leave a failed resident marked as scored or cached', async () => {
  const deps = dependencies()
  const jev = deps.jev
  deps.jev = async (...args) => { const body = await jev(...args); if (args[0].person.habits === '0') delete body.usage; return body }
  const output = await runIdeaPipeline(input(), deps)
  assert.equal(output.result.residents[0].missing, true)
  assert.equal(output.result.metrics.scored, 3)
  assert.equal(output.scoredCount, 3)
  for (const value of [NaN, Infinity, -1, .5, '10', undefined]) assert.throws(() => inputTokensOf({ usage: { input_tokens: value } }))
  assert.equal(inputTokensOf({ usage: { input_tokens: 0 } }), 0)
})

test('scoring observer retains valid scores when the later analyst fails', async () => {
  let snapshot
  await assert.rejects(runIdeaPipeline(input(), dependencies({
    claude: async (call) => { if (call.what === 'read the idea') return { parsed, usage }; throw new Error('Analyst token exhaustion') },
    onScored: (value) => { snapshot = value },
  })), /Analyst token exhaustion/)
  assert.equal(snapshot.metrics.scored, 4)
  assert.equal(snapshot.residents.length, 4)
  assert.deepEqual(snapshot.parsed, parsed)
})

test('budget absence, zero and positive values reach the analyst without invention', async () => {
  for (const budgetUsd of [undefined, 0, 500]) {
    const deps = dependencies()
    const claude = deps.claude
    deps.claude = async (call) => {
      if (call.what === 'analyse the idea test') assert.ok(call.user.includes(`Budget: ${budgetUsd === undefined ? 'none given' : `$${budgetUsd}`}`))
      return claude(call)
    }
    await runIdeaPipeline({ ...input(), budgetUsd }, deps)
  }
})

test('all failures fail the pipeline; auth stops scheduling new residents', async () => {
  await assert.rejects(runIdeaPipeline(input(), dependencies({ jev: async () => { throw new Error('unavailable') } })), /no resident could be scored/)
  let attempts = 0
  await assert.rejects(runIdeaPipeline(input(), dependencies({ concurrency: 1, jev: async () => { attempts++; throw new JevAuthError('bad key') } })), /bad key/)
  assert.equal(attempts, 1)
})

test('malformed profiles, duplicate identities, empty audience and invalid concurrency fail before APIs', async () => {
  for (const change of [
    (x) => { x.members = [] },
    (x) => { x.members[1].memberId = 0 },
    (x) => { x.members[0].profileJson = '{' },
    (x) => { x.members[0].profileJson = '[]' },
  ]) { const x = input(); change(x); await assert.rejects(runIdeaPipeline(x, dependencies({ claude: () => assert.fail('API called') }))) }
  await assert.rejects(runIdeaPipeline(input(), dependencies({ concurrency: NaN })), /positive integer/)
})

test('score validators reject malformed probabilities, absent answers, and stale option counts', () => {
  for (const value of [NaN, Infinity, -1, 1.01, '0.5', null, undefined]) {
    assert.throws(() => noulAnswer({ answers: { visit: { noul: value } } }, 'visit'), /invalid/)
    assert.throws(() => validateIdeaScoreMap({ a: { visit: value, return: .5, share: .5, options: [] } }, 0))
  }
  assert.throws(() => validateIdeaScoreMap({ a: { visit: .5, return: .5, share: .5, options: [] } }, 1))
  assert.throws(() => validateIdeaScoreMap([], 0))
  assert.throws(() => noulAnswer({}, 'visit'))
})

test('parser validates whole age bounds, order, range and required text', () => {
  for (const patch of [{ minAge: -1 }, { minAge: 18.5 }, { maxAge: 121 }, { minAge: 22 }, { minAge: undefined }, { idea: '' }, { targetLabel: ' ' }]) assert.throws(() => validateParsedIdea({ ...parsed, ...patch }))
})

test('analysis validates structure and removes invalid, duplicate and unscored citations', () => {
  const draft = analyst()
  draft.reasons.push({ memberId: 0, reason: 'duplicate' }, { memberId: 99, reason: 'not scored' })
  assert.deepEqual(validateAnalysis(draft, new Set([0])).reasons, [{ memberId: 0, reason: 'A is interested.' }])
  assert.throws(() => validateAnalysis({ ...draft, evidence: [] }, new Set([0])))
  assert.throws(() => validatePlain({ ...draft.plain, objections: [] }))
  assert.throws(() => validatePlain({ ...draft.plain, answer: {} }))
})

test('JEV rate limits retry with bounded backoff; auth and other failures do not retry', async () => {
  let calls = 0
  const waits = []
  const body = await askJev('test', {}, {}, { fetch: async () => ++calls < 3 ? new Response('', { status: 429 }) : Response.json({ answers: {} }), sleep: async (ms) => { waits.push(ms) } })
  assert.deepEqual(body, { answers: {} })
  assert.equal(calls, 3)
  assert.deepEqual(waits, [500, 1000])
  for (const status of [401, 403, 500]) {
    calls = 0
    await assert.rejects(askJev('test', {}, {}, { fetch: async () => { calls++; return new Response('error', { status }) } }), status === 500 ? /JEV 500/ : JevAuthError)
    assert.equal(calls, 1)
  }
  calls = 0
  await assert.rejects(askJev('test', {}, {}, { fetch: async () => { calls++; return new Response('', { status: 429 }) }, sleep: async () => {} }), /after 5 attempts/)
  assert.equal(calls, 5)
})

test('Claude transport handles valid JSON, refusal, token exhaustion and malformed output', async () => {
  const call = { model: { id: 'test', maxTokens: 100, effort: 'low' }, system: 'test', user: 'test', schema: { type: 'object' }, what: 'test' }
  const message = { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', stop_reason: 'end_turn', stop_sequence: null, usage, content: [{ type: 'text', text: JSON.stringify(parsed) }] }
  const transport = (patch) => ({ maxRetries: 0, fetch: async () => Response.json({ ...message, ...patch }) })
  assert.deepEqual((await askClaude('test-key', call, transport({}))).parsed, parsed)
  await assert.rejects(askClaude('test-key', call, transport({ stop_reason: 'refusal' })), /refused/)
  await assert.rejects(askClaude('test-key', call, transport({ stop_reason: 'max_tokens' })), /ran out/)
  await assert.rejects(askClaude('test-key', call, transport({ content: [{ type: 'text', text: '{' }] })), /not valid JSON/)
  await assert.rejects(askClaude('test-key', call, transport({ content: [] })), /no text/)
})

test('computeMetrics excludes missing rows from every total', () => {
  const scored = { missing: false, pVisit: .5, pShare: .4, inTarget: true, optionInterest: [.8] }
  assert.deepEqual(computeMetrics([scored, { ...scored, missing: true }], 1), { scored: 1, inTarget: 1, interested: 1, interestedInTarget: 1, expectedVisits: .5, expectedShares: .2, optionVisits: [.4] })
})

function fakeApi(_url, init) {
  const body = JSON.parse(init.body)
  if (String(_url).includes('api.typesafe.ai')) return Promise.resolve(Response.json({
    answers: Object.fromEntries(Object.keys(body.questions).map((q) => [q, { noul: .4 }])), usage: { input_tokens: 10 },
  }))
  assert.ok(String(_url).includes('api.anthropic.com'), `Unexpected network request: ${_url}`)
  const output = body.output_config.format.schema.required.includes('idea') ? parsed : analyst()
  return Promise.resolve(Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test', stop_reason: 'end_turn', stop_sequence: null, usage, content: [{ type: 'text', text: JSON.stringify(output) }] }))
}

test('database adapter and isolated pipeline produce the same result from identical API replies', async (t) => {
  // Only the adapter imports worker config. No real credentials or disk-cache writes are used.
  const env = { SPACETIME_DB: 'offline-test', WORKER_SECRET: 'test', JEV_API_KEY: 'test-jev', ANTHROPIC_API_KEY: 'test-anthropic', CACHE_DISABLED: '1' }
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const { testIdea } = await import('../../../backend/worker/src/jobs/testIdea.ts')
  t.mock.method(globalThis, 'fetch', fakeApi)
  const data = input()
  const row = { id: data.id, profileId: data.profile.id, status: 'running', prompt: data.prompt, options: [], budgetUsd: undefined }
  let saved
  const conn = {
    db: {
      ideaTest: { id: { find: () => row } }, companyProfile: { id: { find: () => data.profile } },
      audienceMember: { iter: () => [...data.members].reverse()[Symbol.iterator]() },
    },
    reducers: { setJobStage: async () => {}, setIdeaResult: async (result) => { saved = result } },
  }
  await testIdea(conn, { id: 1n, targetId: '1' })
  const isolated = await runIdeaPipeline(data, dependencies({
    jev: async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map((q) => [q, { noul: .4 }])), usage: { input_tokens: 10 } }),
  }))
  assert.deepEqual(saved, isolated.result)
  await assert.rejects(testIdea({ ...conn, db: { ...conn.db, ideaTest: { id: { find: () => undefined } } } }, { targetId: '1' }), /unknown idea test/)
})

test('live runner works end to end with a mocked network, writes artifacts and regenerates reports without API calls', async (t) => {
  process.env.JEV_API_KEY = 'test-jev'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic'
  let calls = 0
  t.mock.method(globalThis, 'fetch', (...args) => { calls++; return fakeApi(...args) })
  const directory = mkdtempSync(join(tmpdir(), 'idea-eval-test-'))
  try {
    assert.equal(await main(['--live', '--families', 'boba', '--repeats', '2', '--out', directory]), 0)
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')))
    assert.equal(manifest.tasks.length, 12)
    assert.equal(manifest.plannedResidentCalls, 550)
    assert.equal(calls, 568) // 8 fresh runs + 2 fixed runs + cache warm + zero-call replay.
    const report = JSON.parse(readFileSync(join(directory, 'report.json')))
    assert.equal(report.passed, true)
    assert.equal(report.groups.find((g) => g.kind === 'fixed').passed, true)
    assert.equal(await main(['--report', directory]), 0)
    assert.equal(calls, 568)
    assert.equal(await main(['--live', '--resume', directory]), 0)
    assert.equal(calls, 568)
    const resultsPath = join(directory, 'results.jsonl')
    const records = readFileSync(resultsPath, 'utf8').trim().split('\n')
    records.pop()
    writeFileSync(resultsPath, records.join('\n') + '\n')
    assert.equal(await main(['--report', directory]), 1)
    assert.equal(await main(['--live', '--resume', directory]), 0)
    assert.equal(calls, 568) // Durable isolated cache can replay across processes/resumptions.
    assert.ok(readFileSync(join(directory, 'residents.csv'), 'utf8').includes('memberId'))
  } finally {
    // The only recursively removed directory is the verified, freshly allocated test directory.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    assert.ok(directory.includes('idea-eval-test-'))
    rmSync(directory, { recursive: true })
  }
})

test('analyst failure stays a reliability failure while scored predictions remain available, including recovery from older logs', async (t) => {
  process.env.JEV_API_KEY = 'test-jev'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic'
  let failed = false, calls = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++
    const body = JSON.parse(init.body)
    if (!failed && body.output_config?.format.schema.required.includes('recommendedCampaign')) {
      failed = true
      return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test', stop_reason: 'max_tokens', stop_sequence: null, usage, content: [{ type: 'text', text: '{' }] })
    }
    return fakeApi(url, init)
  })
  const directory = mkdtempSync(join(tmpdir(), 'idea-eval-test-'))
  try {
    assert.equal(await main(['--live', '--families', 'boba', '--repeats', '2', '--out', directory]), 1)
    const resultsPath = join(directory, 'results.jsonl')
    const records = readFileSync(resultsPath, 'utf8').trim().split('\n').map(JSON.parse)
    const error = records.find((r) => r.error)
    assert.match(error.error, /ran out of output tokens/)
    assert.equal(error.result.metrics.scored, 50)
    assert.equal(JSON.parse(readFileSync(join(directory, 'report.json'))).groups.filter((g) => g.kind === 'fresh').every((g) => g.passed), true)
    // Simulate a pre-observer runner: restore predictions solely from recorded HTTP replies.
    delete error.result
    delete error.parsed
    writeFileSync(resultsPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const before = calls
    assert.equal(await main(['--report', directory]), 1)
    assert.equal(calls, before)
    const report = JSON.parse(readFileSync(join(directory, 'report.json')))
    assert.equal(report.groups.filter((g) => g.kind === 'fresh').every((g) => g.passed), true)
    assert.equal(report.inputSummaries.every((s) => s.residents.every((r) => r.samples === 2)), true)
    assert.ok(report.issues.some((i) => i.includes('ran out of output tokens')))
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    assert.ok(directory.includes('idea-eval-test-'))
    rmSync(directory, { recursive: true })
  }
})
