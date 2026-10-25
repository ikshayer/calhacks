import type { MillbrookHousehold, MillbrookPersona } from './millbrookTypes'

/**
 * The vocabulary shared by every part of the frontend.
 *
 * These types are the contract between the UI and whatever is producing
 * simulation data — the mock driver today, the SpacetimeDB subscription once
 * the module lands. Keep them free of any rendering or transport concern.
 */

// ---------------------------------------------------------------------------
// Company profile (built during onboarding)
// ---------------------------------------------------------------------------

export type GroupId = string

/**
 * One audience segment. Shares are assumptions the user confirmed during
 * onboarding, not measured follower demographics — the UI must say so.
 */
export interface AudienceGroup {
  id: GroupId
  label: string
  /** Proportion of the audience, 0..1. Shares across all groups sum to 1. */
  share: number
  /** Drives the district tint on the island and the series colour in charts. */
  color: string
  blurb: string
  interests: string[]
}

export type Objective = 'engagement' | 'reach' | 'conversion'

export interface CompanyProfile {
  id: string
  name: string
  /** One sentence: what the product is and who it is for. */
  pitch: string
  website?: string
  instagram?: string
  location?: string
  objective: Objective
  tone: string[]
  inspirationAccounts: string[]
  groups: AudienceGroup[]
  /** Bumped whenever the groups change, so runs can declare which audience they used. */
  audienceVersion: number
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** A synthetic audience member. Archetypes, not real people. */
export interface AudienceMember {
  /** Stable audience member id. Use IslandSim lookups for the sampled villager index. */
  id: number
  name: string
  groupId: GroupId
  interests: string[]
  persona: string
  /** Complete, read-only source identity and household from the Millbrook snapshot. */
  millbrook?: { readonly persona: MillbrookPersona; readonly household: MillbrookHousehold }
  hotButtons: string[]
  ignores: string[]
  /** Visual asset hint; recognized Mii ids are honored, legacy stems use a render adapter. */
  model: string
  /** Optional Kenney accessory GLB (glasses, cane, hearing aid, …). */
  accessory?: string
  /** True for the subset rendered on the island; the rest exist only in the statistics. */
  onIsland: boolean
}

/** Undirected link in the sharing graph. `a` < `b` by construction, so pairs are unique. */
export interface Edge {
  a: number
  b: number
}

export interface Audience {
  version: number
  /** Dataset and group configuration identity; absent on legacy generated audiences. */
  key?: string
  members: AudienceMember[]
  edges: Edge[]
  /** `adjacency[i]` lists the member ids linked to member `i`. */
  adjacency: number[][]
}

// ---------------------------------------------------------------------------
// Uploaded video and its analysis
// ---------------------------------------------------------------------------

/**
 * What the content-analysis stage extracts from a video.
 *
 * In the shipped pipeline these come from sampled frames plus on-screen text
 * (and a transcript once transcription lands). They are the only thing the
 * simulation sees of the video, which is what lets an original and a revision
 * produce different outcomes.
 */
export interface ContentSignals {
  /** How much the first second earns the next one. */
  hookStrength: number
  /** Whether the viewer knows what they are being asked to do. */
  clarityOfAsk: number
  /** Edit rhythm: too slow loses people, too fast loses the message. */
  pacing: number
  /** Human warmth - real faces, real place names. */
  warmth: number
  /** Topic tags, matched against member interests. */
  topics: string[]
  durationSec: number
}

export interface VideoInput {
  name: string
  durationSec: number
  /** Present for a real upload; absent for the built-in demo clip. */
  file?: File
}

export interface VideoAnalysis {
  id: string
  campaignId: string
  label: string
  name: string
  durationSec: number
  signals: ContentSignals
  /** Plain-language read of the content, shown above the report. */
  summary: string
  /** Object URL for playback. Revoke when the campaign is cleared. */
  objectUrl?: string
}

// ---------------------------------------------------------------------------
// Campaign (one uploaded video and everything simulated against it)
// ---------------------------------------------------------------------------

export type CampaignId = string

/**
 * One campaign in the history list.
 *
 * A campaign outlives the page: the metadata, signals and run results are
 * persisted, but the video file itself is not — browsers cannot hand a `File`
 * back after a reload. `posterDataUrl` is a single captured frame so a restored
 * campaign still has a face in the list, and `videoAvailable` tells the UI
 * whether the player can be shown or the user has to re-attach the file.
 */
export interface Campaign {
  id: CampaignId
  profileId: string
  title: string
  /** Epoch ms. Sorted newest-first in the history list. */
  createdAt: number
  videoId: string
  videoName: string
  durationSec: number
  /** JPEG data URL of one frame, ~320px wide. Absent if capture failed. */
  posterDataUrl?: string
  /** False after a reload: metadata survived, the file did not. */
  videoAvailable: boolean
  signals: ContentSignals
  summary: string
  /** Newest last. */
  runIds: RunId[]
  /** Headline numbers from the most recent complete run, for the history card. */
  headline?: {
    runId: RunId
    uniqueExposed: number
    likes: number
    comments: number
    shares: number
    coverage: number
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export type ReactionKind = 'watch' | 'like' | 'comment' | 'share'

/**
 * One member's predicted response, conditional on being exposed.
 * `missing` marks a failed scoring batch — "no prediction", never zero.
 */
export interface Decision {
  memberId: number
  pWatch: number
  pLike: number
  pComment: number
  pShare: number
  explanation: string
  missing?: boolean
}

export interface RunOptions {
  /** Preserved across original and revision so the comparison is fair. */
  seed: number
  audienceVersion: number
  /** Absent on historical runs created before persona-backed audiences. */
  audienceKey?: string
  /** Proportion of the audience exposed in round 0. A declared assumption. */
  seedExposure: number
  maxRounds: number
}

export type RunId = string

/** What happened in one cascade round. The island choreographs itself from these. */
export interface RoundEvent {
  type: 'round'
  round: number
  /** Member ids exposed for the first time this round. */
  exposed: number[]
  /** Members who acted, and what they did. Each member acts at most once per run. */
  acted: { memberId: number; kinds: ReactionKind[] }[]
  /** Edge activations: `from` shared, exposing `to` next round. Drives the share trails. */
  shares: { from: number; to: number[] }[]
  /** Exposed but did nothing. */
  ignored: number[]
}

export interface GroupMetrics {
  groupId: GroupId
  exposed: number
  watch: number
  likes: number
  comments: number
  shares: number
}

/**
 * Run totals. Exposure and interactions are reported separately and never
 * summed together — HACK.md is explicit that reach, views and interactions are
 * not interchangeable quantities.
 */
export interface RunMetrics {
  /** Distinct members who saw the video at least once. */
  uniqueExposed: number
  watch: number
  likes: number
  comments: number
  shares: number
  rounds: number
  /** Fraction of the audience with a valid prediction. A run fails below 0.8. */
  coverage: number
  /** Members whose scoring batch failed. Counted, never treated as a zero. */
  missing: number
  byGroup: GroupMetrics[]
  /** Spread across seeded trials. Describes variability within the model's assumptions. */
  spread: { p10: number; p50: number; p90: number }
}

export type RunStatus = 'idle' | 'scoring' | 'cascading' | 'complete' | 'failed'

export interface RunSummary {
  id: RunId
  campaignId: CampaignId
  videoId: string
  label: string
  options: RunOptions
  status: RunStatus
  metrics?: RunMetrics
}

export type RunEvent =
  | RoundEvent
  | { type: 'status'; status: RunStatus; note?: string }
  | { type: 'complete'; metrics: RunMetrics }
  | { type: 'failed'; reason: string }

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** A note anchored to a real timestamp in the uploaded video. */
export interface TimestampedNote {
  /** Seconds into the video. */
  at: number
  severity: 'strength' | 'risk' | 'fix'
  title: string
  detail: string
}

export interface RewrittenHook {
  label: string
  original: string
  suggestion: string
  rationale: string
}

export interface ReferenceExample {
  title: string
  account: string
  url?: string
  /** Observed metrics from the scrape. Missing stays missing — never shown as 0. */
  observed: { plays?: number; likes?: number; comments?: number }
  whyRelevant: string
}

export interface Report {
  runId: RunId
  summary: string
  notes: TimestampedNote[]
  hooks: RewrittenHook[]
  references: ReferenceExample[]
  /** Disclosures the demo is required to surface. */
  assumptions: string[]
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}
