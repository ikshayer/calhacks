import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cases, loadAudience } from './fixtures.mjs'
import { memoryCache, hash } from './cache.mjs'
import { evaluate, renderReports, limits } from './analyze.mjs'
import { boundedTransport } from './transport.mjs'
import { createRng } from '../../src/lib/rng.ts'
import { askClaude, runIdeaPipeline } from '../../../backend/worker/src/jobs/ideaPipeline.ts'
import { askJev, JEV_MODEL } from '../../../backend/worker/src/jev.ts'
import { models } from '../../../backend/worker/src/models.ts'
import { VERDICT_THRESHOLDS } from '../../src/data/ideaVerdict.ts'

export function tasksFor(fixtures, repeats, seed) {
  const fresh = fixtures.flatMap((c) => Array.from({ length: repeats }, (_, repeat) => ({ taskId: `fresh/${c.id}/${repeat}`, mode: 'fresh', caseId: c.id, repeat })))
  const caseId = fixtures.find((c) => c.variant === 'original').id
  return [
    ...createRng(seed).shuffle(fresh),
    ...Array.from({ length: repeats }, (_, repeat) => ({ taskId: `fixed/${caseId}/${repeat}`, mode: 'fixed', caseId, repeat })),
    { taskId: 'cache-warm', mode: 'cache-warm', caseId, repeat: 0 },
    { taskId: 'cache-replay', mode: 'cache-replay', caseId, repeat: 0 },
  ]
}

export async function saveReports(directory, manifest, records) {
  const requestsFile = join(directory, 'requests.jsonl')
  const providers = {}
  const recoverable = new Set(records.filter((r) => r.error && !r.result && r.claudeOutputs?.some((c) => c.what === 'read the idea')).map((r) => r.taskId))
  const recordedScores = new Map()
  if (existsSync(requestsFile)) for (const line of readFileSync(requestsFile, 'utf8').trim().split('\n').filter(Boolean)) {
    const request = JSON.parse(line)
    if (recoverable.has(request.taskId) && request.request?.state && request.status === 200 && request.response?.answers) {
      if (!recordedScores.has(request.taskId)) recordedScores.set(request.taskId, new Map())
      recordedScores.get(request.taskId).set(hash({ state: request.request.state, questions: request.request.questions }), request.response)
    }
    const provider = new URL(request.url).hostname
    const model = request.response?.model ?? request.request?.model ?? 'unknown'
    const key = `${provider}/${model}`
    const totals = providers[key] ??= { attempts: 0, errors: 0, rateLimits: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, requestMs: 0 }
    totals.attempts++
    totals.errors += Number(Boolean(request.error) || request.status >= 400)
    totals.rateLimits += Number(request.status === 429)
    totals.requestMs += request.ms
    const usage = request.response?.usage
    for (const [key, field] of Object.entries({ inputTokens: 'input_tokens', outputTokens: 'output_tokens', cacheReadInputTokens: 'cache_read_input_tokens', cacheCreationInputTokens: 'cache_creation_input_tokens' })) totals[key] += usage?.[field] ?? 0
  }
  // Older/interrupted runner versions may have lost the final return value after analyst failure.
  // Reuse the production pipeline with recorded replies only; never make replacement API calls.
  for (const record of records.filter((r) => recoverable.has(r.taskId))) {
    const fixture = manifest.cases.find((c) => c.id === record.caseId)
    const parseReply = record.claudeOutputs.find((c) => c.what === 'read the idea').answer
    try {
      await runIdeaPipeline({ id: BigInt(manifest.tasks.findIndex((t) => t.taskId === record.taskId) + 1), profile: manifest.profile, members: manifest.members, prompt: fixture.prompt, budgetUsd: fixture.budgetUsd, options: fixture.options }, {
        concurrency: 1, cache: memoryCache(true), stage: async () => {},
        claude: async (call) => { if (call.what === 'read the idea') return parseReply; throw new Error(record.error) },
        jev: async (state, questions) => recordedScores.get(record.taskId)?.get(hash({ state, questions })) ?? { answers: {} },
        onScored: (snapshot) => {
          record.parsed = snapshot.parsed
          record.result = { idea: snapshot.parsed.idea, residents: snapshot.residents, metrics: snapshot.metrics }
          record.scoringRecoveredFromRecordedResponses = true
        },
      })
    } catch { /* Preserve the original pipeline failure even when scoring can be inspected. */ }
  }
  const report = evaluate(manifest, records)
  report.execution = { startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, stopReason: manifest.stopReason, datasetHash: manifest.datasetHash, modelAliases: manifest.modelAliases, providers }
  const { csv, markdown } = renderReports(report)
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(directory, 'summary.csv'), csv)
  const execution = ['## Execution', '', `Dataset SHA-256: \`${manifest.datasetHash}\``, '',
    `Started: ${manifest.startedAt}. Finished: ${manifest.finishedAt ?? 'incomplete'}.${manifest.stopReason ? ` Stopped: ${manifest.stopReason}.` : ''}`, '',
    '| Provider / observed model | HTTP attempts | Errors | Input tokens | Output tokens |', '|---|---:|---:|---:|---:|',
    ...Object.entries(providers).map(([key, value]) => `| ${key} | ${value.attempts} | ${value.errors} | ${value.inputTokens} | ${value.outputTokens} |`), '',
  ].join('\n')
  writeFileSync(join(directory, 'report.md'), markdown + '\n' + execution)
  const rows = ['taskId,memberId,name,visit,return,share,missing,inTarget,options', ...records.flatMap((r) => (r.result?.residents ?? []).map((p) => [r.taskId, p.memberId, p.name, p.pVisit, p.pReturn, p.pShare, p.missing, p.inTarget, JSON.stringify(p.optionInterest)].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')))]
  writeFileSync(join(directory, 'residents.csv'), rows.join('\n') + '\n')
  return report
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    live: { type: 'boolean' }, help: { type: 'boolean' }, report: { type: 'string' }, out: { type: 'string' }, resume: { type: 'string' },
    repeats: { type: 'string', default: '5' }, families: { type: 'string' }, seed: { type: 'string', default: '1337' },
    concurrency: { type: 'string', default: '8' }, 'max-requests': { type: 'string', default: '13500' }, 'timeout-ms': { type: 'string', default: '60000' },
    'pipeline-concurrency': { type: 'string', default: '8' },
  } })
  if (values.help || !values.live && !values.report) {
    console.log('Usage: npm run eval:ideas -- --live [--families boba,cafe] [--repeats 5] [--concurrency 8] [--pipeline-concurrency 8] [--max-requests 13500] [--timeout-ms 60000] [--out directory]\n       npm run eval:ideas -- --live --resume directory\n       npm run eval:ideas:report -- directory\nLive calls require JEV_API_KEY and ANTHROPIC_API_KEY. No database is contacted. Default: 12 families × 4 variants × 5 repeats × 50 residents, plus fixed-payload and cache checks. HTTP concurrency is a shared global limit.')
    return 0
  }
  if (values.report) {
    const directory = resolve(values.report)
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    const raw = readFileSync(join(directory, 'results.jsonl'), 'utf8').trim()
    const records = raw ? raw.split('\n').map((line) => JSON.parse(line)) : []
    const report = await saveReports(directory, manifest, records)
    console.log(`${report.passed ? 'PASS' : report.status === 'incomplete' ? 'INCOMPLETE' : 'FAIL'}: ${join(directory, 'report.md')}`)
    return report.passed ? 0 : 1
  }
  // Load credentials only for an explicitly live command; never import worker config.
  const envFile = new URL('../../../.env', import.meta.url)
  try { process.loadEnvFile(envFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const jevKey = process.env.JEV_API_KEY, anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!jevKey || !anthropicKey) throw new Error('Live evaluation requires JEV_API_KEY and ANTHROPIC_API_KEY (environment or repository-root .env).')
  const number = (name, min) => { const n = Number(values[name]); if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}`); return n }
  const repeats = number('repeats', 2), concurrency = number('concurrency', 1), seed = number('seed', 0)
  const pipelineConcurrency = number('pipeline-concurrency', 1)
  const maxRequests = number('max-requests', 1), timeoutMs = number('timeout-ms', 1)
  const requestedFamilies = values.families?.split(',')
  if (requestedFamilies?.some((f) => !cases.some((c) => c.family === f))) throw new Error('Unknown --families value')
  let fixtures = cases.filter((c) => !requestedFamilies || requestedFamilies.includes(c.family))
  const audience = loadAudience()
  let tasks = tasksFor(fixtures, repeats, seed)
  const directory = values.resume ? resolve(values.resume) : values.out ? resolve(values.out) : resolve('artifacts/idea-eval', new Date().toISOString().replaceAll(':', '-'))
  mkdirSync(directory, { recursive: true })
  if (!values.resume) {
    try { writeFileSync(join(directory, 'results.jsonl'), '', { flag: 'wx' }) } catch { throw new Error('Output already contains results; choose a new --out directory, --resume, or regenerate its report.') }
  }
  let manifest = {
    version: 1, startedAt: new Date().toISOString(), datasetHash: audience.datasetHash,
    profile: audience.profile, members: audience.members, memberIds: audience.members.map((m) => m.memberId),
    ages: Object.fromEntries(audience.members.map((m) => [m.memberId, JSON.parse(m.profileJson).age])),
    cases: fixtures, tasks, seed, concurrency, pipelineConcurrency, maxRequests, timeoutMs, limits, verdictThresholds: VERDICT_THRESHOLDS,
    modelAliases: { jev: JEV_MODEL, parser: models.ideaParse.id, analyst: models.ideaAnalysis.id },
    plannedResidentCalls: fixtures.length * repeats * audience.members.length + repeats * audience.members.length + audience.members.length,
    notes: 'Fictional residents; no observed customer labels. Fresh runs bypass all application caches. Provider caches and model alias revisions are outside this runner’s control.',
  }
  const records = []
  let priorAttempts = 0
  if (values.resume) {
    manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    if (manifest.datasetHash !== audience.datasetHash || hash(manifest.profile) !== hash(audience.profile) || hash(manifest.members) !== hash(audience.members)) throw new Error('Cannot resume: persona dataset or profile changed')
    if (hash(manifest.modelAliases) !== hash({ jev: JEV_MODEL, parser: models.ideaParse.id, analyst: models.ideaAnalysis.id }) || hash(manifest.limits) !== hash(limits)) throw new Error('Cannot resume: models or tolerances changed')
    const raw = readFileSync(join(directory, 'results.jsonl'), 'utf8').trim()
    if (raw) records.push(...raw.split('\n').map((line) => JSON.parse(line)))
    if (existsSync(join(directory, 'requests.jsonl'))) for (const line of readFileSync(join(directory, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean)) priorAttempts = Math.max(priorAttempts, JSON.parse(line).sequence)
    priorAttempts = Math.max(priorAttempts, manifest.actualHttpAttempts ?? 0)
    fixtures = manifest.cases
    tasks = manifest.tasks
    manifest.resumptions = [...(manifest.resumptions ?? []), { at: new Date().toISOString(), completedTasks: records.length, pipelineConcurrency, concurrency, recordedPriorAttempts: priorAttempts }]
    delete manifest.finishedAt
    delete manifest.stopReason
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(directory, 'dataset.json'), JSON.stringify(audience.world, null, 2))
  const context = new AsyncLocalStorage()
  const taskAttempts = new Map()
  const transport = boundedTransport({ maxRequests, timeoutMs, maxConcurrent: concurrency, startCount: priorAttempts, secrets: [jevKey, anthropicKey], onRequest: (request) => {
    const taskId = context.getStore()
    taskAttempts.set(taskId, (taskAttempts.get(taskId) ?? 0) + 1)
    appendFileSync(join(directory, 'requests.jsonl'), JSON.stringify({ taskId, ...request, requestHash: hash(request.request) }) + '\n')
  } })
  const interrupt = () => transport.stop('Interrupted; completed results were preserved')
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  const cache = memoryCache()
  if (values.resume && existsSync(join(directory, 'cache.json'))) for (const [key, value] of JSON.parse(readFileSync(join(directory, 'cache.json'), 'utf8'))) cache.entries.set(key, value)
  const frozenSources = new Map()
  for (const r of records) if (r.mode === 'fresh' && r.result && !r.error && r.caseId.endsWith('/original') && !frozenSources.has(r.caseId)) frozenSources.set(r.caseId, { claudeOutputs: r.claudeOutputs, hashes: new Set(r.jevRequestHashes) })
  let consecutiveFailures = 0
  console.log(`Live evaluation: ${manifest.plannedResidentCalls} planned resident calls; ${tasks.length} pipeline runs; output ${directory}`)
  const completed = new Set(records.map((r) => r.taskId))
  const execute = async (task) => context.run(task.taskId, async () => {
      const index = tasks.findIndex((t) => t.taskId === task.taskId)
      const fixture = fixtures.find((c) => c.id === task.caseId)
      const started = performance.now()
      const claudeOutputs = [], jevPayloads = []
      const taskCache = task.mode.startsWith('cache-') ? cache : memoryCache(true)
      const cacheBefore = taskCache.events.length
      const source = frozenSources.get(fixture.id)
      const record = { ...task, startedAt: new Date().toISOString() }
      try {
        if (task.mode === 'fixed' && !source) throw new Error('No successful original run available for fixed-payload diagnostics')
        const output = await runIdeaPipeline({
          id: BigInt(index + 1), profile: audience.profile, members: audience.members,
          prompt: fixture.prompt, budgetUsd: fixture.budgetUsd, options: fixture.options,
        }, {
          cache: taskCache, concurrency,
          stage: async () => {},
          onScored: (snapshot) => {
            record.parsed = snapshot.parsed
            record.result = { id: BigInt(index + 1), idea: snapshot.parsed.idea, residents: snapshot.residents, metrics: snapshot.metrics }
          },
          claude: async (call) => {
            const answer = task.mode === 'fixed'
              ? structuredClone(source.claudeOutputs.find((c) => c.what === call.what).answer)
              : await askClaude(anthropicKey, call, { fetch: transport.fetch, maxRetries: 0 })
            if (task.mode === 'fixed') answer.usage = { ...answer.usage, input_tokens: 0, output_tokens: 0 }
            claudeOutputs.push({ what: call.what, requestHash: hash(call), answer })
            return answer
          },
          jev: async (state, questions) => {
            const payload = { state, questions }
            if (task.mode === 'fixed' && !source.hashes.has(hash(payload))) throw new Error('Fixed-payload state unexpectedly changed')
            jevPayloads.push(payload)
            return askJev(jevKey, state, questions, { fetch: transport.fetch, timeoutMs })
          },
        })
        Object.assign(record, output)
        if (task.mode === 'fresh' && fixture.variant === 'original' && !source && !frozenSources.has(fixture.id)) frozenSources.set(fixture.id, { claudeOutputs, hashes: new Set(jevPayloads.map(hash)) })
      } catch (error) {
        record.error = transport.redact(error instanceof Error ? error.message : error)
        // Authentication failures must stop the evaluation instead of producing thousands of failures.
        if (/rejected the API key|Authentication rejected/.test(record.error)) transport.stop(record.error)
      }
      consecutiveFailures = record.error && !record.result ? consecutiveFailures + 1 : 0
      if (consecutiveFailures >= 3) transport.stop('Three consecutive pipeline failures; see results.jsonl and requests.jsonl for causes')
      Object.assign(record, { ms: performance.now() - started, apiCalls: taskAttempts.get(task.taskId) ?? 0, claudeOutputs, cacheEvents: taskCache.events.slice(cacheBefore), jevRequestHashes: jevPayloads.map(hash) })
      records.push(record)
      appendFileSync(join(directory, 'results.jsonl'), JSON.stringify(record, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n')
      if (task.mode.startsWith('cache-')) writeFileSync(join(directory, 'cache.json'), JSON.stringify([...cache.entries]))
      console.log(`[${records.length}/${tasks.length}] ${task.taskId}: ${record.error ?? `${record.result.metrics.scored}/${audience.members.length} scored`}; HTTP ${record.apiCalls}; ${(record.ms / 1000).toFixed(1)}s`)
  })
  try {
    const pending = tasks.filter((t) => t.mode === 'fresh' && !completed.has(t.taskId))
    let next = 0
    await Promise.all(Array.from({ length: Math.min(pipelineConcurrency, pending.length) }, async () => {
      while (next < pending.length && !transport.stopped) await execute(pending[next++])
    }))
    for (const task of tasks.filter((t) => t.mode !== 'fresh' && !completed.has(t.taskId))) {
      if (transport.stopped) break
      await execute(task)
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    manifest.finishedAt = new Date().toISOString()
    manifest.actualHttpAttempts = transport.count
    manifest.stopReason = transport.reason
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const report = await saveReports(directory, manifest, records)
    console.log(`${report.passed ? 'PASS' : report.status === 'incomplete' ? 'INCOMPLETE' : 'FAIL'}: ${join(directory, 'report.md')}`)
  }
  return evaluate(manifest, records).passed ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code }).catch((error) => { console.error(error.message); process.exitCode = 2 })
}
