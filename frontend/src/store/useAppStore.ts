import { create } from 'zustand'
import { MockDataSource } from '@/data/mock/MockDataSource'
import { SpacetimeDataSource } from '@/data/spacetime/SpacetimeDataSource'
import type { SimDataSource } from '@/data/SimDataSource'
import type {
  Audience,
  CompanyProfile,
  ContentSignals,
  Decision,
  Report,
  RoundEvent,
  RunId,
  RunOptions,
  RunStatus,
  VideoAnalysis,
  VideoInput,
} from '@/data/types'
import { hashSeed } from '@/lib/rng'

/**
 * How many audience members exist, and how many get a body on the island.
 *
 * The town looks better with fewer people in it. At 120 the streets were a
 * crowd you read as texture; at 48 you can follow one resident across a
 * junction, see who they are when you click them, and watch a single share
 * travel. The other 452 are still simulated and still counted — they just do
 * not need bodies to be real, and the sidebar says so.
 */
export const AUDIENCE_SIZE = { total: 500, onIsland: 48 }

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  seed: 1337,
  audienceVersion: 1,
  seedExposure: 0.1,
  maxRounds: 6,
}

/** Everything the UI accumulates about one run as its events arrive. */
export interface RunState {
  id: RunId
  label: string
  videoId: string
  options: RunOptions
  status: RunStatus
  /** Rounds received so far. The island replays from these, so order matters. */
  rounds: RoundEvent[]
  metrics?: import('@/data/types').RunMetrics
  decisions?: Decision[]
  report?: Report
  note?: string
  error?: string
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

  startRun(label: string, overrides?: Partial<RunOptions>): Promise<RunId | null>
  setActiveRun(runId: RunId): void
  setCompareRun(runId: RunId | null): void

  selectMember(id: number | null): void
  highlightGroup(groupId: string | null): void
  setPlaying(playing: boolean): void
  setSpeed(speed: number): void
  seekRound(round: number): void
}

/** Live subscriptions, keyed by run. Kept outside the store: not render state. */
const subscriptions = new Map<RunId, () => void>()

/**
 * `VITE_DATA_SOURCE=spacetime` uses the live backend; anything else, the local
 * mock. Both stay available so a venue with no network can still run the demo.
 */
function createSource(): SimDataSource {
  if (import.meta.env.VITE_DATA_SOURCE !== 'spacetime') return new MockDataSource(AUDIENCE_SIZE)
  const host = import.meta.env.VITE_SPACETIME_HOST
  const database = import.meta.env.VITE_SPACETIME_DB
  if (!host || !database) {
    throw new Error('VITE_DATA_SOURCE=spacetime needs VITE_SPACETIME_HOST and VITE_SPACETIME_DB in frontend/.env.local')
  }
  return new SpacetimeDataSource(host, database, AUDIENCE_SIZE)
}

export const useAppStore = create<AppState>((set, get) => ({
  source: createSource(),
  profile: null,
  audience: null,
  audienceError: null,

  videos: {},
  activeVideoId: null,

  runs: {},
  activeRunId: null,
  compareRunId: null,

  selectedMemberId: null,
  highlightedGroupId: null,
  playback: { round: 0, playing: true, speed: 1 },

  setProfile(profile) {
    set({ profile })
  },

  async loadAudience() {
    const { profile, source } = get()
    if (!profile) return
    try {
      const audience = await source.loadAudience(profile)
      set({ audience, audienceError: null })
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Could not build the audience.'
      set({ audienceError: message })
    }
  },

  async analyseUpload(input, label) {
    const { source, profile } = get()
    const analysis = await source.analyseVideo(profile?.id ?? 'campaign', input, label)
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
    const updated = await get().source.reviseSignals(videoId, { ...current.signals, ...patch })
    set((state) => ({ videos: { ...state.videos, [updated.id]: updated } }))
  },

  setActiveVideo(videoId) {
    set({ activeVideoId: videoId })
  },

  async startRun(label, overrides) {
    const { source, profile, audience, activeVideoId } = get()
    if (!profile || !audience || !activeVideoId) return null

    const options: RunOptions = {
      ...DEFAULT_RUN_OPTIONS,
      // Seed derives from the profile, so the same campaign always runs against
      // the same audience, graph and starting exposure. An A/B comparison is only
      // fair if this is identical across both runs, so overrides are explicit.
      seed: hashSeed(profile.id) % 100000,
      audienceVersion: profile.audienceVersion,
      ...overrides,
    }

    const runId = await source.startRun(profile.id, activeVideoId, label, options)

    set((state) => ({
      runs: {
        ...state.runs,
        [runId]: {
          id: runId,
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
    }))

    const patch = (changes: Partial<RunState>) =>
      set((state) => {
        const existing = state.runs[runId]
        if (!existing) return state
        return { runs: { ...state.runs, [runId]: { ...existing, ...changes } } }
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
      playback: { ...state.playback, round: state.runs[runId]?.rounds.length ?? 0, playing: false },
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
