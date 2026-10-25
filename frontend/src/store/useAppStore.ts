import { create } from 'zustand'
import { MockDataSource } from '@/data/mock/MockDataSource'
import { SpacetimeDataSource } from '@/data/spacetime/SpacetimeDataSource'
import type { SimDataSource } from '@/data/SimDataSource'
import type {
  Audience,
  Campaign,
  CampaignId,
  CompanyProfile,
  ContentSignals,
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
import { MILLBROOK_SIZE } from '@/data/millbrook'

/**
 * How many audience members exist, and how many get a body on the island.
 *
 * Every supplied Millbrook resident has a body on the island and is simulated.
 */
export const AUDIENCE_SIZE = MILLBROOK_SIZE

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  seed: 1337,
  audienceVersion: 1,
  // 40% of the 50 Millbrook residents (20) see it first; at 10% only 5 did, too few to separate two cuts.
  seedExposure: 0.4,
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

  runs: Record<RunId, RunState>
  /** The run the island is showing. */
  activeRunId: RunId | null
  /** The run held alongside it for an A/B comparison. */
  compareRunId: RunId | null

  selectedMemberId: number | null
  /** Group whose villagers are ringed on the island, while a sidebar row is pointed at. */
  highlightedGroupId: string | null
  playback: PlaybackState

  setProfile(profile: CompanyProfile): void
  loadAudience(): Promise<void>

  analyseUpload(input: VideoInput, label: string): Promise<string>
  reviseSignals(videoId: string, patch: Partial<ContentSignals>): Promise<void>
  setActiveVideo(videoId: string): void

  /** Analyse an upload and create the campaign that owns it. Returns its id. */
  createCampaign(input: VideoInput, title: string): Promise<CampaignId>
  /** Make a campaign current and point the workspace at its latest run. */
  openCampaign(id: CampaignId): void
  /** Re-attach a video file to a campaign restored without one. */
  attachVideo(id: CampaignId, input: VideoInput): Promise<void>
  deleteCampaign(id: CampaignId): void
  /** Replace campaign history with what persistence read back. Boot-time only. */
  restoreCampaigns(campaigns: Campaign[], runs: StoredRun[]): void

  startRun(label: string, overrides?: Partial<RunOptions>): Promise<RunId | null>
  /** Ask the simulated town about an idea that has no video yet. */
  testIdea(input: IdeaTestInput, onProgress: (stage: string) => void): Promise<IdeaTestResult>
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

  runs: {},
  activeRunId: null,
  compareRunId: null,

  selectedMemberId: null,
  highlightedGroupId: null,
  playback: { round: 0, playing: true, speed: 1 },

  setProfile(profile) {
    set({ profile, audience: null, audienceError: null, selectedMemberId: null, highlightedGroupId: null })
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

  async reviseSignals(videoId, patch) {
    // Merge against the current analysis rather than one captured at render
    // time: dragging a second slider before the first has landed would
    // otherwise write back the stale value and undo it.
    const current = get().videos[videoId]
    if (!current) return
    const updated = await get().source.reviseSignals(videoId, {
      ...current.signals,
      ...patch,
    })
    set((state) => ({ videos: { ...state.videos, [updated.id]: updated } }))
  },

  async testIdea(input, onProgress) {
    await ensureAudience(get)
    return get().source.testIdea(input, onProgress)
  },

  setActiveVideo(videoId) {
    set({ activeVideoId: videoId })
  },

  async createCampaign(input, title) {
    const { source, profile } = get()
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
      videoAvailable: input.file !== undefined,
      signals: analysis.signals,
      summary: analysis.summary,
      runIds: [],
    }

    set((state) => ({
      campaigns: { ...state.campaigns, [id]: campaign },
      videos: { ...state.videos, [analysis.id]: analysis },
      activeCampaignId: id,
      activeVideoId: analysis.id,
      activeRunId: null,
      compareRunId: null,
      selectedMemberId: null,
      playback: { ...state.playback, round: 0, playing: true },
    }))
    return id
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
  },

  async attachVideo(id, input) {
    const { source, campaigns } = get()
    const campaign = campaigns[id]
    if (!campaign) throw new Error(`attachVideo: unknown campaign ${id}`)
    const { file } = input
    if (!file) throw new Error('attachVideo: a video file is required')

    // The source has forgotten the old video along with the page, so it is
    // analysed afresh and the stored signals are written back over the result:
    // the user's corrections to the signals must survive re-attaching the file.
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
      selectedMemberId: null,
    })
  },

  async startRun(label, overrides) {
    const { source, profile, audience, activeVideoId, activeCampaignId } = get()
    // Every run belongs to a campaign: the workspace is unreachable without
    // one, so a missing id here is a routing bug rather than a state to render.
    if (!profile || !audience || !activeVideoId || !activeCampaignId) return null
    const campaignId: CampaignId = activeCampaignId

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
        activeRunId: runId,
        selectedMemberId: null,
        playback: { ...state.playback, round: 0, playing: true },
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

    subscriptions.get(runId)?.()
    subscriptions.set(
      runId,
      source.subscribeRun(runId, (event) => {
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
            patch({ status: 'complete', metrics: event.metrics })
            set((state) => {
              const owner = state.campaigns[campaignId]
              if (!owner) return state
              const { metrics } = event
              return {
                campaigns: {
                  ...state.campaigns,
                  [campaignId]: {
                    ...owner,
                    headline: {
                      runId,
                      uniqueExposed: metrics.uniqueExposed,
                      likes: metrics.likes,
                      comments: metrics.comments,
                      shares: metrics.shares,
                      coverage: metrics.coverage,
                    },
                  },
                },
              }
            })
            void Promise.all([source.getDecisions(runId), source.getReport(runId)])
              .then(([decisions, report]) => patch({ decisions, report }))
              .catch((cause: unknown) => {
                console.error('Could not load run details', cause)
                patch({
                  error:
                    cause instanceof Error
                      ? cause.message
                      : 'The run finished but its report could not be loaded.',
                })
              })
            break
          case 'failed':
            patch({ status: 'failed', error: event.reason })
            break
        }
      }),
    )

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

/** Tear down every live subscription. Called when the workspace unmounts. */
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
