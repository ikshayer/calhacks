import { t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, {
  AudienceGroup,
  ContentSignals,
  DecisionInput,
  EdgeInput,
  MemberInput,
  CampaignOption,
  IdeaAnalysis,
  IdeaMetrics,
  IdeaResident,
  ReelInput,
  ReferenceExample,
  RewrittenHook,
  RunOptions,
  TimestampedNote,
} from './schema';
import { runCascade } from './sim/cascade';
import { compareRuns as computeComparison } from './sim/compare';

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
  // A worker registers on every start. Anything it had claimed died with its
  // previous process, so put those jobs back in the queue instead of leaving
  // their reports and chat replies stuck in progress.
  for (const job of [...ctx.db.job.status.filter('claimed')]) {
    if (job.claimedBy && job.claimedBy.isEqual(ctx.sender)) {
      ctx.db.job.id.update({ ...job, status: 'queued', claimedBy: undefined, stage: '', updatedAt: ctx.timestamp });
    }
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
    stage: '',
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
    // The worker would read any local path or fetch any URL it is given, so clients may
    // only name a pre-loaded demo video or a file posted to the worker's upload endpoint.
    const source = args.sourceUrl ?? '';
    if (!source.startsWith('demo:') && !source.startsWith('upload:')) {
      throw new SenderError('sourceUrl must be "demo:<file>" or "upload:<file>"');
    }
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
      analysisJson: '',
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

/** Put a run's report back to 'writing' and queue the worker. Also runs automatically when a cascade completes. */
function queueReport(ctx: Ctx, run: { id: bigint; owner: Ctx['sender'] }) {
  const existing = ctx.db.report.runId.find(run.id);
  const blank = { status: 'writing', summary: '', notes: [], hooks: [], references: [], assumptions: [], error: undefined, updatedAt: ctx.timestamp };
  if (existing) ctx.db.report.runId.update({ ...existing, ...blank });
  else ctx.db.report.insert({ runId: run.id, owner: run.owner, ...blank });
  enqueue(ctx, 'write_report', run.id.toString());
}

/** Rewrite a completed run's report, e.g. after a failure. */
export const requestReport = spacetimedb.reducer({ runId: t.u64() }, (ctx, { runId }) => {
  const r = ctx.db.run.id.find(runId);
  if (!r) throw new SenderError('unknown run');
  requireOwner(ctx, r.owner);
  if (r.status !== 'complete') throw new SenderError(`run is ${r.status}, not complete`);
  if (ctx.db.report.runId.find(runId)?.status === 'writing') throw new SenderError('report is already being written');
  queueReport(ctx, r);
});

/** Ask a follow-up question about a run. The worker fills in the pending assistant reply. */
export const sendChatMessage = spacetimedb.reducer({ runId: t.u64(), content: t.string() }, (ctx, { runId, content }) => {
  const r = ctx.db.run.id.find(runId);
  if (!r) throw new SenderError('unknown run');
  requireOwner(ctx, r.owner);
  if (r.status !== 'complete') throw new SenderError(`run is ${r.status}, not complete`);
  const text = content.trim();
  if (!text) throw new SenderError('empty message');
  if (text.length > 2000) throw new SenderError('message is longer than 2000 characters');
  const history = [...ctx.db.chatMessage.runId.filter(runId)];
  if (history.some((m) => m.status === 'pending')) throw new SenderError('wait for the previous reply');

  ctx.db.chatMessage.insert({ id: 0n, runId, owner: ctx.sender, role: 'user', content: text, status: 'done', createdAt: ctx.timestamp });
  const reply = ctx.db.chatMessage.insert({
    id: 0n,
    runId,
    owner: ctx.sender,
    role: 'assistant',
    content: '',
    status: 'pending',
    createdAt: ctx.timestamp,
  });
  enqueue(ctx, 'chat_reply', reply.id.toString());
});

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

/** Live progress for the UI while a claimed job runs. */
export const setJobStage = spacetimedb.reducer({ jobId: t.u64(), stage: t.string() }, (ctx, { jobId, stage }) => {
  requireWorker(ctx);
  const row = ctx.db.job.id.find(jobId);
  if (!row) throw new SenderError('unknown job');
  if (row.status !== 'claimed') throw new SenderError(`job is ${row.status}, not claimed`);
  ctx.db.job.id.update({ ...row, stage, updatedAt: ctx.timestamp });
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
  // Only rows still in progress: a result already delivered (e.g. a step after it
  // failed, like writing a cache file) must not be overwritten.
  if (row.kind === 'analyse_video') {
    const v = ctx.db.video.id.find(BigInt(row.targetId));
    if (v && v.status !== 'ready') ctx.db.video.id.update({ ...v, status: 'failed', error });
  } else if (row.kind === 'score_run') {
    const r = ctx.db.run.id.find(BigInt(row.targetId));
    if (r && r.status === 'scoring') ctx.db.run.id.update({ ...r, status: 'failed', failureReason: error });
  } else if (row.kind === 'write_report') {
    const rep = ctx.db.report.runId.find(BigInt(row.targetId));
    if (rep && rep.status === 'writing') ctx.db.report.runId.update({ ...rep, status: 'failed', error, updatedAt: ctx.timestamp });
  } else if (row.kind === 'chat_reply') {
    const m = ctx.db.chatMessage.id.find(BigInt(row.targetId));
    if (m && m.status === 'pending') ctx.db.chatMessage.id.update({ ...m, status: 'failed', content: error });
  } else if (row.kind === 'explain_comparison') {
    const c = ctx.db.comparison.id.find(BigInt(row.targetId));
    if (c) ctx.db.comparison.id.update({ ...c, status: 'failed', error, updatedAt: ctx.timestamp });  } else if (row.kind === 'test_idea') {
    const idea = ctx.db.ideaTest.id.find(BigInt(row.targetId));
    if (idea && idea.status === 'running') ctx.db.ideaTest.id.update({ ...idea, status: 'failed', error, updatedAt: ctx.timestamp });
  }
});

export const setVideoAnalysis = spacetimedb.reducer(
  { videoId: t.u64(), signals: ContentSignals, summary: t.string(), analysisJson: t.string() },
  (ctx, { videoId, signals, summary, analysisJson }) => {
    requireWorker(ctx);
    const row = ctx.db.video.id.find(videoId);
    if (!row) throw new SenderError('unknown video');
    ctx.db.video.id.update({ ...row, signals, summary, analysisJson, status: 'ready', error: undefined });
  }
);

export const setReport = spacetimedb.reducer(
  {
    runId: t.u64(),
    summary: t.string(),
    notes: t.array(TimestampedNote),
    hooks: t.array(RewrittenHook),
    references: t.array(ReferenceExample),
    assumptions: t.array(t.string()),
  },
  (ctx, { runId, ...fields }) => {
    requireWorker(ctx);
    const rep = ctx.db.report.runId.find(runId);
    if (!rep) throw new SenderError('unknown report');
    ctx.db.report.runId.update({ ...rep, ...fields, status: 'ready', error: undefined, updatedAt: ctx.timestamp });
  }
);

export const setChatReply = spacetimedb.reducer({ messageId: t.u64(), content: t.string() }, (ctx, { messageId, content }) => {
  requireWorker(ctx);
  const m = ctx.db.chatMessage.id.find(messageId);
  if (!m) throw new SenderError('unknown message');
  if (m.role !== 'assistant' || m.status !== 'pending') throw new SenderError('message is not a pending reply');
  ctx.db.chatMessage.id.update({ ...m, content, status: 'done' });
});

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
  queueReport(ctx, r);
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

// ---------------------------------------------------------------------------
// Member explanations (on demand, written by Claude when a member is clicked)
// ---------------------------------------------------------------------------

/** Ask for a short explanation of one member's decision. Cached once written; a failed job leaves the decision unchanged, so asking again retries. */
export const requestExplanation = spacetimedb.reducer({ runId: t.u64(), memberId: t.u32() }, (ctx, { runId, memberId }) => {
  const r = ctx.db.run.id.find(runId);
  if (!r) throw new SenderError('unknown run');
  requireOwner(ctx, r.owner);
  if (r.status !== 'complete') throw new SenderError(`run is ${r.status}, not complete`);
  const [d] = [...ctx.db.decision.byRunMember.filter([runId, memberId])];
  if (!d) throw new SenderError('unknown member decision');
  if (d.missing) throw new SenderError('this member has no prediction to explain');
  if (d.explanation.length > 0) return;
  const targetId = `${runId}:${memberId}`;
  const inFlight = [...ctx.db.job.iter()].some(
    (j) => j.kind === 'explain_member' && j.targetId === targetId && (j.status === 'queued' || j.status === 'claimed'),
  );
  if (inFlight) return;
  enqueue(ctx, 'explain_member', targetId);
});

export const setExplanation = spacetimedb.reducer(
  { runId: t.u64(), memberId: t.u32(), explanation: t.string() },
  (ctx, { runId, memberId, explanation }) => {
    requireWorker(ctx);
    const [d] = [...ctx.db.decision.byRunMember.filter([runId, memberId])];
    if (!d) throw new SenderError('unknown member decision');
    ctx.db.decision.rowId.update({ ...d, explanation });
  }
);

// ---------------------------------------------------------------------------
// Original-vs-revision comparison
// ---------------------------------------------------------------------------

/**
 * Compare two completed runs of the same audience, graph, seed and starting
 * exposure. Numbers are computed here, deterministically; the worker only
 * writes the plain-language summary afterwards (`explain_comparison`).
 * Asking again for the same pair recomputes it in place.
 */
export const compareRuns = spacetimedb.reducer(
  { baseRunId: t.u64(), revisedRunId: t.u64() },
  (ctx, { baseRunId, revisedRunId }) => {
    if (baseRunId === revisedRunId) throw new SenderError('pick two different runs to compare');
    const base = ctx.db.run.id.find(baseRunId);
    const revised = ctx.db.run.id.find(revisedRunId);
    if (!base || !revised) throw new SenderError('unknown run');
    requireOwner(ctx, base.owner);
    requireOwner(ctx, revised.owner);
    if (base.status !== 'complete' || !base.metrics) throw new SenderError(`the original run is ${base.status}, not complete`);
    if (revised.status !== 'complete' || !revised.metrics) throw new SenderError(`the revised run is ${revised.status}, not complete`);
    if (base.profileId !== revised.profileId) throw new SenderError('the runs are for different company profiles');
    if (base.options.audienceVersion !== revised.options.audienceVersion) {
      throw new SenderError('the runs used different audience versions, so they are not like-for-like');
    }
    if (base.options.seedExposure !== revised.options.seedExposure) {
      throw new SenderError('the runs used different starting exposure, so they are not like-for-like');
    }
    if (base.options.seed !== revised.options.seed) {
      throw new SenderError('the runs used different trial seeds, so they are not like-for-like');
    }

    const members = [...ctx.db.audienceMember.byAudience.filter([base.profileId, base.options.audienceVersion])]
      .map((m) => ({ id: m.memberId, groupId: m.groupId }))
      .sort((a, b) => a.id - b.id);
    const result = computeComparison(
      members,
      [...ctx.db.decision.byRunMember.filter(baseRunId)],
      [...ctx.db.decision.byRunMember.filter(revisedRunId)],
      base.metrics.spread,
      revised.metrics.spread
    );
    if (result.matched === 0) throw new SenderError('no member has a valid prediction in both runs');

    const bm = base.metrics;
    const rm = revised.metrics;
    const fields = {
      audienceSize: result.audienceSize,
      matched: result.matched,
      coverage: result.coverage,
      baseMeans: result.base,
      revisedMeans: result.revised,
      deltaMeans: result.delta,
      groups: result.groups,
      metricDeltas: {
        uniqueExposed: rm.uniqueExposed - bm.uniqueExposed,
        watch: rm.watch - bm.watch,
        likes: rm.likes - bm.likes,
        comments: rm.comments - bm.comments,
        shares: rm.shares - bm.shares,
        rounds: rm.rounds - bm.rounds,
      },
      baseSpread: bm.spread,
      revisedSpread: rm.spread,
      verdict: result.verdict,
      status: 'computing',
      summary: '',
      error: undefined,
      updatedAt: ctx.timestamp,
    };

    const existing = [...ctx.db.comparison.owner.filter(ctx.sender)].find(
      (c) => c.baseRunId === baseRunId && c.revisedRunId === revisedRunId
    );
    if (existing) {
      if (existing.status === 'computing') throw new SenderError('this comparison is already being written');
      ctx.db.comparison.id.update({ ...existing, ...fields });
      enqueue(ctx, 'explain_comparison', existing.id.toString());
    } else {
      const row = ctx.db.comparison.insert({
        id: 0n,
        owner: ctx.sender,
        baseRunId,
        revisedRunId,
        createdAt: ctx.timestamp,
        ...fields,
      });
      enqueue(ctx, 'explain_comparison', row.id.toString());
    }
  }
);

export const setComparisonSummary = spacetimedb.reducer(
  { id: t.u64(), summary: t.string() },
  (ctx, { id, summary }) => {
    requireWorker(ctx);
    const c = ctx.db.comparison.id.find(id);
    if (!c) throw new SenderError('unknown comparison');
    ctx.db.comparison.id.update({ ...c, summary, status: 'ready', error: undefined, updatedAt: ctx.timestamp });
  }
);

// ---------------------------------------------------------------------------
// Idea test (no video): client asks, worker parses + scores + analyses
// ---------------------------------------------------------------------------

export const testIdea = spacetimedb.reducer(
  { profileId: t.string(), prompt: t.string(), budgetUsd: t.option(t.f64()), options: t.array(CampaignOption) },
  (ctx, { profileId, prompt, budgetUsd, options }) => {
    const profile = ctx.db.companyProfile.id.find(profileId);
    if (!profile) throw new SenderError('unknown profile');
    requireOwner(ctx, profile.owner);
    const text = prompt.trim();
    if (!text) throw new SenderError('describe the idea to test');
    if (text.length > 1000) throw new SenderError('the idea is longer than 1000 characters');
    if (options.length > 3) throw new SenderError('at most 3 campaign options');
    for (const o of options) {
      if (!o.name.trim()) throw new SenderError('every campaign option needs a name');
      if (!(o.costUsd >= 0)) throw new SenderError('campaign option costs must be zero or more');
    }
    if (budgetUsd !== undefined && !(budgetUsd >= 0)) throw new SenderError('the budget must be zero or more');
    const members = [...ctx.db.audienceMember.byAudience.filter([profileId, profile.audienceVersion])];
    if (members.length === 0) throw new SenderError('no audience saved for this profile yet');

    const row = ctx.db.ideaTest.insert({
      id: 0n,
      owner: ctx.sender,
      profileId,
      prompt: text,
      budgetUsd,
      options,
      status: 'running',
      idea: '',
      targetLabel: '',
      minAge: undefined,
      maxAge: undefined,
      residents: [],
      metrics: undefined,
      analysis: undefined,
      error: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      plainJson: '',
    });
    enqueue(ctx, 'test_idea', row.id.toString());
  }
);

export const setIdeaResult = spacetimedb.reducer(
  {
    id: t.u64(),
    idea: t.string(),
    targetLabel: t.string(),
    minAge: t.option(t.u32()),
    maxAge: t.option(t.u32()),
    residents: t.array(IdeaResident),
    metrics: IdeaMetrics,
    analysis: IdeaAnalysis,
    plainJson: t.string(),
  },
  (ctx, { id, ...fields }) => {
    requireWorker(ctx);
    const row = ctx.db.ideaTest.id.find(id);
    if (!row) throw new SenderError('unknown idea test');
    ctx.db.ideaTest.id.update({ ...row, ...fields, status: 'ready', error: undefined, updatedAt: ctx.timestamp });
  }
);

/** Ask for one resident's reason for their idea verdict; the worker writes it into idea_test.residents. Cached once written. */
export const requestIdeaReason = spacetimedb.reducer({ ideaId: t.u64(), memberId: t.u32() }, (ctx, { ideaId, memberId }) => {
  const idea = ctx.db.ideaTest.id.find(ideaId);
  if (!idea) throw new SenderError('unknown idea test');
  requireOwner(ctx, idea.owner);
  if (idea.status !== 'ready') throw new SenderError(`idea test is ${idea.status}, not ready`);
  const resident = idea.residents.find((r) => r.memberId === memberId);
  if (!resident) throw new SenderError('this resident was not part of the idea test');
  if (resident.missing) throw new SenderError('this resident has no prediction');
  if (resident.reason) return;
  const targetId = `${ideaId}:${memberId}`;
  const inFlight = [...ctx.db.job.iter()].some(
    (j) => j.kind === 'explain_idea_member' && j.targetId === targetId && (j.status === 'queued' || j.status === 'claimed')
  );
  if (!inFlight) enqueue(ctx, 'explain_idea_member', targetId);
});

export const setIdeaReason = spacetimedb.reducer(
  { ideaId: t.u64(), memberId: t.u32(), reason: t.string() },
  (ctx, { ideaId, memberId, reason }) => {
    requireWorker(ctx);
    const idea = ctx.db.ideaTest.id.find(ideaId);
    if (!idea) throw new SenderError('unknown idea test');
    if (!idea.residents.some((r) => r.memberId === memberId)) throw new SenderError('unknown resident for this idea test');
    const residents = idea.residents.map((r) => (r.memberId === memberId ? { ...r, reason } : r));
    ctx.db.ideaTest.id.update({ ...idea, residents, updatedAt: ctx.timestamp });
  }
);
