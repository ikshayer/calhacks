import { buildGrounding, groundingText } from './grounding.ts';
import type { DbConnection } from './module_bindings/index.ts';

/** Full run evidence for chat; report generation keeps its compact member sample. */
export function buildChatGrounding(conn: DbConnection, runId: bigint): string {
  const g = buildGrounding(conn, runId);
  const people = [...conn.db.audienceMember.iter()]
    .filter((m) => m.profileId === g.run.profileId && m.audienceVersion === g.run.options.audienceVersion)
    .sort((a, b) => a.memberId - b.memberId);
  const decisions = new Map([...conn.db.decision.iter()].filter((d) => d.runId === runId).map((d) => [d.memberId, d]));
  const ids = new Set(people.map((person) => person.memberId));
  const rounds = [...conn.db.roundEvent.iter()].filter((round) => round.runId === runId).sort((a, b) => a.round - b.round);
  const edges = [...conn.db.audienceEdge.iter()]
    .filter((edge) => edge.profileId === g.run.profileId && edge.audienceVersion === g.run.options.audienceVersion && ids.has(edge.a) && ids.has(edge.b))
    .map(({ a, b }) => ({ a, b }));
  const report = conn.db.report.runId.find(runId);

  return [
    groundingText({ ...g, members: [] }),
    `Run ID: ${runId}. Simulation options: ${JSON.stringify(g.run.options)}. Missing predictions: ${g.metrics.missing}.`,
    'Probabilities below are calibrated predictions per exposure, not actual actions or measured engagement.',
    'Complete resident roster (memberId links predictions, network and round events; profileJson contains the supplied personality snapshot):',
    ...people.map((m) => {
      const d = decisions.get(m.memberId);
      return JSON.stringify({
        memberId: m.memberId, name: m.name, groupId: m.groupId,
        groupLabel: g.profile.groups.find((group) => group.id === m.groupId)?.label ?? m.groupId,
        persona: m.persona, interests: m.interests, hotButtons: m.hotButtons, ignores: m.ignores,
        profileJson: m.profileJson || 'No detailed personality snapshot recorded.',
        prediction: !d || d.missing ? { status: 'missing; do not treat as zero probability' } : {
          status: 'scored', pWatch: d.pWatch, pLike: d.pLike, pComment: d.pComment, pShare: d.pShare,
          explanation: d.explanation || 'No explanation recorded.',
        },
      });
    }),
    'Sharing graph: undirected connections between resident memberIds; a connection does not prove a share happened.',
    edges.length ? JSON.stringify(edges) : 'No sharing connections recorded.',
    'Recorded events from the canonical simulation:',
    ...(rounds.length ? rounds.map(({ round, exposed, acted, shares, ignored }) => JSON.stringify({ round, exposed, acted, shares, ignored }))
      : ['Round events are unavailable. Do not infer individual actions from probabilities.']),
    'An ignored resident was exposed but made no recorded action; absence from an exposure event does not prove dislike.',
    'Report:',
    report?.status === 'ready' ? JSON.stringify({
      summary: report.summary, notes: report.notes, hooks: report.hooks,
      references: report.references.map((reference) => ({
        ...reference, observed: Object.fromEntries(Object.entries(reference.observed).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])),
      })),
      assumptions: report.assumptions,
    }) : `Report unavailable (${report?.status ?? 'not requested'}). Do not invent its contents; explain the simulation evidence that is available.`,
  ].join('\n\n');
}
