import type { DbConnection } from './module_bindings/index.ts';
import type { CompanyProfile, ReferenceReel, Report, Run, RunMetrics, Video } from './module_bindings/types.ts';
import type { Note, OnScreenText } from './video/analyse.ts';
import type { TranscriptSegment } from './video/transcribe.ts';

/**
 * Everything the report and the follow-up chat may rely on, read from the
 * worker's subscription cache. Both jobs ground Claude in this and nothing else.
 */

export interface VideoAnalysis {
  transcript: TranscriptSegment[];
  onScreenText: OnScreenText[];
  notes: Note[];
}

export interface MemberEvidence {
  memberId: number;
  name: string;
  groupId: string;
  persona: string;
  hotButtons: string[];
  ignores: string[];
  /** Resident profile JSON (Millbrook), '' for generated audiences. */
  profileJson: string;
  pWatch: number;
  pShare: number;
}

export interface Grounding {
  run: Run;
  metrics: RunMetrics;
  profile: CompanyProfile;
  video: Video;
  durationSec: number;
  /** Members in the run's audience version. */
  audienceSize: number;
  analysis: VideoAnalysis;
  /** Per group: the members most and least likely to share, by calibrated pShare. */
  members: { groupId: string; label: string; likeliest: MemberEvidence[]; leastLikely: MemberEvidence[] }[];
  /** Scraped reels for this profile, best performers first. Index in this array is the reel's citation id. */
  references: ReferenceReel[];
  /** The run's report, when one is ready. */
  report?: Report;
}

const MEMBERS_PER_SIDE = 3;
const MAX_REFERENCES = 10;

function parseAnalysis(video: Video): VideoAnalysis {
  if (!video.analysisJson) throw new Error(`video ${video.id} has no stored analysis; re-run analyse_video`);
  const parsed: unknown = JSON.parse(video.analysisJson);
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`video ${video.id} analysisJson is not an object`);
  const { transcript, onScreenText, notes } = parsed as Record<string, unknown>;
  if (!Array.isArray(transcript) || !Array.isArray(onScreenText) || !Array.isArray(notes)) {
    throw new Error(`video ${video.id} analysisJson is missing transcript, onScreenText or notes`);
  }
  // Written by our own analyse_video job after validation, so the element shapes are trusted.
  return { transcript, onScreenText, notes } as VideoAnalysis;
}

export function buildGrounding(conn: DbConnection, runId: bigint): Grounding {
  const run = conn.db.run.id.find(runId);
  if (!run) throw new Error(`unknown run ${runId}`);
  if (run.status !== 'complete' || !run.metrics) throw new Error(`run ${runId} is ${run.status}, not complete`);
  const profile = conn.db.companyProfile.id.find(run.profileId);
  if (!profile) throw new Error(`run ${runId} references unknown profile "${run.profileId}"`);
  const video = conn.db.video.id.find(run.videoId);
  if (!video || !video.signals) throw new Error(`run ${runId} references video ${run.videoId}, which is not analysed`);

  const people = new Map(
    [...conn.db.audienceMember.iter()]
      .filter((m) => m.profileId === run.profileId && m.audienceVersion === run.options.audienceVersion)
      .map((m) => [m.memberId, m]),
  );
  const evidence: MemberEvidence[] = [];
  for (const d of conn.db.decision.iter()) {
    if (d.runId !== runId || d.missing) continue;
    const m = people.get(d.memberId);
    if (!m) continue;
    evidence.push({
      memberId: m.memberId,
      name: m.name,
      groupId: m.groupId,
      persona: m.persona,
      hotButtons: m.hotButtons,
      ignores: m.ignores,
      profileJson: m.profileJson,
      pWatch: d.pWatch,
      pShare: d.pShare,
    });
  }
  const members = profile.groups.map((g) => {
    const inGroup = evidence.filter((e) => e.groupId === g.id).sort((a, b) => b.pShare - a.pShare);
    return {
      groupId: g.id,
      label: g.label,
      likeliest: inGroup.slice(0, MEMBERS_PER_SIDE),
      leastLikely: inGroup.slice(-MEMBERS_PER_SIDE).reverse(),
    };
  });

  const references = [...conn.db.referenceReel.iter()]
    .filter((r) => r.profileId === run.profileId && r.relevanceStatus !== 'rejected')
    .sort((a, b) => Number((b.plays ?? 0n) - (a.plays ?? 0n)))
    .slice(0, MAX_REFERENCES);

  const report = conn.db.report.runId.find(runId);
  return {
    run,
    metrics: run.metrics,
    profile,
    video,
    durationSec: video.signals.durationSec,
    audienceSize: people.size,
    analysis: parseAnalysis(video),
    members,
    references,
    report: report?.status === 'ready' ? report : undefined,
  };
}

/** Plain-text rendering of the grounding for a prompt. Reference reels are cited as [R0], [R1], ... */
export function groundingText(g: Grounding): string {
  const s = g.video.signals;
  const m = g.metrics;
  const lines = [
    `Business: ${g.profile.name}. ${g.profile.pitch}`,
    g.profile.location ? `Location: ${g.profile.location}` : '',
    `Objective: ${g.profile.objective}. Tone: ${g.profile.tone.join(', ') || 'not set'}.`,
    '',
    `Video "${g.video.label}" (${g.durationSec.toFixed(1)} s): ${g.video.summary}`,
    s ? `Signals (0-1): hook ${s.hookStrength}, clarity of ask ${s.clarityOfAsk}, pacing ${s.pacing}, warmth ${s.warmth}; topics: ${s.topics.join(', ')}` : '',
    'Transcript:',
    ...(g.analysis.transcript.length ? g.analysis.transcript.map((t) => `  [${t.start.toFixed(1)}-${t.end.toFixed(1)}s] ${t.text}`) : ['  (no speech)']),
    'On-screen text:',
    ...(g.analysis.onScreenText.length ? g.analysis.onScreenText.map((t) => `  [${t.at}s] ${t.text}`) : ['  (none)']),
    'Analysis notes:',
    ...g.analysis.notes.map((n) => `  [${n.at}s] ${n.severity}: ${n.title}. ${n.detail}`),
    '',
    `Digital simulation (${g.audienceSize} resident profiles). Round 0 shows the video to ${Math.round(g.run.options.seedExposure * 100)}% of the audience; each share exposes that member's connections in the next round.`,
    `Canonical trial: ${m.uniqueExposed} of ${g.audienceSize} members exposed, ${m.watch} watched through, ${m.likes} likes, ${m.comments} comments, ${m.shares} shares, over ${m.rounds} rounds. Reach: ${((m.uniqueExposed / Math.max(g.audienceSize, 1)) * 100).toFixed(0)}% of the audience. (Predictions existed for ${(m.coverage * 100).toFixed(0)}% of members; that is data completeness, not reach.)`,
    `Variability: total actions (watch + like + comment + share) per trial across 200 seeded trials, p10/p50/p90: ${m.spread.p10}/${m.spread.p50}/${m.spread.p90}.`,
    'By group:',
    ...m.byGroup.map((b) => {
      const label = g.profile.groups.find((x) => x.id === b.groupId)?.label ?? b.groupId;
      return `  ${label}: exposed ${b.exposed}, watched ${b.watch}, likes ${b.likes}, comments ${b.comments}, shares ${b.shares}`;
    }),
    'Members (calibrated per-exposure probabilities):',
    ...g.members.flatMap((grp) => [
      `  ${grp.label}:`,
      ...[...grp.likeliest.map((e) => ['most likely to share', e] as const), ...grp.leastLikely.map((e) => ['least likely to share', e] as const)].map(
        ([side, e]) =>
          `    ${side}: ${e.name} (P(watch) ${e.pWatch.toFixed(2)}, P(share) ${e.pShare.toFixed(3)}). ${e.persona} Cares about: ${e.hotButtons.join(', ') || 'see profile'}. Ignores: ${e.ignores.join(', ') || 'see profile'}.${e.profileJson ? ` Profile: ${e.profileJson}` : ''}`,
      ),
    ]),
    '',
    'Reference reels (real public reels in the niche; cite by id):',
    ...(g.references.length
      ? g.references.map(
          (r, i) =>
            `  [R${i}] @${r.ownerUsername}: plays ${r.plays ?? 'unknown'}, likes ${r.likes ?? 'unknown'}, comments ${r.comments ?? 'unknown'}. Caption: ${r.caption.slice(0, 300)}`,
        )
      : ['  (none scraped)']),
  ];
  return lines.filter((l) => l !== '').join('\n');
}
