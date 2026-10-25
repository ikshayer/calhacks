import { create, type StoreApi } from 'zustand'
import { MockDataSource } from '@/data/mock/MockDataSource'
import { SpacetimeDataSource } from '@/data/spacetime/SpacetimeDataSource'
import type { SimDataSource } from '@/data/SimDataSource'
import type {
  Audience,
  Campaign,
  CampaignId,
  CompanyProfile,
  Decision,
  IdeaTestInput,
  IdeaTestResult,
  Report,
  RoundEvent,
  RunId,
  RunMetrics,
  RunOptions,
  RunStatus,
  VideoAnalysis,
  VideoInput,
} from '@/data/types'
import { capturePoster } from '@/data/videoPoster'
import { hashSeed } from '@/lib/rng'
import { TOWN_SIZE } from '@/data/millbrook'

/**
 * How many audience members exist, and how many get a body on the island.
 *
 * Every supplied Millbrook resident has a body on the island and is simulated.
 */
export const AUDIENCE_SIZE = TOWN_SIZE

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  seed: 1337,
  audienceVersion: 1,
  // Standalone runs start with 30% of the town; A/B scenarios override this per side.
  seedExposure: 0.3,
  maxRounds: 6,
}

/** Everything the UI accumulates about one run as its events arrive. */
export interface RunState {
  id: RunId
  campaignId: CampaignId
  label: string
  videoId: string
  options: RunOptions
  status: RunStatus
  /** Rounds received so far. The island replays from these, so order matters. */
  rounds: RoundEvent[]
  metrics?: RunMetrics
  decisions?: Decision[]
  report?: Report
  note?: string
  error?: string
}

/** A run as persisted: results survive a reload, the cascade does not. */
export type StoredRun = Pick<
  RunState,
  'id' | 'campaignId' | 'label' | 'videoId' | 'options' | 'status' | 'metrics' | 'report'
>

/** An idea test shown on the island and sidebar in place of a video run. */
export type IdeaViewState = {
  input: IdeaTestInput
  status: 'running' | 'ready' | 'failed'
  stage: string
  result?: IdeaTestResult
  error?: string
}

/** One side of an A/B test: its own campaign (one video) and the run made from it. */
export interface AbSide {
  campaignId: CampaignId
  runId: RunId
}

/**
 * Two videos tested side by side. Runs share an audience and seed; each side can
 * have its own starting exposure, which is saved with that run's options.
 */
export interface AbPair {
  /** What the user is trying to achieve, shown beside the results. The simulation does not read it. */
  goal: string
  a: AbSide
  b: AbSide
  /** The side the island is showing. */
  active: 'a' | 'b'
}

export interface AbTestInput {
  goal: string
  a: VideoInput
  b: VideoInput
}

interface PlaybackState {
  /** How many rounds have been applied: 0 means nothing has happened yet. */
  round: number
  playing: boolean
  /** Multiplier on the per-round dwell time. */
  speed: number
}

interface AppState {
  source: SimDataSource
  profile: CompanyProfile | null
  audience: Audience | null
  audienceError: string | null

  videos: Record<string, VideoAnalysis>
  activeVideoId: string | null

  campaigns: Record<CampaignId, Campaign>
  /** The campaign the workspace is a view of. New runs are filed under it. */
  activeCampaignId: CampaignId | null
  videoPreparations: Record<CampaignId, { status: 'preparing' | 'failed'; error?: string }>

  runs: Record<RunId, RunState>
  /** The run the island is showing. */
  activeRunId: RunId | null
  /** The run held alongside it for an A/B comparison. */
  compareRunId: RunId | null

  /** The idea test the island is showing, if any. */
  idea: IdeaViewState | null

  /** The A/B test in progress or finished, if any. */
  ab: AbPair | null
  /** Includes file loading and analysis before either comparison run exists. */
  abPreparation: { status: 'preparing' | 'failed'; error?: string } | null

  selectedMemberId: number | null
  /** Group whose villagers are ringed on the island, while a sidebar row is pointed at. */
  highlightedGroupId: string | null
  playback: PlaybackState

  setProfile(profile: CompanyProfile): void
  loadAudience(): Promise<void>

  analyseUpload(input: VideoInput, label: string): Promise<string>
  setActiveVideo(videoId: string): void

  /** Analyse and prepare one complete result, unless an explicit comparison defers the run. */
  createCampaign(input: VideoInput, title: string, options?: { prepare?: boolean }): Promise<CampaignId>
  prepareVideoResult(campaignId: CampaignId): Promise<RunId>
  /** Make a campaign current and point the workspace at its latest run. */
  openCampaign(id: CampaignId): void
  /** Re-attach a video file to a campaign restored without one. */
  attachVideo(id: CampaignId, input: VideoInput): Promise<void>
  deleteCampaign(id: CampaignId): void
  /** Replace campaign history with what persistence read back. Boot-time only. */
  restoreCampaigns(campaigns: Campaign[], runs: StoredRun[]): void

  startRun(label: string, overrides?: Partial<RunOptions>, campaignId?: CampaignId): Promise<RunId | null>
  /** Ask the simulated town about an idea that has no video yet. */
  testIdea(input: IdeaTestInput, onProgress: (stage: string) => void): Promise<IdeaTestResult>
  /** Run an idea test and show it on the island; progress and the result land in `idea`. */
  startIdeaTest(input: IdeaTestInput): Promise<void>
  clearIdeaTest(): void
  /** Analyses both videos in parallel, then starts one run for each. Resolves once both runs are started. */
  startAbTest(input: AbTestInput): Promise<void>
  /** Enter the workspace immediately while comparison inputs and runs are prepared. */
  prepareAbTest(loadInput: () => Promise<AbTestInput>): Promise<void>
  showAbSide(side: 'a' | 'b'): void
  clearAb(): void
  setActiveRun(runId: RunId): void
  setCompareRun(runId: RunId | null): void

  selectMember(id: number | null): void
  highlightGroup(groupId: string | null): void
  setPlaying(playing: boolean): void
  setSpeed(speed: number): void
  seekRound(round: number): void
}

/**
 * Load (and, on the live backend, save) the audience before analysing a video.
 * Campaigns can be created before the workspace has loaded the audience, and
 * the backend files every video under the saved profile.
 */
async function ensureAudience(get: () => AppState): Promise<void> {
  if (get().audience) return
  await get().loadAudience()
  const { audience, audienceError } = get()
  if (!audience) throw new Error(audienceError ?? 'Finish onboarding before adding a video.')
}

/** Live subscriptions, keyed by run. Kept outside the store: not render state. */
const subscriptions = new Map<RunId, () => void>()
const videoPreparations = new Map<CampaignId, Promise<RunId>>()

export class VideoResultError extends Error {
  readonly campaignId: CampaignId
  constructor(campaignId: CampaignId, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The video result could not be prepared.', { cause })
    this.name = 'VideoResultError'
    this.campaignId = campaignId
  }
}

async function loadRunDetails(runId: RunId, source: SimDataSource, set: StoreApi<AppState>['setState'], retryFailed = false) {
  try {
    const [decisions, report] = await Promise.all([source.getDecisions(runId), source.getReport(runId, retryFailed)])
    set((state) => {
      const run = state.runs[runId]
      if (!run || state.source !== source) return state
      const current = state.activeRunId === runId && state.activeCampaignId === run.campaignId && !state.idea
      const owner = state.campaigns[run.campaignId]
      const metrics = run.metrics
      return {
        runs: { ...state.runs, [runId]: { ...run, decisions, report, error: undefined } },
        ...(owner?.runIds.at(-1) === runId && metrics ? { campaigns: { ...state.campaigns, [run.campaignId]: {
          ...owner, headline: { runId, uniqueExposed: metrics.uniqueExposed, likes: metrics.likes, comments: metrics.comments, shares: metrics.shares, coverage: metrics.coverage },
        } } } : {}),
        ...(current ? { playback: { ...state.playback, round: run.rounds.length, playing: false } } : {}),
      }
    })
  } catch (cause: unknown) {
    set((state) => {
      const run = state.runs[runId]
      return run && state.source === source ? { runs: { ...state.runs, [runId]: { ...run, error: cause instanceof Error ? cause.message : 'The report could not be loaded.' } } } : state
    })
    throw cause
  }
}

/** Independent of route mount/unmount; synchronous cached completion is valid. */
function waitForRunResult(runId: RunId): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      unsubscribe()
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      const run = useAppStore.getState().runs[runId]
      if (!run) return done(new Error('This video result was removed.'))
      if (run.status === 'failed' || run.error) return done(new Error(run.error || 'The simulation failed.'))
      if (run.status === 'complete' && run.report && run.decisions !== undefined) done()
    }
    const unsubscribe = useAppStore.subscribe(check)
    const timer = setTimeout(() => done(new Error('Preparing results timed out. Check the worker and retry.')), 180_000)
    check()
  })
}

/**
 * `VITE_DATA_SOURCE=spacetime` uses the live backend; anything else, the local
 * mock. Both stay available so a venue with no network can still run the demo.
 */
function createSource(): SimDataSource {
  if (import.meta.env.VITE_DATA_SOURCE !== 'spacetime') return new MockDataSource()
  const host = import.meta.env.VITE_SPACETIME_HOST
  const database = import.meta.env.VITE_SPACETIME_DB
  if (!host || !database) {
    throw new Error('VITE_DATA_SOURCE=spacetime needs VITE_SPACETIME_HOST and VITE_SPACETIME_DB in frontend/.env.local')
  }
  return new SpacetimeDataSource(host, database, import.meta.env.VITE_UPLOAD_URL || undefined)
}

/**
 * A unique campaign id.
 *
 * `crypto.randomUUID` only exists in a secure context, and the demo is served
 * off a laptop — over plain http from another machine on the network it is
 * simply undefined, and minting a campaign would throw. `getRandomValues` has
 * no such restriction, so it carries the insecure case. These ids only have to
 * be unique within one browser's storage, not globally.
 */
function newCampaignId(): CampaignId {
  if (typeof crypto.randomUUID === 'function') return `campaign-${crypto.randomUUID()}`
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `campaign-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export const useAppStore = create<AppState>((set, get) => ({
  source: createSource(),
  profile: null,
  audience: null,
  audienceError: null,

  videos: {},
  activeVideoId: null,

  campaigns: {},
  activeCampaignId: null,
  videoPreparations: {},

  runs: {},
  activeRunId: null,
  compareRunId: null,

  idea: null,
  ab: null,
  abPreparation: null,

  selectedMemberId: null,
  highlightedGroupId: null,
  playback: { round: 0, playing: true, speed: 1 },

  setProfile(profile) {
    set({ profile, audience: null, audienceError: null, selectedMemberId: null, highlightedGroupId: null, abPreparation: null })
  },

  async loadAudience() {
    const { profile, source } = get()
    if (!profile) return
    try {
      const audience = await source.loadAudience(profile)
      if (get().profile !== profile) return
      set({ audience, audienceError: null })
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Could not build the audience.'
      if (get().profile !== profile) return
      set({ audience: null, audienceError: message })
    }
  },

  async analyseUpload(input, label) {
    const { source, profile } = get()
    const analysis = await ensureAudience(get).then(() => source.analyseVideo(profile?.id ?? 'campaign', input, label))
    set((state) => ({
      videos: { ...state.videos, [analysis.id]: analysis },
      activeVideoId: analysis.id,
    }))
    return analysis.id
  },

  async testIdea(input, onProgress) {
    await ensureAudience(get)
    return get().source.testIdea(input, onProgress)
  },

  async startIdeaTest(input) {
    set({
      idea: { input, status: 'running', stage: 'Starting' },
      ab: null,
      abPreparation: null,
      activeRunId: null,
      compareRunId: null,
      selectedMemberId: null,
    })
    // A newer test (or a cleared one) replaces `idea`; its completion is stale.
    const current = () => get().idea?.input === input
    try {
      const result = await get().testIdea(input, (stage) => {
        if (!current()) return
        set((state) => (state.idea ? { idea: { ...state.idea, stage } } : state))
      })
      if (!current()) return
      set((state) => (state.idea ? { idea: { ...state.idea, status: 'ready', result } } : state))
    } catch (cause: unknown) {
      console.error('Idea test failed', cause)
      if (!current()) return
      const error = cause instanceof Error ? cause.message : 'The idea test failed.'
      set((state) => (state.idea ? { idea: { ...state.idea, status: 'failed', error } } : state))
    }
  },

  clearIdeaTest() {
    set({ idea: null })
  },

  setActiveVideo(videoId) {
    set({ activeVideoId: videoId })
  },

  async prepareAbTest(loadInput) {
    if (get().abPreparation?.status === 'preparing') return
    const preparation = { status: 'preparing' as const }
    set({ abPreparation: preparation })
    try {
      const input = await loadInput()
      if (get().abPreparation !== preparation) return
      await get().startAbTest(input)
      if (get().abPreparation === preparation) set({ abPreparation: null })
    } catch (cause: unknown) {
      if (get().abPreparation === preparation) {
        set({ abPreparation: { status: 'failed', error: cause instanceof Error ? cause.message : 'The A/B test could not be started.' } })
      }
      throw cause
    }
  },

  async startAbTest({ goal, a, b }) {
    // The audience is saved once, before the two analyses race each other to save it.
    await ensureAudience(get)
    const [campaignA, campaignB] = await Promise.all([
      get().createCampaign(a, `Video A · ${a.name}`, { prepare: false }),
      get().createCampaign(b, `Video B · ${b.name}`, { prepare: false }),
    ])
    // Explicit campaign IDs keep parallel runs attached to their own videos.
    const [runA, runB] = await Promise.all([
      get().startRun('Video A', { seedExposure: 0.1 }, campaignA),
      get().startRun('Video B', { seedExposure: 0.4 }, campaignB),
    ])
    if (!runA || !runB) throw new Error('The A/B test could not start both runs.')

    set({
      ab: {
        goal: goal.trim(),
        a: { campaignId: campaignA, runId: runA },
        b: { campaignId: campaignB, runId: runB },
        active: 'a',
      },
    })
    get().showAbSide('a')
  },

  showAbSide(side) {
    const { ab, campaigns } = get()
    if (!ab) return
    const mine = ab[side]
    const other = ab[side === 'a' ? 'b' : 'a']
    const campaign = campaigns[mine.campaignId]
    if (!campaign) {
      console.warn(`showAbSide: campaign ${mine.campaignId} no longer exists`)
      return
    }
    set((state) => {
      const rounds = state.runs[mine.runId]?.rounds.length ?? 0
      return {
        ab: { ...ab, active: side },
        activeCampaignId: mine.campaignId,
        activeVideoId: campaign.videoId,
        activeRunId: mine.runId,
        compareRunId: other.runId,
        idea: null,
        selectedMemberId: null,
        // Replay a run still arriving; jump to the end of one already received.
        playback: { ...state.playback, round: rounds, playing: rounds === 0 },
      }
    })
  },

  clearAb() {
    set({ ab: null, compareRunId: null })
  },

  async createCampaign(input, title, { prepare = true } = {}) {
    const { source, profile } = get()
    const view = { campaignId: get().activeCampaignId, idea: get().idea }
    if (!profile) throw new Error('createCampaign: no company profile is loaded')

    // The id is minted before analysis so the analysis can carry it. Going
    // through `analyseUpload` would stamp the profile id there instead and
    // leave the video pointing at a campaign that does not exist.
    const id = newCampaignId()
    const [analysis, posterDataUrl] = await Promise.all([
      ensureAudience(get).then(() => source.analyseVideo(id, input, 'Original')),
      input.file ? capturePoster(input.file) : Promise.resolve(undefined),
    ])

    const campaign: Campaign = {
      id,
      profileId: profile.id,
      title: title.trim() || input.name,
      createdAt: Date.now(),
      videoId: analysis.id,
      videoName: analysis.name,
      durationSec: analysis.durationSec,
      posterDataUrl,
      videoAvailable: input.file !== undefined || Boolean(analysis.objectUrl),
      signals: analysis.signals,
      summary: analysis.summary,
      runIds: [],
    }

    if (get().source !== source || get().profile !== profile) throw new Error('The profile changed while preparing this video.')
    set((state) => ({
      campaigns: { ...state.campaigns, [id]: campaign },
      videos: { ...state.videos, [analysis.id]: analysis },
      ...(state.activeCampaignId === view.campaignId && state.idea === view.idea ? {
        activeCampaignId: id, activeVideoId: analysis.id, activeRunId: null,
        compareRunId: null, ab: null, selectedMemberId: null, idea: null,
        ...(prepare ? { abPreparation: null } : {}),
        playback: { ...state.playback, round: 0, playing: false },
      } : {}),
    }))
    if (prepare) {
      try { await get().prepareVideoResult(id) }
      catch (cause: unknown) { throw new VideoResultError(id, cause) }
    }
    return id
  },

  prepareVideoResult(campaignId) {
    const existing = videoPreparations.get(campaignId)
    if (existing) return existing
    const source = get().source
    const profile = get().profile
    const pending = Promise.resolve().then(async () => {
      const campaign = get().campaigns[campaignId]
      if (!campaign) throw new Error('This campaign is no longer available.')
      const last = [...campaign.runIds].reverse().map((id) => get().runs[id]).find(Boolean)
      if (last?.status === 'complete' && last.report && last.metrics && !last.error) return last.id
      if (last?.status === 'complete') {
        set((state) => ({ runs: { ...state.runs, [last.id]: { ...state.runs[last.id], error: undefined } } }))
        await loadRunDetails(last.id, source, set, true)
        return last.id
      }
      if (last && last.status !== 'failed') {
        await waitForRunResult(last.id)
        return last.id
      }
      if (!campaign.videoAvailable) throw new Error('Re-attach the video to prepare its result.')
      await ensureAudience(get)
      if (get().source !== source || get().profile !== profile) throw new Error('The profile changed while preparing this video.')
      const runId = await get().startRun(last?.label ?? 'Original', undefined, campaignId)
      if (!runId) throw new Error('The video result could not be started.')
      await waitForRunResult(runId)
      return runId
    }).then((runId) => {
      set((state) => {
        const next = { ...state.videoPreparations }; delete next[campaignId]
        return { videoPreparations: next }
      })
      return runId
    }).catch((cause: unknown) => {
      set((state) => state.campaigns[campaignId] ? { videoPreparations: {
        ...state.videoPreparations, [campaignId]: { status: 'failed', error: cause instanceof Error ? cause.message : 'The video result could not be prepared.' },
      } } : state)
      throw cause
    }).finally(() => {
      if (videoPreparations.get(campaignId) === pending) videoPreparations.delete(campaignId)
    })
    videoPreparations.set(campaignId, pending)
    set((state) => ({ videoPreparations: { ...state.videoPreparations, [campaignId]: { status: 'preparing' } } }))
    return pending
  },

  openCampaign(id) {
    const campaign = get().campaigns[id]
    if (!campaign) {
      console.warn(`openCampaign: unknown campaign ${id}`)
      return
    }
    set((state) => {
      // The newest run that still exists: a run that failed to restore leaves a
      // dangling id in `runIds`, and pointing the workspace at it would blank it.
      const activeRunId =
        [...campaign.runIds].reverse().find((runId) => runId in state.runs) ?? null
      return {
        activeCampaignId: id,
        activeVideoId: campaign.videoId,
        activeRunId,
        compareRunId: null,
        ab: null,
        abPreparation: null,
        idea: null,
        selectedMemberId: null,
        // Jump to the end of a finished run, as `setActiveRun` does, so opening
        // a campaign from history does not replay its cascade.
        playback: {
          ...state.playback,
          round: activeRunId ? (state.runs[activeRunId]?.rounds.length ?? 0) : 0,
          playing: false,
        },
      }
    })
    const latest = [...campaign.runIds].reverse().map((runId) => get().runs[runId]).find(Boolean)
    if ((!latest && campaign.videoAvailable) || (latest?.status === 'complete' && !latest.report && !latest.error)) {
      void get().prepareVideoResult(id).catch((cause: unknown) => console.error('Could not prepare saved video result', cause))
    }
  },

  async attachVideo(id, input) {
    const { source, campaigns } = get()
    const campaign = campaigns[id]
    if (!campaign) throw new Error(`attachVideo: unknown campaign ${id}`)
    const { file } = input
    if (!file) throw new Error('attachVideo: a video file is required')

    const complete = campaign.runIds.some((runId) => {
      const run = get().runs[runId]
      return run?.status === 'complete' && run.metrics && run.report
    })
    if (complete) {
      // Reattaching the original file only restores playback. The saved result
      // still refers to its original video and never starts another paid run.
      const posterDataUrl = campaign.posterDataUrl || await capturePoster(file)
      const objectUrl = URL.createObjectURL(file)
      set((state) => {
        const current = state.campaigns[id]
        const video = current && state.videos[current.videoId]
        if (!current || !video) { URL.revokeObjectURL(objectUrl); return state }
        return {
          campaigns: { ...state.campaigns, [id]: { ...current, videoAvailable: true, posterDataUrl } },
          videos: { ...state.videos, [current.videoId]: { ...video, objectUrl } },
        }
      })
      return
    }

    // The source has forgotten the old video along with the page, so it is
    // analysed afresh and the stored signals are written back over the result
    // so reattachment preserves the campaign's original simulation inputs.
    const [analysed, posterDataUrl] = await Promise.all([
      ensureAudience(get).then(() => source.analyseVideo(id, input, 'Original')),
      campaign.posterDataUrl ? Promise.resolve(campaign.posterDataUrl) : capturePoster(file),
    ])
    const analysis = await source.reviseSignals(analysed.id, campaign.signals)

    set((state) => {
      const current = state.campaigns[id]
      if (!current) {
        // Deleted while the file was being read: nothing owns this URL now.
        if (analysis.objectUrl) URL.revokeObjectURL(analysis.objectUrl)
        return state
      }
      const videos = { ...state.videos, [analysis.id]: analysis }
      delete videos[current.videoId]
      return {
        campaigns: {
          ...state.campaigns,
          [id]: {
            ...current,
            videoId: analysis.id,
            posterDataUrl,
            videoAvailable: true,
          },
        },
        videos,
        activeVideoId: state.activeCampaignId === id ? analysis.id : state.activeVideoId,
      }
    })
    await get().prepareVideoResult(id)
  },

  deleteCampaign(id) {
    if (!get().campaigns[id]) return

    for (const run of Object.values(get().runs)) {
      if (run.campaignId !== id) continue
      subscriptions.get(run.id)?.()
      subscriptions.delete(run.id)
    }

    set((state) => {
      const campaigns = { ...state.campaigns }
      delete campaigns[id]
      const runs = Object.fromEntries(
        Object.entries(state.runs).filter(([, run]) => run.campaignId !== id),
      )
      const videos: Record<string, VideoAnalysis> = {}
      for (const [videoId, video] of Object.entries(state.videos)) {
        if (video.campaignId !== id) {
          videos[videoId] = video
        } else if (video.objectUrl) {
          URL.revokeObjectURL(video.objectUrl)
        }
      }
      const wasActive = state.activeCampaignId === id
      return {
        campaigns,
        runs,
        videos,
        activeCampaignId: wasActive ? null : state.activeCampaignId,
        activeVideoId: wasActive ? null : state.activeVideoId,
        activeRunId: wasActive ? null : state.activeRunId,
        compareRunId: state.compareRunId && state.compareRunId in runs ? state.compareRunId : null,
        selectedMemberId: wasActive ? null : state.selectedMemberId,
      }
    })
  },

  restoreCampaigns(campaigns, storedRuns) {
    set({
      campaigns: Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign])),
      runs: Object.fromEntries(
        storedRuns.map((run): [RunId, RunState] => [run.id, { ...run, rounds: [] }]),
      ),
      // The video file is gone but its analysis is not: the workspace reads the
      // signals and summary from `videos`, so they are rebuilt from the campaign.
      videos: Object.fromEntries(
        campaigns.map((campaign): [string, VideoAnalysis] => [
          campaign.videoId,
          {
            id: campaign.videoId,
            campaignId: campaign.id,
            label: 'Original',
            name: campaign.videoName,
            durationSec: campaign.durationSec,
            signals: campaign.signals,
            summary: campaign.summary,
          },
        ]),
      ),
      activeCampaignId: null,
      activeVideoId: null,
      activeRunId: null,
      compareRunId: null,
      ab: null,
      selectedMemberId: null,
    })
  },

  async startRun(label, overrides, forCampaignId) {
    const { source, profile, audience, activeCampaignId, idea } = get()
    const campaignId = forCampaignId ?? activeCampaignId
    const activeVideoId = campaignId ? get().campaigns[campaignId]?.videoId : undefined
    // Every run belongs to a campaign: the workspace is unreachable without
    // one, so a missing id here is a routing bug rather than a state to render.
    if (!profile || !audience || !activeVideoId || !campaignId) return null

    const options: RunOptions = {
      ...DEFAULT_RUN_OPTIONS,
      // Seed derives from the profile, so the same campaign always runs against
      // the same audience, graph and starting exposure. An A/B comparison is only
      // fair if this is identical across both runs, so overrides are explicit.
      seed: hashSeed(profile.id) % 100000,
      audienceVersion: profile.audienceVersion,
      ...overrides,
      audienceKey: audience.key,
    }

    const runId = await source.startRun(campaignId, activeVideoId, label, options)

    set((state) => {
      const owner = state.campaigns[campaignId]
      if (!owner || state.source !== source || state.profile !== profile) return state
      const current = state.activeCampaignId === campaignId && state.activeVideoId === activeVideoId && !idea && !state.idea
      return {
        campaigns: owner
          ? {
              ...state.campaigns,
              [campaignId]: { ...owner, runIds: [...owner.runIds, runId] },
            }
          : state.campaigns,
        runs: {
          ...state.runs,
          [runId]: {
            id: runId,
            campaignId,
            label,
            videoId: activeVideoId,
            options,
            status: 'scoring',
            rounds: [],
          },
        },
        ...(current ? {
          activeRunId: runId, idea: null, selectedMemberId: null,
          playback: { ...state.playback, round: 0, playing: false },
        } : {}),
      }
    })

    const patch = (changes: Partial<RunState>) =>
      set((state) => {
        const existing = state.runs[runId]
        if (!existing) return state
        return {
          runs: { ...state.runs, [runId]: { ...existing, ...changes } },
        }
      })

    if (!get().runs[runId]) throw new Error('The campaign changed before its result could be prepared.')
    let terminal = false
    const stop = () => {
      terminal = true
      subscriptions.get(runId)?.()
      subscriptions.delete(runId)
    }
    subscriptions.get(runId)?.()
    const unsubscribe = source.subscribeRun(runId, (event) => {
        if (terminal) return
        switch (event.type) {
          case 'status':
            patch({ status: event.status, note: event.note })
            break
          case 'round':
            set((state) => {
              const existing = state.runs[runId]
              if (!existing) return state
              return {
                runs: {
                  ...state.runs,
                  [runId]: { ...existing, rounds: [...existing.rounds, event] },
                },
              }
            })
            break
          case 'complete':
            stop()
            patch({ status: 'complete', metrics: event.metrics })
            void loadRunDetails(runId, source, set).catch((cause: unknown) => console.error('Could not load video result', cause))
            break
          case 'failed':
            stop()
            patch({ status: 'failed', error: event.reason })
            break
        }
      })
    // Cached live results are allowed to emit completion during subscribeRun.
    if (terminal) unsubscribe()
    else subscriptions.set(runId, unsubscribe)

    return runId
  },

  setActiveRun(runId) {
    set((state) => ({
      activeRunId: runId,
      selectedMemberId: null,
      // Jump to the end of a run already received, so switching does not replay it.
      playback: {
        ...state.playback,
        round: state.runs[runId]?.rounds.length ?? 0,
        playing: false,
      },
    }))
  },

  setCompareRun(runId) {
    set({ compareRunId: runId })
  },

  selectMember(id) {
    set({ selectedMemberId: id })
  },

  highlightGroup(groupId) {
    set({ highlightedGroupId: groupId })
  },

  setPlaying(playing) {
    set((state) => ({ playback: { ...state.playback, playing } }))
  },

  setSpeed(speed) {
    set((state) => ({ playback: { ...state.playback, speed } }))
  },

  seekRound(round) {
    set((state) => {
      const total = state.activeRunId ? (state.runs[state.activeRunId]?.rounds.length ?? 0) : 0
      const clamped = Math.max(0, Math.min(round, total))
      return { playback: { ...state.playback, round: clamped } }
    })
  },
}))

/** Explicit teardown for tests/sign-out. Route changes must not cancel preparation. */
export function closeAllRunSubscriptions() {
  for (const unsubscribe of subscriptions.values()) unsubscribe()
  subscriptions.clear()
}

export const selectActiveRun = (state: AppState): RunState | undefined =>
  state.activeRunId ? state.runs[state.activeRunId] : undefined

export const selectActiveVideo = (state: AppState): VideoAnalysis | undefined =>
  state.activeVideoId ? state.videos[state.activeVideoId] : undefined

export const selectActiveCampaign = (state: AppState): Campaign | undefined =>
  state.activeCampaignId ? state.campaigns[state.activeCampaignId] : undefined

/**
 * Newest first. Allocates a fresh array on every call, so it must never be
 * passed straight to `useAppStore(...)`: Zustand compares selector results by
 * reference, so the component would re-render on every store write and, under
 * React 19's `useSyncExternalStore`, an unstable snapshot can loop forever.
 * Select `state.campaigns` and sort inside `useMemo`, or wrap this selector in
 * `useShallow`.
 */
export const selectCampaignHistory = (state: AppState): Campaign[] =>
  Object.values(state.campaigns).sort((a, b) => b.createdAt - a.createdAt)
