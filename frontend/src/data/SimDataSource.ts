import type {
  Audience,
  ContentSignals,
  ChatTurn,
  CompanyProfile,
  IdeaTestInput,
  IdeaTestResult,
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
 *  - `MockDataSource` runs the cascade in the browser from a seed and provides
 *    a labeled offline demo.
 *  - `SpacetimeDataSource` maps these calls onto owner-scoped SpacetimeDB
 *    tables and subscriptions.
 *
 * `VITE_DATA_SOURCE` selects the driver.
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
   * Restore saved campaign signals when a video is reattached and analysed again.
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

  getReport(runId: RunId, retryFailed?: boolean): Promise<Report>

  /** Follow-up chat, grounded in the profile, the upload and the run results. */
  chat(runId: RunId, history: ChatTurn[], message: string): Promise<string>

  /** Follow-up about a ready idea report. No video or video-run ID is required. */
  chatIdea(ideaId: string, history: ChatTurn[], message: string): Promise<string>

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

  /**
   * Ask the simulated town about an idea that has no video yet. `onProgress`
   * receives the worker's stage text while it runs; the promise resolves with
   * the finished test or rejects with the worker's error.
   */
  testIdea(input: IdeaTestInput, onProgress: (stage: string) => void): Promise<IdeaTestResult>

  /**
   * Why one resident would or would not go for a tested idea. The live backend
   * writes it on demand the first time it is asked for, then caches it.
   */
  explainIdeaResident(ideaId: string, memberId: number): Promise<string>
}
