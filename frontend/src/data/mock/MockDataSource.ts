import { createRng, hashSeed } from '../../lib/rng.ts'
import type { SimDataSource } from '@/data/SimDataSource'
import type {
  Audience,
  ChatTurn,
  CompanyProfile,
  ContentSignals,
  Decision,
  IdeaTestResult,
  Report,
  RunEvent,
  RunId,
  RunOptions,
  RunMetrics,
  RunSummary,
  VideoAnalysis,
  VideoInput,
} from '@/data/types'
import { buildMillbrookAudience, fetchMillbrookWorld, TOWN_SIZE } from '../millbrook.ts'
import { simulationProfile } from '../simulationProfile.ts'
import type { MillbrookWorld } from '../millbrookTypes'
import { runCascade, scoreAudience, type CascadeResult } from './scriptedCascade.ts'
import { buildReport, plural } from './report.ts'

/** How long the mock pretends each backend stage takes, in milliseconds. */
const LATENCY = { scoring: 900, perRound: 650 }

interface StoredRun {
  summary: RunSummary
  decisions: Decision[]
  cascade: CascadeResult
  audience: Audience
  video: VideoAnalysis
  groupLabels: Map<string, string>
}

/**
 * Runs the entire simulation in the browser from a seed.
 *
 * This exists for two reasons, and the second one ships:
 *
 *  1. The frontend is buildable and demoable before the SpacetimeDB module and
 *     the Anthropic scoring pipeline exist.
 *  2. HACK.md requires an explicitly labelled offline replay as the fallback for
 *     a venue with no usable network. This is it.
 *
 * Every number it produces is a transparent heuristic, never a measurement. The
 * UI surfaces `label` so nobody can demo this while believing it is live.
 */
export class MockDataSource implements SimDataSource {
  readonly kind = 'mock' as const
  readonly label = 'Local simulation (no backend)'

  private world?: Promise<MillbrookWorld>
  private audience?: Audience
  /** Retained so group ids can be resolved back to the labels the user chose. */
  private profile?: CompanyProfile
  private readonly videos = new Map<string, VideoAnalysis>()
  private readonly runs = new Map<RunId, StoredRun>()
  private counter = 0
  /**
   * Distinguishes ids minted in this page load from ids restored from storage.
   *
   * Campaigns and their runs are persisted, but this counter restarts at zero on
   * every load, so a bare `video-1` after a reload would collide with the
   * `video-1` already sitting in a restored campaign and silently overwrite it.
   * A live backend mints globally unique ids; the mock has to fake that.
   */
  private readonly session = Math.random().toString(36).slice(2, 8)

  async loadAudience(profile: CompanyProfile): Promise<Audience> {
    const snapshot = structuredClone(profile)
    // Share concurrent reads, but allow retry after a failed read.
    this.world ??= fetchMillbrookWorld().catch((cause: unknown) => {
      this.world = undefined
      throw cause
    })
    const audience = buildMillbrookAudience(await this.world, simulationProfile(snapshot), TOWN_SIZE.total)
    this.profile = snapshot
    if (this.audience && this.audience.key === audience.key && this.audience.version === audience.version) return this.audience
    this.audience = audience
    return audience
  }

  async analyseVideo(campaignId: string, input: VideoInput, label: string): Promise<VideoAnalysis> {
    const id = `video-${this.session}-${++this.counter}`
    const signals = deriveSignals(input)
    const analysis: VideoAnalysis = {
      id,
      campaignId,
      label,
      name: input.name,
      durationSec: input.durationSec,
      signals,
      summary: describeContent(signals, input.name),
      // No file means a pre-loaded demo video, served from public/demo.
      objectUrl: input.file ? URL.createObjectURL(input.file) : `/demo/${input.name}`,
    }
    this.videos.set(id, analysis)
    return analysis
  }

  async reviseSignals(videoId: string, signals: ContentSignals): Promise<VideoAnalysis> {
    const existing = this.videos.get(videoId)
    if (!existing) throw new Error(`reviseSignals: unknown video ${videoId}`)
    const updated: VideoAnalysis = {
      ...existing,
      signals,
      summary: describeContent(signals, existing.name),
    }
    this.videos.set(videoId, updated)
    return updated
  }

  getVideo(videoId: string): VideoAnalysis | undefined {
    return this.videos.get(videoId)
  }

  async startRun(
    campaignId: string,
    videoId: string,
    label: string,
    options: RunOptions,
  ): Promise<RunId> {
    const audience = this.audience
    if (!audience) throw new Error('startRun: no audience loaded')
    if (options.audienceKey !== audience.key || options.audienceVersion !== audience.version) {
      throw new Error('The audience changed. Reload it before starting a run.')
    }
    const video = this.videos.get(videoId)
    if (!video) throw new Error(`startRun: unknown video ${videoId}`)

    const id = `run-${this.session}-${++this.counter}`
    const decisions = scoreAudience(audience, video.signals, options.seed)
    const cascade = runCascade(audience, decisions, options)

    this.runs.set(id, {
      summary: {
        id,
        campaignId,
        videoId,
        label,
        options,
        status: 'scoring',
        metrics: cascade.metrics,
      },
      decisions,
      cascade,
      audience,
      video: structuredClone(video),
      groupLabels: this.groupLabels(),
    })
    return id
  }

  /**
   * Replays the precomputed cascade one round at a time, on the timing a live
   * backend would deliver it. The UI buffers rounds and scrubs at its own pace,
   * exactly as it will with real SpacetimeDB round events.
   */
  subscribeRun(runId: RunId, onEvent: (event: RunEvent) => void): () => void {
    const stored = this.runs.get(runId)
    if (!stored) {
      onEvent({ type: 'failed', reason: `Unknown run ${runId}` })
      return () => {}
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    let cancelled = false
    const at = (delay: number, fn: () => void) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) fn()
        }, delay),
      )
    }

    const { metrics, rounds } = stored.cascade

    at(0, () =>
      onEvent({
        type: 'status',
        status: 'scoring',
        note: `Scoring ${stored.decisions.length} audience members`,
      }),
    )

    at(LATENCY.scoring, () => {
      // A run with too many failed scoring batches is not a result.
      if (metrics.coverage < 0.8) {
        stored.summary.status = 'failed'
        onEvent({
          type: 'failed',
          reason: `Only ${(metrics.coverage * 100).toFixed(0)}% of the audience could be scored. A run needs at least 80%.`,
        })
        return
      }
      stored.summary.status = 'cascading'
      onEvent({ type: 'status', status: 'cascading' })
      rounds.forEach((round, index) => {
        at(LATENCY.scoring + index * LATENCY.perRound, () => onEvent(round))
      })
      at(LATENCY.scoring + rounds.length * LATENCY.perRound, () => {
        stored.summary.status = 'complete'
        onEvent({ type: 'complete', metrics })
      })
    })

    return () => {
      cancelled = true
      for (const timer of timers) clearTimeout(timer)
    }
  }

  async getDecisions(runId: RunId): Promise<Decision[]> {
    return this.runs.get(runId)?.decisions ?? []
  }

  async getRun(runId: RunId): Promise<RunSummary | undefined> {
    return this.runs.get(runId)?.summary
  }

  async getReport(runId: RunId): Promise<Report> {
    const stored = this.runs.get(runId)
    if (!stored) throw new Error(`getReport: unknown run ${runId}`)
    return buildReport(runId, stored.video, stored.cascade.metrics, stored.audience, stored.groupLabels)
  }

  async chat(runId: RunId, _history: ChatTurn[], message: string): Promise<string> {
    const stored = this.runs.get(runId)
    if (!stored) return 'That run is no longer loaded, so I cannot ground an answer in it.'
    return answerFromRun(message, stored.video.signals, stored.cascade.metrics, stored.audience, stored.groupLabels)
  }

  /** The mock writes every explanation at scoring time. */
  async explainMember(runId: RunId, memberId: number): Promise<string> {
    const decision = this.runs.get(runId)?.decisions.find((d) => d.memberId === memberId)
    if (!decision) throw new Error(`explainMember: no decision for member ${memberId} in run ${runId}`)
    return decision.explanation
  }

  /** The local simulation has no written comparison; ComparePanel's verdict stands alone. */
  async compareRuns(): Promise<string | null> {
    return null
  }

  async testIdea(): Promise<IdeaTestResult> {
    throw new Error('Idea tests need the live backend (VITE_DATA_SOURCE=spacetime).')
  }

  async explainIdeaResident(): Promise<string> {
    throw new Error('Idea tests need the live backend (VITE_DATA_SOURCE=spacetime).')
  }

  private groupLabels(): Map<string, string> {
    return new Map((this.profile?.groups ?? []).map((g) => [g.id, g.label]))
  }
}

// ---------------------------------------------------------------------------
// Stand-in content analysis
// ---------------------------------------------------------------------------

/**
 * Derives content signals from the file itself.
 *
 * This is the one place the mock is unavoidably fake: reading a hook out of a
 * video needs frame sampling and a model. It hashes the name and size so a
 * given file always analyses the same way (a demo must not shift between
 * takes), and the UI presents the result as an editable stand-in rather than a
 * measurement.
 */
function deriveSignals(input: VideoInput): ContentSignals {
  const rng = createRng(hashSeed(`${input.name}:${input.file?.size ?? input.durationSec}`))
  const longForm = input.durationSec > 45

  return {
    // A long cut is assumed to open slower. A declared assumption, not a finding.
    hookStrength: clamp01(rng.range(0.3, 0.6) - (longForm ? 0.12 : 0)),
    clarityOfAsk: clamp01(rng.range(0.25, 0.55)),
    pacing: clamp01(rng.range(0.35, 0.7) - (longForm ? 0.1 : 0)),
    warmth: clamp01(rng.range(0.5, 0.85)),
    topics: ['volunteering', 'gardening', 'community', 'food waste', 'fresh produce'],
    durationSec: input.durationSec,
  }
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

const band = (n: number, low: string, mid: string, high: string) =>
  n < 0.4 ? low : n < 0.7 ? mid : high

function describeContent(signals: ContentSignals, name: string): string {
  return [
    `"${name}" runs ${signals.durationSec.toFixed(0)}s.`,
    `The opening is ${band(signals.hookStrength, 'slow to commit', 'serviceable', 'strong')},`,
    `the edit is ${band(signals.pacing, 'loose', 'steady', 'tight')},`,
    `and the ask is ${band(signals.clarityOfAsk, 'left implicit', 'stated once', 'explicit and repeated')}.`,
    `Tone reads ${band(signals.warmth, 'detached', 'friendly', 'genuinely warm')}.`,
  ].join(' ')
}

// ---------------------------------------------------------------------------
// Stand-in follow-up chat
// ---------------------------------------------------------------------------

function answerFromRun(
  message: string,
  signals: ContentSignals,
  metrics: RunMetrics,
  audience: Audience,
  labels: Map<string, string>,
): string {
  const q = message.toLowerCase()
  const labelFor = (groupId: string) => labels.get(groupId) ?? groupId

  const ranked = [...metrics.byGroup].sort(
    (a, b) => b.likes + b.shares - (a.likes + a.shares),
  )
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]

  if (q.includes('share') || q.includes('spread')) {
    return [
      `Sharing is the scarcest action in this run: ${plural(metrics.shares, 'share')} against ${plural(metrics.likes, 'like')}.`,
      best
        ? `"${labelFor(best.groupId)}" drove most of it (${plural(best.shares, 'share')} from ${best.exposed} exposed).`
        : '',
      signals.clarityOfAsk < 0.6
        ? 'The simulation attributes the ceiling to the ask: at this clarity, members who liked it still had nothing specific to pass on.'
        : 'The ask is explicit enough that members who watched through had something concrete to forward.',
      'Note this is a modelled explanation, not observed behaviour.',
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (q.includes('hook') || q.includes('open') || q.includes('first')) {
    return `The opening scores ${(signals.hookStrength * 100).toFixed(0)}/100 in this analysis, which is what holds watch-through to ${metrics.watch} of ${metrics.uniqueExposed} exposed. Raising it is the single change the model responds to most, because every later action is conditional on watching through. That sensitivity is a property of the model, not a measured elasticity.`
  }

  if (q.includes('group') || q.includes('who') || q.includes('audience')) {
    return [
      best
        ? `Strongest response: "${labelFor(best.groupId)}" (${plural(best.likes, 'like')}, ${plural(best.shares, 'share')}).`
        : '',
      worst && worst !== best
        ? `Weakest: "${labelFor(worst.groupId)}" (${plural(worst.likes, 'like')} from ${worst.exposed} exposed).`
        : '',
      `Group shares come from onboarding assumptions, so these are relative signals across segments rather than audience measurements.`,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return [
    `This run exposed ${metrics.uniqueExposed} of ${audience.members.length} simulated members over ${metrics.rounds} rounds,`,
    `producing ${plural(metrics.watch, 'watch-through')}, ${plural(metrics.likes, 'like')}, ${plural(metrics.comments, 'comment')} and ${plural(metrics.shares, 'share')}.`,
    `Coverage was ${(metrics.coverage * 100).toFixed(0)}% (${plural(metrics.missing, 'member')} had no prediction).`,
    `Ask about the hook, the ask, or a specific group and I can be more concrete.`,
    `This is the local simulation, so treat every number as a modelled ranking signal rather than a forecast.`,
  ].join(' ')
}
