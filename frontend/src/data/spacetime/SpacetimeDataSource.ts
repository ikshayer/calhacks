import { hashSeed } from '@/lib/rng'
import type { SimDataSource } from '@/data/SimDataSource'
import type {
  Audience,
  ChatTurn,
  CompanyProfile,
  ContentSignals,
  Decision,
  Report,
  RoundEvent,
  RunEvent,
  RunId,
  RunMetrics,
  RunOptions,
  RunStatus,
  RunSummary,
  VideoAnalysis,
  VideoInput,
} from '@/data/types'
import { generateAudience, type AudienceSize } from '@/data/mock/personas'
import { DbConnection } from '@/module_bindings'
import type {
  Decision as DecisionRow,
  Report as ReportRow,
  RoundEvent as RoundEventRow,
  Run as RunRow,
  RunMetrics as RunMetricsRow,
  Video as VideoRow,
} from '@/module_bindings/types'

/**
 * Pre-loaded demo videos. They live in `public/demo`, so the browser plays the
 * same file the worker analyses (`demo:<file>`). HACK.md: no real upload storage.
 */
export const DEMO_VIDEOS = [
  { file: 'original.mp4', label: 'Original', durationSec: 18 },
  { file: 'revised.mp4', label: 'Revision', durationSec: 18 },
] as const

/** How long to wait for the worker before giving up on a step, in milliseconds. */
const WAIT = { analysis: 120_000, report: 120_000, reply: 60_000, explanation: 60_000, comparison: 60_000 }

const TABLES = [
  'company_profile',
  'video',
  'run',
  'round_event',
  'decision',
  'report',
  'chat_message',
  'job',
  'comparison',
] as const

/**
 * Maps the SimDataSource contract onto the SpacetimeDB module and its worker.
 *
 * The browser keeps its own anonymous identity (token in localStorage), so it
 * owns what it creates. Slow work (video analysis, scoring, report, chat) is
 * done by the worker; every method that waits for it watches the subscribed
 * tables until the row it needs reaches a terminal state.
 */
export class SpacetimeDataSource implements SimDataSource {
  readonly kind = 'spacetime' as const
  readonly label: string

  private readonly host: string
  private readonly database: string
  private readonly size: AudienceSize
  private connection?: Promise<DbConnection>
  private identityHex = ''
  private readonly listeners = new Set<() => void>()

  private audience?: Audience
  private audienceKey = ''
  /** The onboarding profile id is a constant, so it is scoped to this browser's identity on the shared database. */
  private remoteProfileId = ''

  constructor(host: string, database: string, size: AudienceSize) {
    this.host = host
    this.database = database
    this.size = size
    this.label = `Live backend (SpacetimeDB ${database})`
  }

  // -------------------------------------------------------------------------
  // SimDataSource
  // -------------------------------------------------------------------------

  async loadAudience(profile: CompanyProfile): Promise<Audience> {
    const conn = await this.connect()
    const key = `${profile.id}:${profile.audienceVersion}:${profile.groups
      .map((g) => `${g.id}@${g.share.toFixed(4)}`)
      .join(',')}`
    if (this.audience && this.audienceKey === key) return this.audience

    // Same seeded generator as the mock, so the audience is identical across drivers.
    const audience = generateAudience(profile, this.size, hashSeed(key))
    const profileId = `${profile.id}-${this.identityHex.slice(0, 16)}`
    const isNew = !conn.db.companyProfile.id.find(profileId)

    await conn.reducers.upsertProfile({
      id: profileId,
      name: profile.name,
      pitch: profile.pitch,
      website: profile.website || undefined,
      instagram: profile.instagram || undefined,
      location: profile.location || undefined,
      objective: profile.objective,
      tone: profile.tone,
      inspirationAccounts: profile.inspirationAccounts,
      groups: profile.groups,
      audienceVersion: profile.audienceVersion,
    })
    await conn.reducers.saveAudience({
      profileId,
      audienceVersion: profile.audienceVersion,
      members: audience.members.map((m) => ({
        memberId: m.id,
        name: m.name,
        groupId: m.groupId,
        interests: m.interests,
        persona: m.persona,
        hotButtons: m.hotButtons,
        ignores: m.ignores,
        model: m.model,
        accessory: m.accessory,
        onIsland: m.onIsland,
      })),
      edges: audience.edges,
    })
    // Reference reels ground the report. Scrape once, in the background, for a new profile.
    if (isNew) await conn.reducers.requestReferences({ profileId })

    this.remoteProfileId = profileId
    this.audience = audience
    this.audienceKey = key
    return audience
  }

  async analyseVideo(campaignId: string, input: VideoInput, label: string): Promise<VideoAnalysis> {
    const conn = await this.connect()
    if (input.file) {
      throw new Error('The live backend only analyses the pre-loaded demo videos. Use "Original demo" or "Revision demo".')
    }
    const demo = DEMO_VIDEOS.find((d) => d.file === input.name)
    if (!demo) throw new Error(`"${input.name}" is not one of the demo videos.`)

    const clientKey = crypto.randomUUID()
    await conn.reducers.createVideo({
      clientKey,
      profileId: this.profileId(),
      campaignId,
      label,
      name: demo.file,
      durationSec: input.durationSec,
      sourceUrl: `demo:${demo.file}`,
    })
    const row = await this.waitFor(WAIT.analysis, 'the video analysis', () => {
      const v = [...conn.db.video.iter()].find((row) => row.clientKey === clientKey)
      if (!v || (v.status !== 'ready' && v.status !== 'failed')) return undefined
      if (v.status === 'failed') throw new Error(`Video analysis failed: ${v.error ?? 'unknown error'}`)
      return v
    })
    return toVideo(row)
  }

  async reviseSignals(videoId: string, signals: ContentSignals): Promise<VideoAnalysis> {
    const conn = await this.connect()
    const row = conn.db.video.id.find(BigInt(videoId))
    if (!row) throw new Error(`reviseSignals: unknown video ${videoId}`)
    await conn.reducers.reviseSignals({ videoId: row.id, signals, summary: row.summary })
    return toVideo({ ...row, signals, status: 'ready' })
  }

  async startRun(campaignId: string, videoId: string, label: string, options: RunOptions): Promise<RunId> {
    const conn = await this.connect()
    const clientKey = crypto.randomUUID()
    await conn.reducers.startRun({
      clientKey,
      profileId: this.profileId(),
      campaignId,
      videoId: BigInt(videoId),
      label,
      options,
    })
    const row = [...conn.db.run.iter()].find((r) => r.clientKey === clientKey)
    if (!row) throw new Error('startRun: the run was created but has not arrived from the database')
    return row.id.toString()
  }

  subscribeRun(runId: RunId, onEvent: (event: RunEvent) => void): () => void {
    const id = BigInt(runId)
    let lastNote = ''
    let lastStatus: RunStatus | undefined
    let finished = false

    const check = (conn: DbConnection) => {
      if (finished) return
      const run = conn.db.run.id.find(id)
      if (!run) return

      if (run.status === 'failed') {
        finished = true
        onEvent({ type: 'failed', reason: run.failureReason ?? 'The run failed.' })
        return
      }
      if (run.status === 'complete' && run.metrics) {
        finished = true
        // The cascade runs in one transaction, so every round is present once the run completes.
        onEvent({ type: 'status', status: 'cascading' })
        const rounds = [...conn.db.roundEvent.iter()].filter((r) => r.runId === id).sort((a, b) => a.round - b.round)
        for (const round of rounds) onEvent(toRound(round))
        onEvent({ type: 'complete', metrics: toMetrics(run.metrics) })
        return
      }

      const job = [...conn.db.job.iter()].find((j) => j.kind === 'score_run' && j.targetId === runId)
      const note = job?.stage || (job?.status === 'queued' ? 'Waiting for the worker' : '')
      const status = toStatus(run.status)
      if (status !== lastStatus || note !== lastNote) {
        lastStatus = status
        lastNote = note
        onEvent({ type: 'status', status, note: note || undefined })
      }
    }

    let unsubscribe = () => {}
    let cancelled = false
    this.connect()
      .then((conn) => {
        if (cancelled) return
        const listener = () => check(conn)
        this.listeners.add(listener)
        unsubscribe = () => this.listeners.delete(listener)
        check(conn)
      })
      .catch((cause: unknown) => {
        if (!cancelled) onEvent({ type: 'failed', reason: errorText(cause, 'Could not reach the backend.') })
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }

  async getDecisions(runId: RunId): Promise<Decision[]> {
    const conn = await this.connect()
    const id = BigInt(runId)
    return [...conn.db.decision.iter()]
      .filter((d) => d.runId === id)
      .sort((a, b) => a.memberId - b.memberId)
      .map(toDecision)
  }

  async getRun(runId: RunId): Promise<RunSummary | undefined> {
    const conn = await this.connect()
    const row = conn.db.run.id.find(BigInt(runId))
    return row ? toRunSummary(row) : undefined
  }

  async getReport(runId: RunId): Promise<Report> {
    const conn = await this.connect()
    const id = BigInt(runId)
    const row = await this.waitFor(WAIT.report, 'the report', () => {
      const r = conn.db.report.runId.find(id)
      if (!r || r.status === 'writing') return undefined
      if (r.status === 'failed') throw new Error(`The report could not be written: ${r.error ?? 'unknown error'}`)
      return r
    })
    return toReport(row)
  }

  /** The server keeps the conversation, so `history` is not resent; it is rebuilt from chat_message rows. */
  async chat(runId: RunId, _history: ChatTurn[], message: string): Promise<string> {
    const conn = await this.connect()
    const id = BigInt(runId)
    const before = [...conn.db.chatMessage.iter()].reduce((max, m) => (m.runId === id && m.id > max ? m.id : max), 0n)
    await conn.reducers.sendChatMessage({ runId: id, content: message })
    const reply = await this.waitFor(WAIT.reply, 'a reply', () => {
      const m = [...conn.db.chatMessage.iter()].find((row) => row.runId === id && row.id > before && row.role === 'assistant')
      if (!m || m.status === 'pending') return undefined
      if (m.status === 'failed') throw new Error(`The assistant could not answer: ${m.content}`)
      return m
    })
    return reply.content
  }

  async explainMember(runId: RunId, memberId: number): Promise<string> {
    const conn = await this.connect()
    const id = BigInt(runId)
    const find = () => [...conn.db.decision.iter()].find((d) => d.runId === id && d.memberId === memberId)
    const existing = find()
    if (!existing) throw new Error(`No prediction for member ${memberId} in this run.`)
    if (existing.explanation) return existing.explanation
    await conn.reducers.requestExplanation({ runId: id, memberId })
    return this.waitFor(WAIT.explanation, 'the explanation', () => find()?.explanation || undefined)
  }

  async compareRuns(baseRunId: RunId, revisedRunId: RunId): Promise<string | null> {
    const conn = await this.connect()
    const base = BigInt(baseRunId)
    const revised = BigInt(revisedRunId)
    const find = () => [...conn.db.comparison.iter()].find((x) => x.baseRunId === base && x.revisedRunId === revised)
    // Reuse a finished or in-progress comparison; only ask for a new one when there is none (or it failed).
    const existing = find()
    if (!existing || existing.status === 'failed') {
      await conn.reducers.compareRuns({ baseRunId: base, revisedRunId: revised })
    }
    const row = await this.waitFor(WAIT.comparison, 'the comparison', () => {
      const c = find()
      if (!c || c.status === 'computing') return undefined
      if (c.status === 'failed') throw new Error(`The comparison could not be explained: ${c.error ?? 'unknown error'}`)
      return c
    })
    return row.summary
  }

  // -------------------------------------------------------------------------
  // Connection and waiting
  // -------------------------------------------------------------------------

  private profileId(): string {
    if (!this.remoteProfileId) throw new Error('The audience has not been saved to the backend yet.')
    return this.remoteProfileId
  }

  private connect(): Promise<DbConnection> {
    this.connection ??= new Promise<DbConnection>((resolve, reject) => {
      const tokenKey = `spacetime-token:${this.database}`
      DbConnection.builder()
        .withUri(this.host)
        .withDatabaseName(this.database)
        .withToken(readStorage(tokenKey))
        .withAutomaticReconnect()
        .onConnect((conn, identity, token) => {
          writeStorage(tokenKey, token)
          this.identityHex = identity.toHexString()
          const notify = () => {
            for (const listener of this.listeners) listener()
          }
          // Every table this driver waits on wakes the waiters; each re-checks its own row.
          conn.db.companyProfile.onInsert(notify)
          conn.db.video.onInsert(notify)
          conn.db.video.onUpdate(notify)
          conn.db.run.onInsert(notify)
          conn.db.run.onUpdate(notify)
          conn.db.roundEvent.onInsert(notify)
          conn.db.decision.onInsert(notify)
          conn.db.decision.onUpdate(notify)
          conn.db.report.onInsert(notify)
          conn.db.report.onUpdate(notify)
          conn.db.chatMessage.onInsert(notify)
          conn.db.chatMessage.onUpdate(notify)
          conn.db.job.onInsert(notify)
          conn.db.job.onUpdate(notify)
          conn.db.comparison.onInsert(notify)
          conn.db.comparison.onUpdate(notify)
          conn
            .subscriptionBuilder()
            .onApplied(() => resolve(conn))
            .onError(() => reject(new Error(`Could not subscribe to SpacetimeDB database ${this.database}.`)))
            .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`))
        })
        .onConnectError((_ctx, error) => {
          this.connection = undefined
          reject(new Error(`Could not connect to SpacetimeDB at ${this.host}: ${error.message}`))
        })
        .build()
    })
    return this.connection
  }

  /**
   * Resolves with `check()`'s first defined result, re-checking on every table
   * change. A throw from `check` rejects (the row reached a failed state).
   */
  private waitFor<T>(timeoutMs: number, what: string, check: () => T | undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer)
        this.listeners.delete(listener)
      }
      const listener = () => {
        try {
          const value = check()
          if (value === undefined) return
          done()
          resolve(value)
        } catch (error) {
          done()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
      const timer = setTimeout(() => {
        done()
        reject(new Error(`Timed out waiting for ${what}. Is the worker running?`))
      }, timeoutMs)
      this.listeners.add(listener)
      listener()
    })
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toVideo(row: VideoRow): VideoAnalysis {
  if (!row.signals) throw new Error(`Video ${row.id} has no analysis yet.`)
  return {
    id: row.id.toString(),
    campaignId: row.campaignId,
    label: row.label,
    name: row.name,
    durationSec: row.signals.durationSec,
    signals: row.signals,
    summary: row.summary,
    objectUrl: `/demo/${row.name}`,
  }
}

function toStatus(status: string): RunStatus {
  switch (status) {
    case 'scoring':
    case 'cascading':
    case 'complete':
    case 'failed':
      return status
    default:
      throw new Error(`Unknown run status "${status}" from the backend.`)
  }
}

function toMetrics(m: RunMetricsRow): RunMetrics {
  return { ...m, byGroup: m.byGroup, spread: m.spread }
}

function toRound(r: RoundEventRow): RoundEvent {
  return {
    type: 'round',
    round: r.round,
    exposed: r.exposed,
    acted: r.acted.map((a) => ({ memberId: a.memberId, kinds: a.kinds.filter(isReaction) })),
    shares: r.shares,
    ignored: r.ignored,
  }
}

const REACTIONS = ['watch', 'like', 'comment', 'share'] as const
function isReaction(kind: string): kind is (typeof REACTIONS)[number] {
  return (REACTIONS as readonly string[]).includes(kind)
}

function toDecision(d: DecisionRow): Decision {
  return {
    memberId: d.memberId,
    pWatch: d.pWatch,
    pLike: d.pLike,
    pComment: d.pComment,
    pShare: d.pShare,
    explanation: d.explanation,
    missing: d.missing,
  }
}

function toRunSummary(r: RunRow): RunSummary {
  return {
    id: r.id.toString(),
    campaignId: r.campaignId,
    videoId: r.videoId.toString(),
    label: r.label,
    options: r.options,
    status: toStatus(r.status),
    metrics: r.metrics ? toMetrics(r.metrics) : undefined,
  }
}

const SEVERITIES = ['strength', 'risk', 'fix'] as const
function toSeverity(s: string): (typeof SEVERITIES)[number] {
  const found = SEVERITIES.find((x) => x === s)
  if (!found) throw new Error(`Unknown note severity "${s}" from the backend.`)
  return found
}

const toCount = (n: bigint | undefined) => (n === undefined ? undefined : Number(n))

function toReport(r: ReportRow): Report {
  return {
    runId: r.runId.toString(),
    summary: r.summary,
    notes: r.notes.map((n) => ({ ...n, severity: toSeverity(n.severity) })),
    hooks: r.hooks,
    references: r.references.map((x) => ({
      title: x.title,
      account: x.account,
      url: x.url,
      observed: { plays: toCount(x.observed.plays), likes: toCount(x.observed.likes), comments: toCount(x.observed.comments) },
      whyRelevant: x.whyRelevant,
    })),
    assumptions: r.assumptions,
  }
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

/** Per-browser token storage. Private windows can throw; the connection then just gets a fresh identity. */
function readStorage(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.warn('Could not store the SpacetimeDB token; a reload will use a new identity.', error)
  }
}
