import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Exercise the actual store with deterministic, offline sources. Do not load
// frontend/.env.local or contact the configured production database.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url)
      : specifier.startsWith('.') && context.parentURL ? new URL(specifier, context.parentURL) : undefined
    if (local) for (const candidate of [`${local.href}.ts`, `${local.href}/index.ts`]) {
      if (existsSync(new URL(candidate))) return { url: candidate, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/data/videoPoster.ts')) return { format: 'module', shortCircuit: true, source: 'export async function capturePoster() { return "test-poster" }' }
    const result = nextLoad(url, context)
    if (url.endsWith('/store/useAppStore.ts')) return { ...result, source: String(result.source).replaceAll('import.meta.env', '({VITE_DATA_SOURCE:"mock"})') }
    return result
  },
})

const { useAppStore, closeAllRunSubscriptions, VideoResultError } = await import('../src/store/useAppStore.ts')
const { sameRunAudience } = await import('../src/data/runCompatibility.ts')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const profile = { id: 'profile', name: 'Business', audienceVersion: 1, groups: [] }
const audience = { key: 'audience', version: 1, members: [], edges: [], adjacency: {} }
const signals = { hookStrength: .5, clarityOfAsk: .5, pacing: .5, warmth: .5, topics: [], durationSec: 18 }
const metrics = { uniqueExposed: 12, watch: 8, likes: 5, comments: 2, shares: 3, rounds: 2, coverage: 1, missing: 0, byGroup: [], spread: { p10: 12, p50: 18, p90: 25 } }
const report = { summary: 'Finished report', notes: [], hooks: [], references: [], assumptions: [] }
const round = (n) => ({ type: 'round', round: n, exposed: [n], acted: [], shares: [], ignored: [] })

test('comparison preparation starts before files exist and stays pending through analysis', async (t) => {
  const { source, calls } = fixture(t)
  const files = gate(), analysis = gate()
  const analyseVideo = source.analyseVideo
  source.analyseVideo = async (...args) => { await analysis.promise; return analyseVideo(...args) }
  const preparing = useAppStore.getState().prepareAbTest(() => files.promise)
  assert.equal(useAppStore.getState().abPreparation.status, 'preparing')
  assert.equal(useAppStore.getState().activeCampaignId, null)
  assert.equal(calls.starts, 0)

  files.resolve({ goal: '', a: { name: 'original.mp4', durationSec: 18 }, b: { name: 'reworked.mp4', durationSec: 20 } })
  await flush()
  assert.equal(useAppStore.getState().abPreparation.status, 'preparing')
  assert.equal(calls.starts, 0)

  analysis.resolve()
  await preparing
  assert.equal(useAppStore.getState().abPreparation, null)
  assert.ok(useAppStore.getState().ab)
  assert.equal(calls.starts, 2)
})

test('comparison file or analysis failures leave a recoverable workspace and can be retried', async (t) => {
  const { source, calls } = fixture(t)
  await assert.rejects(useAppStore.getState().prepareAbTest(async () => {
    throw new Error('Demo video unavailable')
  }), /Demo video unavailable/)
  assert.deepEqual(useAppStore.getState().abPreparation, { status: 'failed', error: 'Demo video unavailable' })
  assert.equal(calls.starts, 0)

  const analyseVideo = source.analyseVideo
  source.analyseVideo = async () => { throw new Error('Analysis unavailable') }
  const input = { goal: '', a: { name: 'original.mp4', durationSec: 18 }, b: { name: 'reworked.mp4', durationSec: 20 } }
  await assert.rejects(useAppStore.getState().prepareAbTest(async () => input), /Analysis unavailable/)
  assert.equal(useAppStore.getState().abPreparation.status, 'failed')

  source.analyseVideo = analyseVideo
  await useAppStore.getState().prepareAbTest(async () => input)
  assert.equal(useAppStore.getState().abPreparation, null)
  assert.equal(calls.starts, 2)
})

test('repeated comparison clicks share the pending preparation', async (t) => {
  const { calls } = fixture(t)
  const files = gate()
  const preparing = useAppStore.getState().prepareAbTest(() => files.promise)
  await useAppStore.getState().prepareAbTest(async () => { assert.fail('Must not load videos twice') })
  files.resolve({ goal: '', a: { name: 'original.mp4', durationSec: 18 }, b: { name: 'reworked.mp4', durationSec: 20 } })
  await preparing
  assert.equal(calls.starts, 2)
})

test('comparison sends 10% exposure for Original and 40% for Reworked and marks them as different settings', async (t) => {
  const { source, calls } = fixture(t, true)
  const starting = source.startRun
  const submitted = new Map()
  source.startRun = async (campaignId, videoId, label, options) => {
    const id = await starting()
    submitted.set(id, { videoId, options })
    return id
  }
  await useAppStore.getState().startAbTest({
    goal: 'Attract volunteers',
    a: { name: 'original.mp4', durationSec: 18 },
    b: { name: 'reworked.mp4', durationSec: 20 },
  })
  const state = useAppStore.getState()
  assert.equal(calls.starts, 2, 'an explicit comparison starts exactly one run per video')
  const a = submitted.get(state.ab.a.runId)
  const b = submitted.get(state.ab.b.runId)
  assert.equal(state.videos[a.videoId].name, 'original.mp4')
  assert.equal(state.videos[b.videoId].name, 'reworked.mp4')
  assert.equal(a.options.seedExposure, 0.1)
  assert.equal(b.options.seedExposure, 0.4)
  assert.equal(a.options.seed, b.options.seed)
  assert.equal(a.options.audienceKey, b.options.audienceKey)
  assert.equal(sameRunAudience(a.options, b.options), false)
})

test('a single demo after an A/B comparison starts one run and leaves comparison mode', async (t) => {
  const { calls } = fixture(t, true)
  await useAppStore.getState().startAbTest({
    goal: 'Attract volunteers',
    a: { name: 'original.mp4', durationSec: 18 },
    b: { name: 'reworked.mp4', durationSec: 20 },
  })
  const pair = useAppStore.getState().ab
  const starts = calls.starts
  const id = await useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Original demo')
  const state = useAppStore.getState()
  assert.equal(calls.starts - starts, 1)
  assert.equal(state.activeCampaignId, id)
  assert.equal(state.ab, null)
  assert.equal(state.compareRunId, null)
  assert.ok(state.runs[pair.a.runId], 'previous results remain in history')
  assert.ok(state.runs[pair.b.runId])
})

test('opening saved single-video results exits an earlier comparison without another run', async (t) => {
  const { calls } = fixture(t, true)
  const id = await useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Single demo')
  await useAppStore.getState().startAbTest({
    goal: '',
    a: { name: 'original.mp4', durationSec: 18 },
    b: { name: 'reworked.mp4', durationSec: 20 },
  })
  const starts = calls.starts
  useAppStore.getState().openCampaign(id)
  const state = useAppStore.getState()
  assert.equal(state.activeCampaignId, id)
  assert.equal(state.ab, null)
  assert.equal(state.compareRunId, null)
  assert.equal(calls.starts, starts)
})

function fixture(t, synchronous = false) {
  closeAllRunSubscriptions()
  const callbacks = new Map()
  const calls = { analyses: 0, starts: 0, closed: 0, reports: [] }
  const source = {
    kind: 'mock', label: 'Offline test',
    loadAudience: async () => audience,
    analyseVideo: async (campaignId, input) => ({ id: `video-${++calls.analyses}`, campaignId, label: 'Original', name: input.name, durationSec: 18, signals, summary: 'Analysis', objectUrl: '/demo/original.mp4' }),
    reviseSignals: async () => { throw new Error('Unexpected reanalysis') },
    startRun: async () => `run-${++calls.starts}`,
    subscribeRun: (id, callback) => {
      callbacks.set(id, callback)
      if (synchronous) { callback(round(0)); callback({ type: 'complete', metrics }) }
      return () => { calls.closed++; callbacks.delete(id) }
    },
    getDecisions: async () => [],
    getReport: async (id, retry = false) => { calls.reports.push(retry); return { ...report, runId: id } },
  }
  useAppStore.setState({ ...useAppStore.getInitialState(), source, profile, audience, videoPreparations: {} }, true)
  t.mock.method(console, 'error', () => {})
  t.after(() => closeAllRunSubscriptions())
  const emit = (id, event) => { const callback = callbacks.get(id); assert.ok(callback, `subscription exists for ${id}`); callback(event) }
  return { source, calls, emit }
}

test('one upload runs exactly once and waits for both report and decisions before revealing final results', async (t) => {
  const { source, calls, emit } = fixture(t)
  const reportGate = gate(), decisionsGate = gate()
  source.getReport = () => reportGate.promise
  source.getDecisions = () => decisionsGate.promise
  let resolved = false
  const creating = useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Upload').then((id) => { resolved = true; return id })
  await flush()
  const id = useAppStore.getState().activeCampaignId
  const concurrent = useAppStore.getState().prepareVideoResult(id)
  assert.equal(calls.starts, 1)
  emit('run-1', { type: 'status', status: 'scoring', note: 'Detailed stage' })
  emit('run-1', round(0)); emit('run-1', round(1)); emit('run-1', { type: 'complete', metrics })
  await flush()
  assert.equal(resolved, false)
  assert.equal(useAppStore.getState().campaigns[id].headline, undefined, 'the campaign card does not reveal partial results')
  reportGate.resolve({ ...report, runId: 'run-1' }); await flush()
  assert.equal(resolved, false, 'report alone is insufficient')
  decisionsGate.resolve([])
  assert.equal(await creating, id)
  assert.equal(await concurrent, 'run-1')
  const state = useAppStore.getState()
  assert.equal(state.playback.round, 2)
  assert.equal(state.playback.playing, false)
  assert.equal(state.runs['run-1'].report.summary, 'Finished report')
  assert.equal(state.videoPreparations[id], undefined)
  assert.equal(calls.starts, 1)
  assert.equal(calls.closed, 1)
})

test('synchronously cached completion resolves and subscription cleanup is safe', async (t) => {
  const { calls } = fixture(t, true)
  const id = await useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Demo')
  await useAppStore.getState().prepareVideoResult(id)
  assert.equal(calls.starts, 1)
  assert.equal(calls.closed, 1)
  assert.equal(useAppStore.getState().playback.round, 1)
})

test('a failed simulation only retries on explicit request and concurrent retries share one run', async (t) => {
  const { calls, emit } = fixture(t)
  const creating = useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Upload')
  const rejection = assert.rejects(creating, (error) => error instanceof VideoResultError && /Scoring failed/.test(error.message))
  await flush()
  const id = useAppStore.getState().activeCampaignId
  emit('run-1', { type: 'failed', reason: 'Scoring failed' })
  await rejection
  assert.equal(calls.starts, 1)
  const first = useAppStore.getState().prepareVideoResult(id)
  const second = useAppStore.getState().prepareVideoResult(id)
  await flush()
  assert.equal(calls.starts, 2)
  emit('run-2', { type: 'complete', metrics })
  assert.equal(await first, 'run-2')
  assert.equal(await second, 'run-2')
})

test('a report failure retries the same successful simulation rather than purchasing another run', async (t) => {
  const { source, calls, emit } = fixture(t)
  source.getReport = async (id, retry = false) => {
    calls.reports.push(retry)
    if (!retry) throw new Error('Report failed')
    return { ...report, runId: id }
  }
  const creating = useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Upload')
  const rejection = assert.rejects(creating, /Report failed/)
  await flush()
  const id = useAppStore.getState().activeCampaignId
  emit('run-1', { type: 'complete', metrics })
  await rejection
  assert.equal(await useAppStore.getState().prepareVideoResult(id), 'run-1')
  assert.equal(calls.starts, 1)
  assert.deepEqual(calls.reports, [false, true])
})

test('reattaching a completed historical video restores playback without analysis or another simulation', async (t) => {
  const { calls } = fixture(t, true)
  const id = await useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'History')
  const previous = useAppStore.getState().campaigns[id]
  useAppStore.setState({ campaigns: { [id]: { ...previous, videoAvailable: false, posterDataUrl: 'saved-poster' } } })
  await useAppStore.getState().attachVideo(id, { name: 'original.mp4', durationSec: 18, file: new File(['video'], 'original.mp4', { type: 'video/mp4' }) })
  assert.equal(calls.analyses, 1)
  assert.equal(calls.starts, 1)
  assert.equal(useAppStore.getState().campaigns[id].videoId, previous.videoId)
  assert.match(useAppStore.getState().videos[previous.videoId].objectUrl, /^blob:/)
})

test('a newer idea survives a background video starting after delayed audience loading', async (t) => {
  const { source, emit } = fixture(t)
  const audienceGate = gate()
  source.loadAudience = () => audienceGate.promise
  const campaign = { id: 'legacy', profileId: 'profile', videoId: 'video', videoName: 'original.mp4', videoAvailable: true, signals, summary: '', runIds: [] }
  useAppStore.setState({ audience: null, campaigns: { legacy: campaign }, videos: { video: { id: 'video', signals } }, activeCampaignId: 'legacy', activeVideoId: 'video' })
  const preparing = useAppStore.getState().prepareVideoResult('legacy')
  await flush()
  const idea = { input: { prompt: 'A newer idea', options: [] }, status: 'ready', result: { id: 'idea-1' } }
  useAppStore.setState({ idea, activeRunId: null, playback: { round: 7, playing: false, speed: 1 } })
  audienceGate.resolve(audience); await flush()
  emit('run-1', { type: 'complete', metrics })
  await preparing
  assert.equal(useAppStore.getState().idea, idea)
  assert.equal(useAppStore.getState().activeRunId, null)
  assert.equal(useAppStore.getState().playback.round, 7)
})

test('older video completion cannot switch away from a newer campaign or reset its final view', async (t) => {
  const { source, emit } = fixture(t)
  const startGate = gate()
  source.startRun = () => startGate.promise
  const creating = useAppStore.getState().createCampaign({ name: 'original.mp4', durationSec: 18 }, 'Background upload')
  await flush()
  const originalCampaign = useAppStore.getState().activeCampaignId
  useAppStore.setState({ activeCampaignId: 'newer-campaign', activeVideoId: 'newer-video', activeRunId: 'newer-run', playback: { round: 4, playing: false, speed: 1 } })
  startGate.resolve('run-1'); await flush()
  emit('run-1', round(0)); emit('run-1', { type: 'complete', metrics })
  assert.equal(await creating, originalCampaign)
  assert.equal(useAppStore.getState().activeCampaignId, 'newer-campaign')
  assert.equal(useAppStore.getState().activeRunId, 'newer-run')
  assert.equal(useAppStore.getState().playback.round, 4)
  assert.equal(useAppStore.getState().runs['run-1'].report.summary, 'Finished report')
})
