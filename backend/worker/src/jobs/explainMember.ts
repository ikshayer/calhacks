import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { buildGrounding } from '../grounding.ts';
import { models } from '../models.ts';
import { lookup, nonEmptyText, store } from '../cache.ts';
import { setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Job } from '../module_bindings/types.ts';

const SYSTEM = `You explain one simulated audience member's predicted reaction to an Instagram reel.

Rules:
- The member is a synthetic persona from a simulation, not a real person. Say "this simulated member" or use the name as a persona, and never claim real behaviour or measured engagement.
- Write 1 to 3 plain sentences, no markdown, no lists, no preamble.
- Explain why this member would or would not watch, like, comment on or share the video, leaning on the probabilities given (a probability under about 0.2 is unlikely, over about 0.6 is likely) and on the match or clash between the member's hot buttons / ignores and what the video actually contains.
- Use only the facts below. Do not invent details about the video, the business or the member. Quote or reference a specific moment of the video when it supports the point.`;

/** Splits a "<runId>:<memberId>" job target. */
function parseTarget(targetId: string): { runId: bigint; memberId: number } {
  const match = /^(\d+):(\d+)$/.exec(targetId);
  if (!match) throw new Error(`explain_member: bad target "${targetId}", expected "<runId>:<memberId>"`);
  return { runId: BigInt(match[1]), memberId: Number(match[2]) };
}

export async function explainMember(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so member explanations cannot be written.');

  const started = performance.now();
  const { runId, memberId } = parseTarget(job.targetId);
  const g = buildGrounding(conn, runId);
  const member = [...conn.db.audienceMember.iter()].find(
    (m) => m.profileId === g.run.profileId && m.audienceVersion === g.run.options.audienceVersion && m.memberId === memberId,
  );
  if (!member) throw new Error(`explain_member: run ${runId} has no audience member ${memberId}`);
  const decision = [...conn.db.decision.iter()].find((d) => d.runId === runId && d.memberId === memberId);
  if (!decision) throw new Error(`explain_member: run ${runId} has no decision for member ${memberId}`);
  if (decision.missing) throw new Error(`explain_member: member ${memberId} of run ${runId} has no prediction`);

  await setStage(conn, job, `Explaining ${member.name}`);

  const group = g.profile.groups.find((x) => x.id === member.groupId)?.label ?? member.groupId;
  const s = g.video.signals;
  const prompt = [
    `Business: ${g.profile.name}. ${g.profile.pitch}`,
    `Video "${g.video.label}" (${g.durationSec.toFixed(1)} s): ${g.video.summary}`,
    s ? `Signals (0-1): hook ${s.hookStrength}, clarity of ask ${s.clarityOfAsk}, pacing ${s.pacing}, warmth ${s.warmth}; topics: ${s.topics.join(', ')}` : '',
    'Transcript:',
    ...(g.analysis.transcript.length ? g.analysis.transcript.map((t) => `  [${t.start.toFixed(1)}-${t.end.toFixed(1)}s] ${t.text}`) : ['  (no speech)']),
    'On-screen text:',
    ...(g.analysis.onScreenText.length ? g.analysis.onScreenText.map((t) => `  [${t.at}s] ${t.text}`) : ['  (none)']),
    '',
    `Simulated member: ${member.name}, in the group "${group}".`,
    `Persona: ${member.persona}`,
    `Cares about: ${member.hotButtons.join(', ') || 'not specified'}.`,
    `Ignores: ${member.ignores.join(', ') || 'not specified'}.`,
    `Calibrated probabilities once exposed: watch ${decision.pWatch.toFixed(2)}, like ${decision.pLike.toFixed(2)}, comment ${decision.pComment.toFixed(3)}, share ${decision.pShare.toFixed(3)}.`,
    '',
    `Explain why ${member.name} would or would not watch, like, comment on or share this video.`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const cacheParts = [models.explanation.id, SYSTEM, prompt];
  const hit = await lookup('explanation', cacheParts, nonEmptyText);
  if (hit) {
    await setStage(conn, job, `Explaining ${member.name} (cached)`);
    await conn.reducers.setExplanation({ runId, memberId, explanation: hit });
    console.log(`[explain ${job.targetId}] cached`);
    return;
  }

  const client = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: models.explanation.id,
      max_tokens: models.explanation.maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: models.explanation.effort },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude refused to explain this member.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens before finishing the explanation.');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!text) throw new Error('Claude returned no text content.');
  const explanation = text.text.trim();
  if (explanation.length === 0) throw new Error('Claude returned an empty explanation.');

  await conn.reducers.setExplanation({ runId, memberId, explanation });
  await store('explanation', cacheParts, explanation);

  const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;
  const cost = inputTokens * models.explanation.usdPerInputToken + outputTokens * models.explanation.usdPerOutputToken;
  console.log(`[explain ${job.targetId}] ${inputTokens} in / ${outputTokens} out tokens, ${((performance.now() - started) / 1000).toFixed(1)}s, $${cost.toFixed(4)}`);
}
