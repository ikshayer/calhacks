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

const spacetimedb = schema({
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
});
export default spacetimedb;
