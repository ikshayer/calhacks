import assert from 'node:assert/strict'
import test from 'node:test'
import { compare, evaluate, renderReports } from './analyze.mjs'
import { memoryCache } from './cache.mjs'
import { tasksFor } from './run.mjs'
import { boundedTransport } from './transport.mjs'

const resident = (memberId, pVisit) => ({ memberId, name: `Person ${memberId}`, pVisit, pReturn: .5, pShare: .2, optionInterest: [], missing: false, inTarget: true })
const record = (taskId, values = [.2, .4, .7]) => ({ taskId, parsed: { minAge: null, maxAge: null }, result: { id: taskId, residents: values.map((v, i) => resident(i, v)) }, cachedCount: 0, apiCalls: 5 })
const fixture = (variant) => ({ id: `shop/${variant}`, family: 'shop', variant, expectedAge: { minAge: null, maxAge: null }, options: [] })
function dataset() {
  const cases = ['original', 'conversational', 'reordered', 'contrast'].map(fixture)
  const tasks = tasksFor(cases, 2, 1337)
  const manifest = { cases, tasks, memberIds: [0, 1, 2], ages: { 0: 18, 1: 30, 2: 70 } }
  const records = tasks.map((t) => ({ ...record(t.taskId), ...t }))
  const warm = records.find((r) => r.mode === 'cache-warm'), replay = records.find((r) => r.mode === 'cache-replay')
  replay.result = { ...structuredClone(warm.result), id: replay.taskId }
  replay.apiCalls = 0
  replay.cachedCount = 3
  return { manifest, records }
}

test('comparison joins resident ids and preserves agreement under reordering', () => {
  const a = record('a'), b = record('b')
  b.result.residents.reverse()
  const result = compare(a, b, [0, 1, 2])
  assert.equal(result.complete, true)
  assert.equal(result.agreement, 1)
  assert.equal(result.meanDrift, 0)
})

test('small threshold crossings are verdict changes; probability drift is reported separately', () => {
  const result = compare(record('a', [.49]), record('b', [.51]), [0])
  assert.equal(result.agreement, 0)
  assert.ok(Math.abs(result.meanDrift - .02) < 1e-12)
  assert.equal(result.rows[0].from, 'maybe')
  assert.equal(result.rows[0].to, 'going')
  assert.equal(result.rows[0].nearThreshold, true)
  assert.deepEqual(result.countChanges, { going: 1, maybe: -1, not: 0 })
})

test('missing, duplicate, unexpected and malformed resident predictions are never complete', () => {
  for (const mutate of [
    (r) => r.result.residents.pop(),
    (r) => { r.result.residents[0].missing = true },
    (r) => { r.result.residents[0].pVisit = NaN },
    (r) => { r.result.residents[0].memberId = 1 },
    (r) => { r.result.residents.push(resident(99, .7)) },
  ]) { const b = record('b'); mutate(b); assert.equal(compare(record('a'), b, [0, 1, 2]).complete, false) }
  assert.equal(compare(undefined, undefined, [0]).agreement, null)
})

test('complete stable data passes every independent gate and produces reports', () => {
  const { manifest, records } = dataset()
  const report = evaluate(manifest, records)
  assert.deepEqual(report.issues, [])
  assert.equal(report.passed, true)
  assert.equal(report.groups.filter((g) => g.kind === 'fresh').length, 4)
  assert.equal(report.groups.filter((g) => g.kind === 'paraphrase').length, 2)
  assert.ok(report.groups.every((g) => g.meanDrift === 0))
  const rendered = renderReports(report)
  assert.ok(rendered.markdown.includes('**PASS**'))
  assert.ok(rendered.csv.includes('"shop/original"'))
})

test('every repeat pair is evaluated, not just comparisons against the first repeat', () => {
  const cases = [fixture('original')]
  const tasks = tasksFor(cases, 5, 1)
  const manifest = { cases, tasks, memberIds: [0, 1, 2], ages: { 0: 18, 1: 30, 2: 70 } }
  const report = evaluate(manifest, tasks.map((t) => ({ ...record(t.taskId), ...t })))
  assert.equal(report.groups.find((g) => g.kind === 'fresh').comparisons, 10)
  assert.equal(report.groups.find((g) => g.kind === 'fixed').comparisons, 10)
})

test('bad input cannot hide behind good families, and contrast effects do not fail similarity', () => {
  const data = dataset()
  const bad = data.records.find((r) => r.caseId === 'shop/conversational' && r.repeat === 0)
  bad.result.residents = [resident(0, .9), resident(1, .9), resident(2, .9)]
  const report = evaluate(data.manifest, data.records)
  assert.equal(report.passed, false)
  assert.equal(report.groups.find((g) => g.kind === 'paraphrase' && g.id === 'shop/conversational').passed, false)
  const contrast = dataset()
  for (const r of contrast.records.filter((r) => r.caseId === 'shop/contrast')) r.result.residents = [resident(0, .01), resident(1, .01), resident(2, .01)]
  const result = evaluate(contrast.manifest, contrast.records)
  assert.equal(result.passed, true)
  assert.ok(result.contrasts.every((c) => c.meanDrift > .1))
})

test('incomplete, failed, duplicated and extra tasks cause failure', () => {
  for (const change of [
    (d) => { d.records.pop() },
    (d) => { d.records[0].error = 'timeout' },
    (d) => { d.records.push(d.records[0]) },
    (d) => { d.records.push(record('unexpected')) },
  ]) { const d = dataset(); change(d); const report = evaluate(d.manifest, d.records); assert.equal(report.passed, false); assert.ok(report.issues.length > 0) }
})

test('changed parser bounds, target flags, options and fresh-cache hits fail', () => {
  for (const change of [
    (r) => { r.parsed.minAge = 18 },
    (r) => { r.result.residents[0].inTarget = false },
    (r) => { r.result.residents[0].optionInterest = [.1] },
    (r) => { r.cachedCount = 1 },
  ]) { const d = dataset(); change(d.records.find((r) => r.mode === 'fresh')); assert.equal(evaluate(d.manifest, d.records).passed, false) }
})

test('cached replay requires every probability and analysis field identical with zero API calls', () => {
  for (const change of [
    (r) => { r.apiCalls = 1 },
    (r) => { r.cachedCount = 2 },
    (r) => { r.result.residents[0].pReturn = .5001 },
    (r) => { r.result.analysis = { evidence: ['changed'] } },
  ]) { const d = dataset(); change(d.records.find((r) => r.mode === 'cache-replay')); assert.equal(evaluate(d.manifest, d.records).groups.find((g) => g.kind === 'cache').passed, false) }
})

test('memory cache keys include model and prompt, and returns copies validated on read', async () => {
  const cache = memoryCache()
  const validate = (x) => x
  await cache.store('parse', ['model-a', 'prompt'], { value: 1 })
  const hit = await cache.lookup('parse', ['model-a', 'prompt'], validate)
  hit.value = 2
  assert.deepEqual(await cache.lookup('parse', ['model-a', 'prompt'], validate), { value: 1 })
  assert.equal(await cache.lookup('parse', ['model-b', 'prompt'], validate), undefined)
  assert.equal(await cache.lookup('parse', ['model-a', 'changed'], validate), undefined)
  assert.equal(await cache.lookup('parse', ['model-a', 'prompt'], () => { throw new Error('bad') }), undefined)
})

test('shuffled schedules are reproducible, cover every fixture and hold diagnostics until the end', () => {
  const cases = [fixture('original'), fixture('conversational')]
  const a = tasksFor(cases, 5, 1337)
  assert.deepEqual(a, tasksFor(cases, 5, 1337))
  assert.notDeepEqual(a, tasksFor(cases, 5, 42))
  assert.equal(a.filter((t) => t.mode === 'fresh').length, 10)
  assert.equal(a.at(-1).mode, 'cache-replay')
  assert.equal(a.at(-2).mode, 'cache-warm')
})

test('transport bounds actual attempts, redacts secrets, and excludes authentication headers from logs', async () => {
  const requests = []
  const transport = boundedTransport({ maxRequests: 1, secrets: ['secret-key'], fetcher: async () => Response.json({ message: 'secret-key' }), onRequest: (r) => requests.push(r) })
  await transport.fetch('https://example.com', { headers: { authorization: 'Bearer secret-key' }, body: '{}' })
  assert.equal(transport.count, 1)
  assert.ok(!JSON.stringify(requests).includes('secret-key'))
  assert.ok(!JSON.stringify(requests).includes('authorization'))
  await assert.rejects(transport.fetch('https://example.com'), /request limit/)
  assert.equal(transport.stopped, true)
})

test('transport deadlines abort stalled requests; authentication failure stops further attempts', async () => {
  const transport = boundedTransport({ timeoutMs: 5, fetcher: (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    // Keep event loop alive: AbortSignal.timeout timers are unref'ed.
    setTimeout(() => reject(new Error('Deadline did not abort')), 50).unref()
  }) })
  const keepAlive = setTimeout(() => {}, 100)
  try { await assert.rejects(transport.fetch('https://example.com'), /timeout/i) } finally { clearTimeout(keepAlive) }
  const auth = boundedTransport({ fetcher: async () => new Response('{}', { status: 401 }) })
  assert.equal((await auth.fetch('https://example.com')).status, 401)
  await assert.rejects(auth.fetch('https://example.com'), /Authentication rejected/)
  assert.equal(auth.count, 1)
})

test('shared transport concurrency bounds overlapping pipeline requests and keeps non-JSON HTTP errors inspectable', async () => {
  let active = 0, peak = 0
  const transport = boundedTransport({ maxConcurrent: 2, fetcher: async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    return new Response('<html>Unavailable</html>', { status: 503 })
  } })
  const replies = await Promise.all(Array.from({ length: 10 }, () => transport.fetch('https://example.com')))
  assert.equal(peak, 2)
  assert.ok(replies.every((r) => r.status === 503))
  assert.equal(transport.count, 10)
})

test('report uses frozen evaluation limits and refuses changed verdict thresholds', () => {
  const data = dataset()
  data.manifest.limits = {
    fresh: { agreement: 1, meanDrift: 0 }, fixed: { agreement: 1, meanDrift: 0 },
    paraphrase: { agreement: 1, meanDrift: 0 }, cache: { agreement: 1, meanDrift: 0 },
  }
  data.records.find((r) => r.mode === 'fresh' && r.caseId === 'shop/original').result.residents[0].pVisit += .001
  assert.equal(evaluate(data.manifest, data.records).groups.find((g) => g.id === 'shop/original' && g.kind === 'fresh').passed, false)
  data.manifest.verdictThresholds = { going: .6, maybe: .4 }
  assert.ok(evaluate(data.manifest, data.records).issues.some((i) => i.includes('thresholds changed')))
})
