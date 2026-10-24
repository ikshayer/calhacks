import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { buildGrounding, groundingText } from '../grounding.ts';
import { models } from '../models.ts';
import { setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { ChatMessage, Job, Report } from '../module_bindings/types.ts';

const MAX_TURNS = 20;

const SYSTEM = `You are the marketing assistant for the business described below, answering follow-up questions about one analysed Instagram reel and its simulated audience run.

Rules:
- Answer only from the grounding below. If it does not contain the answer, say so plainly.
- Audience numbers come from a synthetic simulation, not measured engagement. Say so when you cite them, and never invent metrics.
- When you cite a real reference reel, use its id such as [R0].
- Be concise (under about 180 words unless asked for a script), concrete, and timestamp moments of the video as mm:ss where relevant.
- If the user asks for a rewrite (for example "make the hook more playful"), give the rewritten text directly.`;

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function reportText(report: Report): string {
  return [
    'Report:',
    `Summary: ${report.summary}`,
    'Report notes:',
    ...report.notes.map((n) => `  [${mmss(n.at)}] ${n.severity}: ${n.title}. ${n.detail}`),
    'Rewritten hooks:',
    ...report.hooks.map((h) => `  ${h.label}: original "${h.original}" -> suggestion "${h.suggestion}" (${h.rationale})`),
  ].join('\n');
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** Finished turns of the run's conversation, oldest first, ending on a user turn. Throws otherwise. */
export function buildHistory(rows: Iterable<ChatMessage>, targetId: bigint): Turn[] {
  const turns: Turn[] = [...rows]
    .filter((r) => r.id !== targetId && r.status === 'done' && (r.role === 'user' || r.role === 'assistant'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({ role: r.role === 'user' ? 'user' : 'assistant', content: r.content }));
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();
  if (recent.length === 0 || recent[recent.length - 1].role !== 'user') {
    throw new Error(`chat_reply: the conversation before message ${targetId} does not end with a user question`);
  }
  return recent;
}

export async function chatReply(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so chat replies cannot be written.');

  const started = performance.now();
  const messageId = BigInt(job.targetId);
  const target = conn.db.chatMessage.id.find(messageId);
  if (!target) throw new Error(`chat_reply: unknown chat message ${job.targetId}`);
  if (target.role !== 'assistant') throw new Error(`chat_reply: message ${job.targetId} has role "${target.role}", expected "assistant"`);
  if (target.status !== 'pending') throw new Error(`chat_reply: message ${job.targetId} is ${target.status}, expected pending`);

  const history = buildHistory(conn.db.chatMessage.runId.filter(target.runId), messageId);
  const grounding = buildGrounding(conn, target.runId);
  const system = [SYSTEM, '--- GROUNDING ---', groundingText(grounding), ...(grounding.report ? [reportText(grounding.report)] : [])].join('\n\n');

  await setStage(conn, job, 'Writing a reply');
  const client = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: models.chat.id,
      max_tokens: models.chat.maxTokens,
      system,
      messages: history,
      output_config: { effort: models.chat.effort },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude refused to answer this question.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens before finishing the reply.');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!text) throw new Error('Claude returned no text content.');
  const content = text.text.trim();
  if (content.length === 0) throw new Error('Claude returned an empty reply.');

  await conn.reducers.setChatReply({ messageId, content });

  const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;
  const cost = inputTokens * models.chat.usdPerInputToken + outputTokens * models.chat.usdPerOutputToken;
  console.log(`[chat ${messageId}] ${inputTokens} in / ${outputTokens} out tokens, ${((performance.now() - started) / 1000).toFixed(1)}s, $${cost.toFixed(4)}`);
}
