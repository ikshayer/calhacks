import { t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, {
  AudienceGroup,
  ContentSignals,
  DecisionInput,
  EdgeInput,
  MemberInput,
  ReelInput,
  RunOptions,
} from './schema';
import { runCascade } from './sim/cascade';

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

/** A run with less coverage than this is not a result (HACK.md sim spec). */
const MIN_COVERAGE = 0.8;
const CASCADE_TRIALS = 200;

// ---------------------------------------------------------------------------
// Lifecycle and access
// ---------------------------------------------------------------------------

export const init = spacetimedb.init((ctx) => {
  ctx.db.admin.insert({ identity: ctx.sender });
});

function requireAdmin(ctx: Ctx) {
  if (!ctx.db.admin.identity.find(ctx.sender)) throw new SenderError('admin only');
}

function requireWorker(ctx: Ctx) {
  if (!ctx.db.worker.identity.find(ctx.sender)) throw new SenderError('worker only');
}

function requireOwner(ctx: Ctx, owner: Ctx['sender']) {
  if (!owner.isEqual(ctx.sender)) throw new SenderError('not the owner');
}

/** Called once by the publisher, e.g. `spacetime call <db> set_worker_secret '"..."'`. */
export const setWorkerSecret = spacetimedb.reducer({ secret: t.string() }, (ctx, { secret }) => {
  requireAdmin(ctx);
  if (secret.length < 16) throw new SenderError('secret too short');
  const existing = ctx.db.workerSecret.id.find(0);
  if (existing) ctx.db.workerSecret.id.update({ ...existing, secret });
  else ctx.db.workerSecret.insert({ id: 0, secret });
});

/** The worker presents the shared secret once to be allowed to write results. */
export const registerWorker = spacetimedb.reducer({ secret: t.string() }, (ctx, { secret }) => {
  const stored = ctx.db.workerSecret.id.find(0);
  if (!stored || stored.secret !== secret) throw new SenderError('bad worker secret');
  if (!ctx.db.worker.identity.find(ctx.sender)) {
    ctx.db.worker.insert({ identity: ctx.sender, registeredAt: ctx.timestamp });
  }
});

function enqueue(ctx: Ctx, kind: string, targetId: string) {
  ctx.db.job.insert({
    id: 0n,
    kind,
    targetId,
    status: 'queued',
    claimedBy: undefined,
    error: undefined,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

// ---------------------------------------------------------------------------
// Client reducers: profile and audience
// ---------------------------------------------------------------------------

export const upsertProfile = spacetimedb.reducer(
  {
    id: t.string(),
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
  },
  (ctx, profile) => {
    const existing = ctx.db.companyProfile.id.find(profile.id);
    if (existing) {
      requireOwner(ctx, existing.owner);
      ctx.db.companyProfile.id.update({ ...existing, ...profile, updatedAt: ctx.timestamp });
    } else {
      ctx.db.companyProfile.insert({
        ...profile,
        website: profile.website,
        instagram: profile.instagram,
        location: profile.location,
        owner: ctx.sender,
        updatedAt: ctx.timestamp,
      });
    }
  }
);

/**
 * Store an audience version. Generated client-side for now (the frontend's
 * seeded persona generator); a worker can call this later with Claude-written
 * personas. Replaces any rows already stored for the same version.
 */
export const saveAudience = spacetimedb.reducer(
  {
    profileId: t.string(),
    audienceVersion: t.u32(),
    members: t.array(MemberInput),
    edges: t.array(EdgeInput),
  },
  (ctx, { profileId, audienceVersion, members, edges }) => {
    const profile = ctx.db.companyProfile.id.find(profileId);
    if (!profile) throw new SenderError('unknown profile');
    if (!ctx.db.worker.identity.find(ctx.sender)) requireOwner(ctx, profile.owner);

    members.forEach((m, index) => {
      if (m.memberId !== index) throw new SenderError('member ids must be dense 0..n-1');
    });
    for (const e of edges) {
      if (e.a >= members.length || e.b >= members.length) throw new SenderError('edge out of range');
    }

    for (const row of [...ctx.db.audienceMember.byAudience.filter([profileId, audienceVersion])]) {
      ctx.db.audienceMember.rowId.delete(row.rowId);
    }
    for (const row of [...ctx.db.audienceEdge.byAudience.filter([profileId, audienceVersion])]) {
      ctx.db.audienceEdge.rowId.delete(row.rowId);
    }
    for (const m of members) {
      ctx.db.audienceMember.insert({ rowId: 0n, profileId, audienceVersion, ...m });
    }
    for (const e of edges) {
      ctx.db.audienceEdge.insert({ rowId: 0n, profileId, audienceVersion, a: e.a, b: e.b });
    }
  }
);

// ---------------------------------------------------------------------------
// Client reducers: videos and runs
// ---------------------------------------------------------------------------

/** Register an uploaded video and queue its analysis. */
export const createVideo = spacetimedb.reducer(
  {
    clientKey: t.string(),
    profileId: t.string(),
    campaignId: t.string(),
    label: t.string(),
    name: t.string(),
    durationSec: t.f64(),
    sourceUrl: t.option(t.string()),
  },
  (ctx, args) => {
    if (ctx.db.video.clientKey.find(args.clientKey)) throw new SenderError('duplicate clientKey');
    const profile = ctx.db.companyProfile.id.find(args.profileId);
    if (!profile) throw new SenderError('unknown profile');
    requireOwner(ctx, profile.owner);
    const row = ctx.db.video.insert({
      id: 0n,
      ...args,
      sourceUrl: args.sourceUrl,
      owner: ctx.sender,
      status: 'pending',
      signals: undefined,
      summary: '',
      error: undefined,
      createdAt: ctx.timestamp,
    });
    enqueue(ctx, 'analyse_video', row.id.toString());
  }
);

/** The user corrects the model's read of the video (SimDataSource.reviseSignals). */
export const reviseSignals = spacetimedb.reducer(
  { videoId: t.u64(), signals: ContentSignals, summary: t.string() },
  (ctx, { videoId, signals, summary }) => {
    const row = ctx.db.video.id.find(videoId);
    if (!row) throw new SenderError('unknown video');
    requireOwner(ctx, row.owner);
    ctx.db.video.id.update({ ...row, signals, summary, status: 'ready' });
  }
);

/** Start a run against an analysed video; the worker scores it, then the cascade runs here. */
export const startRun = spacetimedb.reducer(
  {
    clientKey: t.string(),
    profileId: t.string(),
    campaignId: t.string(),
    videoId: t.u64(),
    label: t.string(),
    options: RunOptions,
  },
  (ctx, args) => {
    if (ctx.db.run.clientKey.find(args.clientKey)) throw new SenderError('duplicate clientKey');
    const v = ctx.db.video.id.find(args.videoId);
    if (!v) throw new SenderError('unknown video');
    requireOwner(ctx, v.owner);
    if (v.status !== 'ready' || !v.signals) throw new SenderError('video is not analysed yet');
    const profile = ctx.db.companyProfile.id.find(args.profileId);
    if (!profile) throw new SenderError('unknown profile');
    requireOwner(ctx, profile.owner);
    const members = [...ctx.db.audienceMember.byAudience.filter([args.profileId, args.options.audienceVersion])];
    if (members.length === 0) throw new SenderError('no audience saved for this version');
    if (args.options.seedExposure <= 0 || args.options.seedExposure > 1) {
      throw new SenderError('seedExposure must be in (0, 1]');
    }

    const row = ctx.db.run.insert({
      id: 0n,
      ...args,
      owner: ctx.sender,
      status: 'scoring',
      metrics: undefined,
      failureReason: undefined,
      createdAt: ctx.timestamp,
    });
    enqueue(ctx, 'score_run', row.id.toString());
  }
);

/** Queue an Apify scrape of reference reels for the profile's niche. */
export const requestReferences = spacetimedb.reducer({ profileId: t.string() }, (ctx, { profileId }) => {
  const profile = ctx.db.companyProfile.id.find(profileId);
  if (!profile) throw new SenderError('unknown profile');
  requireOwner(ctx, profile.owner);
  enqueue(ctx, 'scrape_references', profileId);
});

// ---------------------------------------------------------------------------
// Worker reducers
// ---------------------------------------------------------------------------

export const claimJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireWorker(ctx);
  const row = ctx.db.job.id.find(jobId);
  if (!row) throw new SenderError('unknown job');
  // Losing a race to another worker is an error, so the caller knows to skip it.
  if (row.status !== 'queued') throw new SenderError('job already claimed');
  ctx.db.job.id.update({ ...row, status: 'claimed', claimedBy: ctx.sender, updatedAt: ctx.timestamp });
});

export const finishJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireWorker(ctx);
  const row = ctx.db.job.id.find(jobId);
  if (!row) throw new SenderError('unknown job');
  ctx.db.job.id.update({ ...row, status: 'done', updatedAt: ctx.timestamp });
});

export const failJob = spacetimedb.reducer({ jobId: t.u64(), error: t.string() }, (ctx, { jobId, error }) => {
  requireWorker(ctx);
  const row = ctx.db.job.id.find(jobId);
  if (!row) throw new SenderError('unknown job');
  ctx.db.job.id.update({ ...row, status: 'failed', error, updatedAt: ctx.timestamp });

  // Surface the failure on the user-facing row too, so the UI never waits forever.
  if (row.kind === 'analyse_video') {
    const v = ctx.db.video.id.find(BigInt(row.targetId));
    if (v) ctx.db.video.id.update({ ...v, status: 'failed', error });
  } else if (row.kind === 'score_run') {
    const r = ctx.db.run.id.find(BigInt(row.targetId));
    if (r) ctx.db.run.id.update({ ...r, status: 'failed', failureReason: error });
  }
});

export const setVideoAnalysis = spacetimedb.reducer(
  { videoId: t.u64(), signals: ContentSignals, summary: t.string() },
  (ctx, { videoId, signals, summary }) => {
    requireWorker(ctx);
    const row = ctx.db.video.id.find(videoId);
    if (!row) throw new SenderError('unknown video');
    ctx.db.video.id.update({ ...row, signals, summary, status: 'ready', error: undefined });
  }
);

/** Append one scoring batch. Called once per ~10-member batch as Haiku returns. */
export const writeDecisions = spacetimedb.reducer(
  { runId: t.u64(), decisions: t.array(DecisionInput) },
  (ctx, { runId, decisions }) => {
    requireWorker(ctx);
    const r = ctx.db.run.id.find(runId);
    if (!r) throw new SenderError('unknown run');
    if (r.status !== 'scoring') throw new SenderError(`run is ${r.status}, not scoring`);
    // A retried batch replaces its earlier rows instead of duplicating them.
    for (const d of decisions) {
      const [existing] = [...ctx.db.decision.byRunMember.filter([runId, d.memberId])];
      if (existing) ctx.db.decision.rowId.update({ ...existing, ...d });
      else ctx.db.decision.insert({ rowId: 0n, runId, ...d });
    }
  }
);

/**
 * Run the cascade inside the database once scoring is done: 200 seeded trials,
 * the canonical trial's rounds written as round_event rows, metrics on the run.
 */
export const runCascadeForRun = spacetimedb.reducer({ runId: t.u64() }, (ctx, { runId }) => {
  requireWorker(ctx);
  const r = ctx.db.run.id.find(runId);
  if (!r) throw new SenderError('unknown run');
  if (r.status !== 'scoring') throw new SenderError(`run is ${r.status}, not scoring`);

  const members = [...ctx.db.audienceMember.byAudience.filter([r.profileId, r.options.audienceVersion])]
    .map((m) => ({ id: m.memberId, groupId: m.groupId }))
    .sort((a, b) => a.id - b.id);
  const edges = [...ctx.db.audienceEdge.byAudience.filter([r.profileId, r.options.audienceVersion])];
  const decisions = [...ctx.db.decision.byRunMember.filter(runId)];

  const { rounds, metrics } = runCascade(members, edges, decisions, r.options, CASCADE_TRIALS);

  if (metrics.coverage < MIN_COVERAGE) {
    ctx.db.run.id.update({
      ...r,
      status: 'failed',
      failureReason: `Only ${(metrics.coverage * 100).toFixed(0)}% of the audience could be scored. A run needs at least ${MIN_COVERAGE * 100}%.`,
    });
    return;
  }

  for (const round of rounds) {
    ctx.db.roundEvent.insert({ rowId: 0n, runId, ...round });
  }
  ctx.db.run.id.update({ ...r, status: 'complete', metrics });
});

/** Insert or refresh scraped reels for a profile, keyed by shortCode. */
export const upsertReferenceReels = spacetimedb.reducer(
  { profileId: t.string(), reels: t.array(ReelInput) },
  (ctx, { profileId, reels }) => {
    requireWorker(ctx);
    for (const reel of reels) {
      const [existing] = [...ctx.db.referenceReel.byProfileShortCode.filter([profileId, reel.shortCode])];
      if (existing) {
        // A plain re-scrape must not erase enrichment (transcript, shares) with undefined;
        // only the expiring CDN links always refresh.
        const defined = Object.fromEntries(Object.entries(reel).filter(([, v]) => v !== undefined));
        ctx.db.referenceReel.id.update({
          ...existing,
          ...defined,
          videoUrl: reel.videoUrl,
          thumbnailUrl: reel.thumbnailUrl,
          scrapedAt: ctx.timestamp,
        });
      } else {
        ctx.db.referenceReel.insert({
          id: 0n,
          profileId,
          ...reel,
          relevance: undefined,
          relevanceStatus: 'unscored',
          scrapedAt: ctx.timestamp,
        });
      }
    }
  }
);

export const setReelRelevance = spacetimedb.reducer(
  { reelId: t.u64(), relevance: t.option(t.f64()), relevanceStatus: t.string() },
  (ctx, { reelId, relevance, relevanceStatus }) => {
    requireWorker(ctx);
    const row = ctx.db.referenceReel.id.find(reelId);
    if (!row) throw new SenderError('unknown reel');
    ctx.db.referenceReel.id.update({ ...row, relevance, relevanceStatus });
  }
);
