import type {
  Audience,
  ContentSignals,
  ChatTurn,
  CompanyProfile,
  Decision,
  Report,
  RunEvent,
  RunId,
  RunOptions,
  RunSummary,
  VideoAnalysis,
  VideoInput,
} from './types'

/**
 * Everything the UI needs from the simulation backend, and nothing about how it
 * gets there.
 *
 * Two drivers implement this:
 *
 *  - `MockDataSource` runs the whole cascade in the browser from a seed. It is
 *    what makes the frontend buildable before the backend exists, and it is
 *    also the "explicitly labeled precomputed demo replay" that HACK.md
 *    requires as the offline fallback. It is not throwaway.
 *  - `SpacetimeDataSource` maps these calls onto owner-scoped SpacetimeDB
 *    tables and subscriptions.
 *
 * Both stay wired at the expo; `VITE_DATA_SOURCE` picks the default.
 */
export interface SimDataSource {
  /** Human-readable, shown in the UI so nobody demos the mock while believing it is live. */
  readonly kind: 'mock' | 'spacetime'
  readonly label: string

  /** Generate or fetch the audience and its sharing graph for a profile. */
  loadAudience(profile: CompanyProfile): Promise<Audience>

  /**
   * Analyse an uploaded video into the content signals the simulation reacts
   * to. The only stage that touches the file itself.
   */
  analyseVideo(campaignId: string, input: VideoInput, label: string): Promise<VideoAnalysis>

  /**
   * Record a user correction to the analysed signals.
   *
   * The content analysis is a model's read of the video, and the user knows the
   * video better than the model does. Correcting it is a product feature, not a
   * test hook: it is also how you ask "what would a clearer ask do here?"
   * without re-editing the footage first.
   */
  reviseSignals(videoId: string, signals: ContentSignals): Promise<VideoAnalysis>

  /** Kick off a run against an analysed video. Resolves once the run exists, not once it finishes. */
  startRun(campaignId: string, videoId: string, label: string, options: RunOptions): Promise<RunId>

  /**
   * Observe a run. The callback fires for scoring progress, then once per
   * cascade round, then a terminal `complete` or `failed`.
   * Returns an unsubscribe function.
   */
  subscribeRun(runId: RunId, onEvent: (event: RunEvent) => void): () => void

  /** Per-member predictions, for the villager detail card. */
  getDecisions(runId: RunId): Promise<Decision[]>

  getRun(runId: RunId): Promise<RunSummary | undefined>

  getReport(runId: RunId): Promise<Report>

  /** Follow-up chat, grounded in the profile, the upload and the run results. */
  chat(runId: RunId, history: ChatTurn[], message: string): Promise<string>

  /**
   * Why one simulated member would or would not engage. The live backend writes
   * it on demand (Claude) the first time a villager is opened, then caches it.
   */
  explainMember(runId: RunId, memberId: number): Promise<string>

  /**
   * A plain-language account of why one version did better, or why the result
   * is too close to call. `null` when the driver has no written comparison.
   * The verdict itself is computed in ComparePanel from the run spreads.
   */
  compareRuns(baseRunId: RunId, revisedRunId: RunId): Promise<string | null>
}
