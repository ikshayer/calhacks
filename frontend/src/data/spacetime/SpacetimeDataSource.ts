import type { SimDataSource } from '@/data/SimDataSource'
import type {
  Audience,
  ChatTurn,
  CompanyProfile,
  ContentSignals,
  Decision,
  IdeaPlainExplanation,
  IdeaTestInput,
  IdeaTestResult,
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
import { buildMillbrookAudience, fetchMillbrookWorld } from '@/data/millbrook'
import { predictionProfile } from '@/data/predictionProfile'
import { simulationProfile } from '@/data/simulationProfile'
import type { MillbrookWorld } from '@/data/millbrookTypes'
import { DbConnection } from '@/module_bindings'
import type {
  Decision as DecisionRow,
  IdeaTest as IdeaTestRow,
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

/** The worker's local upload endpoint, used when the store passes no VITE_UPLOAD_URL. */
const DEFAULT_UPLOAD_URL = 'http://127.0.0.1:8787'

/** How long to wait for the worker before giving up on a step, in milliseconds. */
const WAIT = { analysis: 120_000, report: 120_000, reply: 60_000, explanation: 60_000, comparison: 60_000, ideaTest: 180_000 }

const TABLES = [
  'company_profile',
  'video',
  'run',
  'round_event',
  'decision',
  'report',
  'chat_message',
  'idea_chat_message',
  'job',
  'comparison',
  'idea_test',
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
  private connection?: Promise<DbConnection>
  private identityHex = ''
  private readonly listeners = new Set<() => void>()

  private world?: Promise<MillbrookWorld>
  private audience?: Audience
  /** The onboarding profile id is a constant, so it is scoped to this browser's identity on the shared database. */
  private remoteProfileId = ''

  private readonly uploadUrl: string

  constructor(host: string, database: string, uploadUrl = DEFAULT_UPLOAD_URL) {
    this.host = host
    this.database = database
    this.uploadUrl = uploadUrl.replace(/\/+$/, '')
    this.label = `Live backend (SpacetimeDB ${database})`
  }

  // -------------------------------------------------------------------------
  // SimDataSource
  // -------------------------------------------------------------------------

  async loadAudience(profile: CompanyProfile): Promise<Audience> {
    const conn = await this.connect()
    // The same 50 Millbrook residents as the mock, so the audience is identical across drivers.
    this.world ??= fetchMillbrookWorld().catch((cause: unknown) => {
      this.world = undefined
      throw cause
    })
    // With audience groups switched off, the simulation sees one neutral group (simulationProfile).
    const simulated = simulationProfile(structuredClone(profile))
    const audience = buildMillbrookAudience(await this.world, simulated)
    if (this.audience && this.audience.key === audience.key && this.audience.version === audience.version) return this.audience
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
      groups: simulated.groups,
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
        profileJson: predictionProfile(m),
      })),
      edges: audience.edges,
    })
    // Reference reels ground the report. Scrape once, in the background, for a new profile.
    if (isNew) await conn.reducers.requestReferences({ profileId })

    this.remoteProfileId = profileId
    this.audience = audience
    return audience
  }

  async analyseVideo(campaignId: string, input: VideoInput, label: string): Promise<VideoAnalysis> {
    const conn = await this.connect()
    let name: string
    let sourceUrl: string
    if (input.file) {
      name = input.file.name
      sourceUrl = await this.uploadFile(input.file)
    } else {
      const demo = DEMO_VIDEOS.find((d) => d.file === input.name)
      if (!demo) throw new Error(`"${input.name}" is not one of the demo videos.`)
      name = demo.file
      sourceUrl = `demo:${demo.file}`
    }

    const clientKey = crypto.randomUUID()
    await conn.reducers.createVideo({
      clientKey,
      profileId: this.profileId(),
      campaignId,
      label,
      name,
      durationSec: input.durationSec,
      sourceUrl,
    })
    const row = await this.waitFor(WAIT.analysis, 'the video analysis', () => {
      const v = [...conn.db.video.iter()].find((row) => row.clientKey === clientKey)
      if (!v || (v.status !== 'ready' && v.status !== 'failed')) return undefined
      if (v.status === 'failed') throw new Error(`Video analysis failed: ${v.error ?? 'unknown error'}`)
      return v
    })
    return toVideo(row, this.uploadUrl)
  }

  async reviseSignals(videoId: string, signals: ContentSignals): Promise<VideoAnalysis> {
    const conn = await this.connect()
    const row = conn.db.video.id.find(BigInt(videoId))
    if (!row) throw new Error(`reviseSignals: unknown video ${videoId}`)
    await conn.reducers.reviseSignals({ videoId: row.id, signals, summary: row.summary })
    return toVideo({ ...row, signals, status: 'ready' }, this.uploadUrl)
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

  async chatIdea(ideaId: string, _history: ChatTurn[], message: string): Promise<string> {
    const conn = await this.connect()
    const id = BigInt(ideaId)
    const before = [...conn.db.ideaChatMessage.iter()].reduce((max, row) => row.ideaId === id ? Math.max(max, row.sequence) : max, 0)
    await conn.reducers.sendIdeaChatMessage({ ideaId: id, content: message })
    const reply = await this.waitFor(WAIT.reply, 'an idea-report reply', () => {
      const row = [...conn.db.ideaChatMessage.iter()].find((candidate) => candidate.ideaId === id && candidate.sequence === before + 2 && candidate.role === 'assistant')
      if (!row || row.status === 'pending') return undefined
      if (row.status === 'failed') throw new Error(`The assistant could not answer: ${row.content}`)
      return row
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

  async testIdea(input: IdeaTestInput, onProgress: (stage: string) => void): Promise<IdeaTestResult> {
    const conn = await this.connect()
    const profileId = this.profileId()
    const mine = (row: IdeaTestRow) =>
      row.profileId === profileId && row.owner.toHexString() === this.identityHex && row.prompt === input.prompt
    const before = [...conn.db.ideaTest.iter()].reduce((max, row) => (mine(row) && row.id > max ? row.id : max), 0n)
    await conn.reducers.testIdea({
      profileId,
      prompt: input.prompt,
      budgetUsd: input.budgetUsd,
      options: input.options,
    })
    const find = () =>
      [...conn.db.ideaTest.iter()].filter((row) => mine(row) && row.id > before).sort((a, b) => (a.id < b.id ? 1 : -1))[0]
    let lastStage = ''
    const row = await this.waitFor(WAIT.ideaTest, 'the idea test', () => {
      const r = find()
      if (!r) return undefined
      if (r.status === 'failed') throw new Error(`The idea test failed: ${r.error ?? 'unknown error'}`)
      if (r.status === 'ready') return r
      const stage = [...conn.db.job.iter()].find((j) => j.kind === 'test_idea' && j.targetId === r.id.toString())?.stage ?? ''
      if (stage && stage !== lastStage) {
        lastStage = stage
        onProgress(stage)
      }
      return undefined
    })
    return toIdeaTest(row)
  }

  async explainIdeaResident(ideaId: string, memberId: number): Promise<string> {
    const conn = await this.connect()
    const id = BigInt(ideaId)
    const find = () => {
      const row = [...conn.db.ideaTest.iter()].find((r) => r.id === id)
      return row?.residents.find((r) => r.memberId === memberId)
    }
    const existing = find()
    if (!existing) throw new Error(`No resident ${memberId} in this idea test.`)
    if (existing.reason) return existing.reason
    await conn.reducers.requestIdeaReason({ ideaId: id, memberId })
    return this.waitFor(WAIT.explanation, 'the resident’s reason', () => find()?.reason || undefined)
  }

  // -------------------------------------------------------------------------
  // Connection and waiting
  // -------------------------------------------------------------------------

  /** Sends the file to the worker on this machine and returns the `upload:<name>` source it stored it under. */
  private async uploadFile(file: File): Promise<string> {
    let response: Response
    try {
      response = await fetch(`${this.uploadUrl}/upload`, {
        method: 'POST',
        // Headers must be ASCII; the worker decodes this, so "café 🌱.mp4" survives.
        headers: { 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      })
    } catch (cause: unknown) {
      throw new Error(
        `Could not reach the upload server at ${this.uploadUrl}. Is the worker running? (${errorText(cause, 'network error')})`,
      )
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`Upload failed (${response.status}): ${uploadError(text)}`)
    const body: unknown = JSON.parse(text)
    if (typeof body === 'object' && body !== null && 'source' in body && typeof body.source === 'string') return body.source
    throw new Error(`The upload server returned an unexpected reply: ${text.slice(0, 200)}`)
  }

  private profileId(): string {
    if (!this.remoteProfileId) throw new Error('The audience has not been saved to the backend yet.')
    return this.remoteProfileId
  }

  private connect(): Promise<DbConnection> {
    if (this.connection) return this.connection

    let resolveConnection!: (connection: DbConnection) => void
    let rejectConnection!: (error: Error) => void
    const pending = new Promise<DbConnection>((resolve, reject) => {
      resolveConnection = resolve
      rejectConnection = reject
    })
    // Cache before starting the SDK: even a synchronous builder error must be
    // able to clear this exact attempt so the next action can retry.
    this.connection = pending
    let connection: DbConnection | undefined
    let failed = false
    const fail = (error: Error, conn = connection) => {
      if (failed) return
      failed = true
      if (this.connection === pending) this.connection = undefined
      rejectConnection(error)
      // A rejected subscription is terminal for this attempt. Explicitly stop
      // automatic reconnect rather than retaining a socket with an empty cache.
      conn?.disconnect()
    }

    const tokenKey = `spacetime-token:${this.database}`
    try {
      connection = DbConnection.builder()
        .withUri(this.host)
        .withDatabaseName(this.database)
        .withToken(readStorage(tokenKey))
        .withAutomaticReconnect()
        .onConnect((conn, identity, token) => {
          if (failed || this.connection !== pending) {
            conn.disconnect()
            return
          }
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
          conn.db.ideaChatMessage.onInsert(notify)
          conn.db.ideaChatMessage.onUpdate(notify)
          conn.db.job.onInsert(notify)
          conn.db.job.onUpdate(notify)
          conn.db.comparison.onInsert(notify)
          conn.db.comparison.onUpdate(notify)
          conn.db.ideaTest.onInsert(notify)
          conn.db.ideaTest.onUpdate(notify)
          conn
            .subscriptionBuilder()
            .onApplied(() => {
              if (!failed && this.connection === pending) resolveConnection(conn)
            })
            .onError((ctx) => fail(subscriptionError(this.database, ctx.event), conn))
            .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`))
        })
        .onConnectError((_ctx, error) => {
          fail(new Error(`Could not connect to SpacetimeDB at ${this.host}: ${error.message}`, { cause: error }))
        })
        .build()
      // A builder may report an error before returning its connection handle.
      if (failed) connection.disconnect()
    } catch (cause: unknown) {
      fail(new Error(`Could not initialize SpacetimeDB at ${this.host}: ${errorText(cause, 'unknown error')}`, { cause }))
    }
    return pending
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

/** The server's `{error}` text if the body is that JSON, otherwise the body itself. */
function uploadError(text: string): string {
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') return body.error
  } catch {
    // Not JSON: the raw text below is the best description available.
  }
  return text || 'no details from the server'
}

function videoUrl(row: VideoRow, uploadUrl: string): string {
  const source = row.sourceUrl ?? `demo:${row.name}`
  if (source.startsWith('upload:')) return `${uploadUrl}/uploads/${encodeURIComponent(source.slice('upload:'.length))}`
  if (source.startsWith('demo:')) return `/demo/${source.slice('demo:'.length)}`
  throw new Error(`Video ${row.id} has an unknown source "${source}".`)
}

function toVideo(row: VideoRow, uploadUrl: string): VideoAnalysis {
  if (!row.signals) throw new Error(`Video ${row.id} has no analysis yet.`)
  return {
    id: row.id.toString(),
    campaignId: row.campaignId,
    label: row.label,
    name: row.name,
    durationSec: row.signals.durationSec,
    signals: row.signals,
    summary: row.summary,
    objectUrl: videoUrl(row, uploadUrl),
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

function subscriptionError(database: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message
    : typeof cause === 'string' && cause ? cause : 'The server did not provide an error reason.'
  const missingSchema = /no such table|unknown table|table[^\n]*(?:not found|does not exist)|schema[^\n]*mismatch/i.test(detail)
  const action = missingSchema
    ? ' The deployed database schema does not match this app. Publish the updated SpacetimeDB module to this database, then restart the worker and reload the page.'
    : ''
  return new Error(`Could not subscribe to SpacetimeDB database ${database}: ${detail}${action}`, { cause })
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

function toIdeaTest(row: IdeaTestRow): IdeaTestResult {
  if (row.status !== 'running' && row.status !== 'ready' && row.status !== 'failed') {
    throw new Error(`Unknown idea test status "${row.status}".`)
  }
  return {
    id: row.id.toString(),
    status: row.status,
    prompt: row.prompt,
    idea: row.idea,
    targetLabel: row.targetLabel,
    minAge: row.minAge,
    maxAge: row.maxAge,
    residents: row.residents,
    metrics: row.metrics,
    analysis: row.analysis,
    plain: parsePlain(row.plainJson, row.id.toString()),
    error: row.error,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPoint(value: unknown): value is { what: string; because: string } {
  return isRecord(value) && typeof value.what === 'string' && typeof value.because === 'string'
}

function isPlainExplanation(value: unknown): value is IdeaPlainExplanation {
  if (!isRecord(value)) return false
  const { answer, bestBet, experiment, howYouKnow, objections } = value
  return (
    isRecord(answer) &&
    typeof answer.text === 'string' &&
    typeof answer.because === 'string' &&
    isPoint(bestBet) &&
    isPoint(experiment) &&
    isPoint(howYouKnow) &&
    Array.isArray(objections) &&
    objections.every((o) => isRecord(o) && typeof o.reason === 'string' && typeof o.because === 'string')
  )
}

function parsePlain(json: string, id: string): IdeaPlainExplanation | undefined {
  if (json === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    console.warn(`Idea test ${id}: plainJson is not valid JSON; showing the long-form analysis.`, error)
    return undefined
  }
  if (!isPlainExplanation(parsed)) {
    console.warn(`Idea test ${id}: plainJson does not have the expected shape; showing the long-form analysis.`)
    return undefined
  }
  return parsed
}
