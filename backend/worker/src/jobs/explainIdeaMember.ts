import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { models } from '../models.ts';
import { lookup, nonEmptyText, store } from '../cache.ts';
import { setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Job } from '../module_bindings/types.ts';

const SYSTEM = `You explain one simulated Millbrook resident's predicted reaction to a marketing campaign idea for a local business.

Rules:
- The resident is a synthetic persona from a simulation, not a real person. Say "this simulated resident" or use the name as a persona, and never claim real behaviour or measured demand.
- Write 1 to 2 plain sentences, no markdown, no lists, no preamble.
- Explain why this resident would or would not go (visit), leaning on the probabilities given (under about 0.2 is unlikely, over about 0.6 is likely) and on the resident's values, goals and situation from their profile.
- The probabilities are uncalibrated model estimates, so do not present them as measured facts.
- Use only the facts below. Do not invent details about the idea, the business or the resident.`;

/** Splits a "<ideaId>:<memberId>" job target. */
function parseTarget(targetId: string): { ideaId: bigint; memberId: number } {
  const match = /^(\d+):(\d+)$/.exec(targetId);
  if (!match) throw new Error(`explain_idea_member: bad target "${targetId}", expected "<ideaId>:<memberId>"`);
  return { ideaId: BigInt(match[1]), memberId: Number(match[2]) };
}

export async function explainIdeaMember(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so resident reasons cannot be written.');

  const started = performance.now();
  const { ideaId, memberId } = parseTarget(job.targetId);
  const idea = conn.db.ideaTest.id.find(ideaId);
  if (!idea) throw new Error(`explain_idea_member: unknown idea ${ideaId}`);
  const resident = idea.residents.find((r) => r.memberId === memberId);
  if (!resident) throw new Error(`explain_idea_member: idea ${ideaId} has no resident ${memberId}`);
  if (resident.missing) throw new Error(`explain_idea_member: resident ${memberId} of idea ${ideaId} has no prediction`);
  const profile = conn.db.companyProfile.id.find(idea.profileId);
  if (!profile) throw new Error(`explain_idea_member: unknown profile ${idea.profileId}`);
  const member = [...conn.db.audienceMember.iter()].find(
    (m) => m.profileId === idea.profileId && m.audienceVersion === (idea.audienceVersion ?? profile.audienceVersion) && m.memberId === memberId,
  );
  if (!member) throw new Error(`explain_idea_member: profile ${idea.profileId} has no audience member ${memberId}`);

  await setStage(conn, job, `Explaining ${resident.name}`);

  const optionLines = idea.options.map(
    (o, i) => `  ${o.name} ($${o.costUsd}): interest ${resident.optionInterest[i] === undefined ? 'n/a' : resident.optionInterest[i].toFixed(2)}`,
  );
  const prompt = [
    `Business: ${profile.name}. ${profile.pitch}`,
    `Original request: ${idea.prompt}`,
    `Idea being tested: ${idea.idea}`,
    `Target: ${idea.targetLabel}.`,
    'Campaign options:',
    ...(optionLines.length ? optionLines : ['  (none)']),
    '',
    `Simulated resident: ${resident.name}, age ${resident.age}.`,
    member.profileJson ? `Profile (JSON): ${member.profileJson}` : `Persona: ${member.persona}`,
    `Raw simulated probabilities: visit ${resident.pVisit.toFixed(2)}, return ${resident.pReturn.toFixed(2)}, tell a friend ${resident.pShare.toFixed(2)}.`,
    '',
    `Explain why ${resident.name} would or would not go.`,
  ].join('\n');

  const cacheParts = [models.ideaReason.id, SYSTEM, prompt];
  const hit = await lookup('idea_reason', cacheParts, nonEmptyText);
  if (hit) {
    await setStage(conn, job, `Explaining ${resident.name} (cached)`);
    await conn.reducers.setIdeaReason({ ideaId, memberId, reason: hit });
    console.log(`[idea reason ${job.targetId}] cached`);
    return;
  }

  const client = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: models.ideaReason.id,
      max_tokens: models.ideaReason.maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: models.ideaReason.effort },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude refused to explain this resident.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens before finishing the reason.');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!text) throw new Error('Claude returned no text content.');
  const reason = text.text.trim();
  if (reason.length === 0) throw new Error('Claude returned an empty reason.');

  await conn.reducers.setIdeaReason({ ideaId, memberId, reason });
  await store('idea_reason', cacheParts, reason);

  const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;
  const cost = inputTokens * models.ideaReason.usdPerInputToken + outputTokens * models.ideaReason.usdPerOutputToken;
  console.log(`[idea reason ${job.targetId}] ${inputTokens} in / ${outputTokens} out tokens, ${((performance.now() - started) / 1000).toFixed(1)}s, $${cost.toFixed(4)}`);
}
