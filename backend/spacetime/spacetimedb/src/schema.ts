import { schema, table, t } from 'spacetimedb/server';

/**
 * Tables mirror frontend/src/data/types.ts field for field, so the frontend's
 * SpacetimeDataSource is a thin mapping. Ids are u64 here and strings in the
 * UI; convert with `.toString()` / `BigInt(...)` at the boundary.
 *
 * Privacy: every user-owned row carries `owner`, and reducers check it on
 * writes. Tables are still `public: true` for reads; owner-scoped visibility
 * filters are an open team decision in HACK.md.
 */

// ---------------------------------------------------------------------------
// Shared object types
// ---------------------------------------------------------------------------

export const AudienceGroup = t.object('AudienceGroup', {
  id: t.string(),
  label: t.string(),
  share: t.f64(),
  color: t.string(),
  blurb: t.string(),
  interests: t.array(t.string()),
});

export const ContentSignals = t.object('ContentSignals', {
  hookStrength: t.f64(),
  clarityOfAsk: t.f64(),
  pacing: t.f64(),
  warmth: t.f64(),
  topics: t.array(t.string()),
  durationSec: t.f64(),
});

export const RunOptions = t.object('RunOptions', {
  seed: t.u32(),
  audienceVersion: t.u32(),
  seedExposure: t.f64(),
  maxRounds: t.u32(),
});

export const GroupMetrics = t.object('GroupMetrics', {
  groupId: t.string(),
  exposed: t.u32(),
  watch: t.u32(),
  likes: t.u32(),
  comments: t.u32(),
  shares: t.u32(),
});

export const Spread = t.object('Spread', { p10: t.f64(), p50: t.f64(), p90: t.f64() });

export const RunMetrics = t.object('RunMetrics', {
  uniqueExposed: t.u32(),
  watch: t.u32(),
  likes: t.u32(),
  comments: t.u32(),
  shares: t.u32(),
  rounds: t.u32(),
  coverage: t.f64(),
  missing: t.u32(),
  byGroup: t.array(GroupMetrics),
  spread: Spread,
});

export const MemberInput = t.object('MemberInput', {
  memberId: t.u32(),
  name: t.string(),
  groupId: t.string(),
  interests: t.array(t.string()),
  persona: t.string(),
  hotButtons: t.array(t.string()),
  ignores: t.array(t.string()),
  model: t.string(),
  accessory: t.option(t.string()),
  onIsland: t.bool(),
  /** Full resident profile as JSON (Millbrook: personality, values, goals, …). '' for generated audiences. */
  profileJson: t.string(),
});

export const EdgeInput = t.object('EdgeInput', { a: t.u32(), b: t.u32() });

export const DecisionInput = t.object('DecisionInput', {
  memberId: t.u32(),
  pWatch: t.f64(),
  pLike: t.f64(),
  pComment: t.f64(),
  pShare: t.f64(),
  explanation: t.string(),
  missing: t.bool(),
});

export const Acted = t.object('Acted', { memberId: t.u32(), kinds: t.array(t.string()) });
export const ShareEvent = t.object('ShareEvent', { from: t.u32(), to: t.array(t.u32()) });

/** One scraped public reel. Every metric is optional: missing stays missing, never 0. */
export const ReelInput = t.object('ReelInput', {
  shortCode: t.string(),
  url: t.string(),
  ownerUsername: t.string(),
  caption: t.string(),
  hashtags: t.array(t.string()),
  durationSec: t.option(t.f64()),
  plays: t.option(t.u64()),
  likes: t.option(t.u64()),
  comments: t.option(t.u64()),
  shares: t.option(t.u64()),
  postedAt: t.option(t.string()),
  videoUrl: t.option(t.string()),
  thumbnailUrl: t.option(t.string()),
  transcript: t.option(t.string()),
});

/** Report shapes mirror frontend/src/data/types.ts (TimestampedNote, RewrittenHook, ReferenceExample). */
export const TimestampedNote = t.object('TimestampedNote', {
  at: t.f64(),
  /** 'strength' | 'risk' | 'fix' */
  severity: t.string(),
  title: t.string(),
  detail: t.string(),
});

export const RewrittenHook = t.object('RewrittenHook', {
  label: t.string(),
  original: t.string(),
  suggestion: t.string(),
  rationale: t.string(),
});

/** Observed metrics are copied from the scrape, never written by a model. Missing stays missing. */
export const ObservedMetrics = t.object('ObservedMetrics', {
  plays: t.option(t.u64()),
  likes: t.option(t.u64()),
  comments: t.option(t.u64()),
});

export const ReferenceExample = t.object('ReferenceExample', {
  title: t.string(),
  account: t.string(),
  url: t.option(t.string()),
  observed: ObservedMetrics,
  whyRelevant: t.string(),
});

// ---------------------------------------------------------------------------
// Idea test: "would people come?" without a video
// ---------------------------------------------------------------------------

/** One campaign alternative the user is weighing, e.g. { name: 'Campus flyers', costUsd: 50 }. */
export const CampaignOption = t.object('CampaignOption', { name: t.string(), costUsd: t.f64() });

/** One resident's simulated intent for the idea. Probabilities are raw JEV P(yes); not calibrated (no real data for ideas). */
export const IdeaResident = t.object('IdeaResident', {
  memberId: t.u32(),
  name: t.string(),
  age: t.u32(),
  groupId: t.string(),
  /** True when the resident matches the audience the prompt asked about (e.g. ages 18-21). */
  inTarget: t.bool(),
  pVisit: t.f64(),
  pReturn: t.f64(),
  pShare: t.f64(),
  /** P(notices and acts on) each CampaignOption, same order as idea_test.options. */
  optionInterest: t.array(t.f64()),
  /** One short reason, written by Claude, for the residents the analyst cites; '' otherwise. */
  reason: t.string(),
  missing: t.bool(),
});

/** Totals computed in code from IdeaResident rows, never by a model. */
export const IdeaMetrics = t.object('IdeaMetrics', {
  scored: t.u32(),
  inTarget: t.u32(),
  /** Residents with pVisit >= 0.5. */
  interested: t.u32(),
  interestedInTarget: t.u32(),
  /** Sum of pVisit: simulated visits if every resident heard about it once. Not a forecast. */
  expectedVisits: t.f64(),
  expectedShares: t.f64(),
  /** Per option: sum of optionInterest × pVisit (simulated visits that option would drive). */
  optionVisits: t.array(t.f64()),
});

/** The Campaign Strategy Analyst's write-up (Claude). Observations, assumptions and recommendations stay separate. */
export const IdeaAnalysis = t.object('IdeaAnalysis', {
  recommendedCampaign: t.string(),
  evidence: t.array(t.string()),
  segments: t.array(t.string()),
  objections: t.array(t.string()),
  budgetAllocation: t.string(),
  experiment: t.string(),
  successMetric: t.string(),
  assumptions: t.array(t.string()),
  limitations: t.array(t.string()),
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** The module publisher. Only they can set the worker secret. */
const admin = table({ name: 'admin' }, { identity: t.identity().primaryKey() });

/** Shared secret a worker presents to register. Private table. */
const workerSecret = table({ name: 'worker_secret' }, { id: t.u32().primaryKey(), secret: t.string() });

/** Identities allowed to call worker-only reducers. */
const worker = table({ name: 'worker', public: true }, {
  identity: t.identity().primaryKey(),
  registeredAt: t.timestamp(),
});

const companyProfile = table({ name: 'company_profile', public: true }, {
  id: t.string().primaryKey(),
  owner: t.identity().index('btree'),
  name: t.string(),
  pitch: t.string(),
  website: t.option(t.string()),
  instagram: t.option(t.string()),
  location: t.option(t.string()),
  objective: t.string(),
  tone: t.array(t.string()),
  inspirationAccounts: t.array(t.string()),
  groups: t.array(AudienceGroup),
  audienceVersion: t.u32(),
  updatedAt: t.timestamp(),
});

const audienceMember = table(
  {
    name: 'audience_member',
    public: true,
    indexes: [{ accessor: 'byAudience', algorithm: 'btree', columns: ['profileId', 'audienceVersion'] }],
  },
  {
    rowId: t.u64().primaryKey().autoInc(),
    profileId: t.string(),
    audienceVersion: t.u32(),
    memberId: t.u32(),
    name: t.string(),
    groupId: t.string(),
    interests: t.array(t.string()),
    persona: t.string(),
    hotButtons: t.array(t.string()),
    ignores: t.array(t.string()),
    model: t.string(),
    accessory: t.option(t.string()),
    onIsland: t.bool(),
    /** See MemberInput.profileJson. Appended with a default so existing databases migrate. */
    profileJson: t.string().default(''),
  }
);

const audienceEdge = table(
  {
    name: 'audience_edge',
    public: true,
    indexes: [{ accessor: 'byAudience', algorithm: 'btree', columns: ['profileId', 'audienceVersion'] }],
  },
  {
    rowId: t.u64().primaryKey().autoInc(),
    profileId: t.string(),
    audienceVersion: t.u32(),
    a: t.u32(),
    b: t.u32(),
  }
);

/** An uploaded campaign video and, once analysed, its content signals. */
const video = table({ name: 'video', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  /** Client-generated key so the uploader can find the row it just created. */
  clientKey: t.string().unique(),
  owner: t.identity().index('btree'),
  campaignId: t.string().index('btree'),
  label: t.string(),
  name: t.string(),
  durationSec: t.f64(),
  /** Where the worker can fetch the file. Upload storage is still open. */
  sourceUrl: t.option(t.string()),
  /** 'pending' | 'analysing' | 'ready' | 'failed' */
  status: t.string(),
  signals: t.option(ContentSignals),
  summary: t.string(),
  error: t.option(t.string()),
  createdAt: t.timestamp(),
  /** The company profile this video is for. Appended with a default so existing databases migrate. */
  profileId: t.string().default(''),
  /**
   * The worker's full reading as JSON: { transcript, onScreenText, notes }, with
   * timestamps in seconds. Grounds the report and chat. Empty until analysed.
   */
  analysisJson: t.string().default(''),
});

const run = table({ name: 'run', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  clientKey: t.string().unique(),
  owner: t.identity().index('btree'),
  profileId: t.string(),
  campaignId: t.string().index('btree'),
  videoId: t.u64(),
  label: t.string(),
  options: RunOptions,
  /** RunStatus: 'scoring' | 'cascading' | 'complete' | 'failed' */
  status: t.string(),
  metrics: t.option(RunMetrics),
  failureReason: t.option(t.string()),
  createdAt: t.timestamp(),
});

const decision = table(
  {
    name: 'decision',
    public: true,
    indexes: [{ accessor: 'byRunMember', algorithm: 'btree', columns: ['runId', 'memberId'] }],
  },
  {
    rowId: t.u64().primaryKey().autoInc(),
    runId: t.u64(),
    memberId: t.u32(),
    pWatch: t.f64(),
    pLike: t.f64(),
    pComment: t.f64(),
    pShare: t.f64(),
    explanation: t.string(),
    missing: t.bool(),
  }
);

/** One cascade round of the canonical trial. The island replays these. */
const roundEvent = table({ name: 'round_event', public: true }, {
  rowId: t.u64().primaryKey().autoInc(),
  runId: t.u64().index('btree'),
  round: t.u32(),
  exposed: t.array(t.u32()),
  acted: t.array(Acted),
  shares: t.array(ShareEvent),
  ignored: t.array(t.u32()),
});

/**
 * Work queue for the Node worker (video analysis, scoring, Apify scrapes).
 * Holds ids only, so it can stay readable by the worker if user tables are
 * later filtered per owner.
 */
const job = table({ name: 'job', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  /** 'analyse_video' | 'score_run' | 'scrape_references' */
  kind: t.string(),
  targetId: t.string(),
  /** 'queued' | 'claimed' | 'done' | 'failed' */
  status: t.string().index('btree'),
  claimedBy: t.option(t.identity()),
  error: t.option(t.string()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  /** What a claimed job is doing right now, e.g. 'Transcribing speech' or 'Scoring 120/300 members'. For the UI. */
  stage: t.string().default(''),
});

/** Public reference reels scraped with Apify for a company's niche. */
const referenceReel = table(
  {
    name: 'reference_reel',
    public: true,
    indexes: [{ accessor: 'byProfileShortCode', algorithm: 'btree', columns: ['profileId', 'shortCode'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    profileId: t.string(),
    shortCode: t.string(),
    url: t.string(),
    ownerUsername: t.string(),
    caption: t.string(),
    hashtags: t.array(t.string()),
    durationSec: t.option(t.f64()),
    plays: t.option(t.u64()),
    likes: t.option(t.u64()),
    comments: t.option(t.u64()),
    shares: t.option(t.u64()),
    postedAt: t.option(t.string()),
    /** Instagram CDN links expire; download promptly if the reel will be analysed. */
    videoUrl: t.option(t.string()),
    thumbnailUrl: t.option(t.string()),
    transcript: t.option(t.string()),
    /** JEV P(relevant to the niche), once scored. */
    relevance: t.option(t.f64()),
    /** 'unscored' | 'retained' | 'rejected' | 'uncertain' */
    relevanceStatus: t.string(),
    scrapedAt: t.timestamp(),
  }
);

/** One report per run, written by the worker after the cascade completes. */
const report = table({ name: 'report', public: true }, {
  runId: t.u64().primaryKey(),
  owner: t.identity().index('btree'),
  /** 'writing' | 'ready' | 'failed' */
  status: t.string(),
  summary: t.string(),
  notes: t.array(TimestampedNote),
  hooks: t.array(RewrittenHook),
  references: t.array(ReferenceExample),
  /** Disclosures written by code, not by the model. */
  assumptions: t.array(t.string()),
  error: t.option(t.string()),
  updatedAt: t.timestamp(),
});

/** Follow-up chat about one run. An assistant row starts 'pending' and the worker fills it. */
const chatMessage = table({ name: 'chat_message', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  runId: t.u64().index('btree'),
  owner: t.identity(),
  /** 'user' | 'assistant' */
  role: t.string(),
  content: t.string(),
  /** 'done' | 'pending' | 'failed' */
  status: t.string(),
  createdAt: t.timestamp(),
});

// --- Original-vs-revision comparison ----------------------------------------

/** Mean calibrated per-exposure probabilities over matched members. */
export const Means = t.object('Means', {
  pWatch: t.f64(),
  pLike: t.f64(),
  pComment: t.f64(),
  pShare: t.f64(),
});

export const GroupComparison = t.object('GroupComparison', {
  groupId: t.string(),
  /** Members with a valid decision in both runs. */
  matched: t.u32(),
  base: Means,
  revised: Means,
  /** revised - base. */
  delta: Means,
});

/** Run-metric differences, revised minus original (canonical trial). */
export const MetricDeltas = t.object('MetricDeltas', {
  uniqueExposed: t.i32(),
  watch: t.i32(),
  likes: t.i32(),
  comments: t.i32(),
  shares: t.i32(),
  rounds: t.i32(),
});

/** One original-vs-revision comparison, computed in the module; the worker only writes the prose summary. */
const comparison = table({ name: 'comparison', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity().index('btree'),
  baseRunId: t.u64(),
  revisedRunId: t.u64(),
  /** 'computing' | 'ready' | 'failed'. Numbers are final at insert; 'computing' covers the summary. */
  status: t.string(),
  audienceSize: t.u32(),
  /** Members with a valid decision in both runs. */
  matched: t.u32(),
  /** matched / audienceSize. */
  coverage: t.f64(),
  baseMeans: Means,
  revisedMeans: Means,
  /** revised - original, over matched members. */
  deltaMeans: Means,
  groups: t.array(GroupComparison),
  metricDeltas: MetricDeltas,
  /** Total actions per trial across the seeded trials, from each run's metrics. */
  baseSpread: Spread,
  revisedSpread: Spread,
  /** 'revised' | 'original' | 'inconclusive' */
  verdict: t.string(),
  summary: t.string(),
  error: t.option(t.string()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

/** An idea tested against the residents without a video. The worker parses, scores and analyses it. */
const ideaTest = table({ name: 'idea_test', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity().index('btree'),
  profileId: t.string(),
  prompt: t.string(),
  budgetUsd: t.option(t.f64()),
  options: t.array(CampaignOption),
  /** 'running' | 'ready' | 'failed'. Live progress is on the job's stage. */
  status: t.string(),
  /** Parsed by Claude from the prompt: what is being tested and for whom. */
  idea: t.string(),
  targetLabel: t.string(),
  minAge: t.option(t.u32()),
  maxAge: t.option(t.u32()),
  residents: t.array(IdeaResident),
  metrics: t.option(IdeaMetrics),
  analysis: t.option(IdeaAnalysis),
  error: t.option(t.string()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const spacetimedb = schema({
  comparison,
  admin,
  workerSecret,
  worker,
  companyProfile,
  audienceMember,
  audienceEdge,
  video,
  run,
  decision,
  roundEvent,
  job,
  referenceReel,
  report,
  chatMessage,
  ideaTest,
});
export default spacetimedb;
