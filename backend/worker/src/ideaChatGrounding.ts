import type { DbConnection } from './module_bindings/index.ts';

/** Idea reports have no analysed video or cascade; ground them independently. */
export function buildIdeaChatGrounding(conn: DbConnection, ideaId: bigint): string {
  const idea = conn.db.ideaTest.id.find(ideaId);
  if (!idea) throw new Error(`unknown idea test ${ideaId}`);
  if (idea.status !== 'ready' || !idea.metrics || !idea.analysis) throw new Error(`idea test ${ideaId} is not ready with a complete report`);
  const profile = conn.db.companyProfile.id.find(idea.profileId);
  if (!profile) throw new Error(`idea test ${ideaId} references unknown profile ${idea.profileId}`);
  // Older idea rows did not capture a version. Do not silently attach today's
  // personalities to historical predictions whose source cannot be verified.
  const people = idea.audienceVersion === undefined ? [] : [...conn.db.audienceMember.iter()]
    .filter((member) => member.profileId === idea.profileId && member.audienceVersion === idea.audienceVersion);
  const byId = new Map(people.map((member) => [member.memberId, member]));
  return [
    'Subject: an idea test with no video. No video analysis, timestamps, watch/like/comment metrics or cascade rounds apply to this report.',
    `Idea test ID: ${ideaId}. Business: ${profile.name}. ${profile.pitch}`,
    `Original request: ${idea.prompt}`,
    `Parsed idea: ${idea.idea}. Target: ${idea.targetLabel}. Age limits: ${idea.minAge ?? 'unspecified'} to ${idea.maxAge ?? 'unspecified'}.`,
    `Budget USD: ${idea.budgetUsd ?? 'not specified'}. Campaign options (same order as optionInterest and optionVisits): ${JSON.stringify(idea.options)}`,
    'These are synthetic residents and raw, uncalibrated model estimates, not consumer research or a sales forecast. pVisit estimates visiting once. pReturn and pShare are conditional on visiting once.',
    'Metrics are computed in code: interested counts nonmissing residents with pVisit >= 0.5; expectedVisits = sum(pVisit); expectedShares = sum(pVisit * pShare); optionVisits[i] = sum(optionInterest[i] * pVisit). Missing predictions are excluded, not interpreted as zero.',
    `Computed metrics: ${JSON.stringify(idea.metrics)}`,
    `Report analysis (recommendations, evidence, segments, objections, budget allocation, experiment, success metric, assumptions and limitations): ${JSON.stringify(idea.analysis)}`,
    `Plain-language report: ${idea.plainJson || 'No plain-language version stored; use the structured analysis.'}`,
    idea.audienceVersion === undefined
      ? 'Personality limitation: this historical idea test did not record its audience version. Exact personality snapshots are unavailable; do not infer them from current residents.'
      : `Saved audience version: ${idea.audienceVersion}. Personality profiles are included only where that version and resident ID match.`,
    'All idea-test resident predictions and reasons:',
    ...idea.residents.map((resident) => {
      const member = byId.get(resident.memberId);
      return JSON.stringify({
        memberId: resident.memberId, name: resident.name, age: resident.age, groupId: resident.groupId, inTarget: resident.inTarget,
        prediction: resident.missing ? { status: 'missing; probabilities unknown' } : {
          status: 'scored', pVisit: resident.pVisit, pReturn: resident.pReturn, pShare: resident.pShare,
          optionInterest: resident.optionInterest, reason: resident.reason || 'No individual reason recorded.',
        },
        personality: member ? {
          persona: member.persona, interests: member.interests, hotButtons: member.hotButtons, ignores: member.ignores,
          profileJson: member.profileJson || 'No detailed personality snapshot recorded.',
        } : 'Matching historical personality snapshot unavailable.',
      });
    }),
    'Do not treat a probability as a recorded visit, a real purchase or a proven cause. Explain recommendations as inferences from the report and saved profiles.',
  ].join('\n\n');
}
