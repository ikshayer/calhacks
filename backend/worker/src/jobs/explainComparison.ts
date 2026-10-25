import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { models } from '../models.ts';
import { lookup, nonEmptyText, store } from '../cache.ts';
import { setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Comparison, Job, Means, Video } from '../module_bindings/types.ts';

const SYSTEM = `You explain, in plain language, how a revised Instagram reel compared with the original in a simulated audience.

Rules:
- Write 2 to 4 sentences of plain prose. No headings, lists or markdown.
- Use only the facts given. Never invent numbers or reasons the facts do not support.
- Describe the numbers as digital simulation results based on the supplied resident data.
- The verdict was decided by code. Respect it exactly:
  - "revised": the revised version did better; say what changed in the video that plausibly explains it.
  - "original": the original did better; say so, and what the revision may have lost.
  - "inconclusive": the simulation cannot tell the versions apart. Never name a winner or say one "did better"; you may note which signals moved and by how little.
- Refer to the videos as "the original" and "the revised version".
- Probabilities are per-exposure chances averaged over members who were scored in both runs; quote changes as percentage points.`;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pp`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x}`;

function means(label: string, base: Means, revised: Means, delta: Means): string {
  return [
    `${label}:`,
    `  watch ${pct(base.pWatch)} -> ${pct(revised.pWatch)} (${pp(delta.pWatch)})`,
    `  like ${pct(base.pLike)} -> ${pct(revised.pLike)} (${pp(delta.pLike)})`,
    `  comment ${pct(base.pComment)} -> ${pct(revised.pComment)} (${pp(delta.pComment)})`,
    `  share ${pct(base.pShare)} -> ${pct(revised.pShare)} (${pp(delta.pShare)})`,
  ].join('\n');
}

function videoText(name: string, video: Video): string {
  const s = video.signals;
  return [
    `${name} video "${video.label}" (${video.durationSec.toFixed(1)} s): ${video.summary}`,
    s ? `  Signals (0-1): hook ${s.hookStrength}, clarity of ask ${s.clarityOfAsk}, pacing ${s.pacing}, warmth ${s.warmth}; topics: ${s.topics.join(', ')}` : '  Signals: none',
  ].join('\n');
}

function comparisonText(c: Comparison, base: Video, revised: Video, groupLabels: Map<string, string>): string {
  const d = c.metricDeltas;
  return [
    videoText('Original', base),
    videoText('Revised', revised),
    '',
    `Same simulated audience, sharing graph, trial seed and starting exposure for both. ${c.matched} of ${c.audienceSize} members had valid predictions in both runs (${pct(c.coverage)} coverage).`,
    means('All matched members (original -> revised)', c.baseMeans, c.revisedMeans, c.deltaMeans),
    ...c.groups.map((g) => means(`Group ${groupLabels.get(g.groupId) ?? g.groupId} (${g.matched} matched)`, g.base, g.revised, g.delta)),
    `Canonical trial, revised minus original: members reached ${signed(d.uniqueExposed)}, watched ${signed(d.watch)}, likes ${signed(d.likes)}, comments ${signed(d.comments)}, shares ${signed(d.shares)}, rounds of spread ${signed(d.rounds)}.`,
    `Total actions (watch + like + comment + share) per trial across 200 seeded trials, p10/p50/p90: original ${c.baseSpread.p10}/${c.baseSpread.p50}/${c.baseSpread.p90}, revised ${c.revisedSpread.p10}/${c.revisedSpread.p50}/${c.revisedSpread.p90}.`,
    `Verdict (decided by code): ${c.verdict}.`,
  ].join('\n');
}

export async function explainComparison(conn: DbConnection, job: Job): Promise<void> {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so comparison summaries cannot be written.');

  const started = performance.now();
  const id = BigInt(job.targetId);
  const comparison = conn.db.comparison.id.find(id);
  if (!comparison) throw new Error(`explain_comparison: unknown comparison ${job.targetId}`);
  if (comparison.status !== 'computing') throw new Error(`explain_comparison: comparison ${job.targetId} is ${comparison.status}, expected computing`);

  const baseRun = conn.db.run.id.find(comparison.baseRunId);
  const revisedRun = conn.db.run.id.find(comparison.revisedRunId);
  if (!baseRun || !revisedRun) throw new Error(`explain_comparison: comparison ${job.targetId} references an unknown run`);
  const baseVideo = conn.db.video.id.find(baseRun.videoId);
  const revisedVideo = conn.db.video.id.find(revisedRun.videoId);
  if (!baseVideo || !revisedVideo) throw new Error(`explain_comparison: comparison ${job.targetId} references an unknown video`);
  const profile = conn.db.companyProfile.id.find(baseRun.profileId);
  if (!profile) throw new Error(`explain_comparison: unknown profile "${baseRun.profileId}"`);
  const groupLabels = new Map(profile.groups.map((g) => [g.id, g.label]));

  const userText = comparisonText(comparison, baseVideo, revisedVideo, groupLabels);
  const cacheParts = [models.comparison.id, SYSTEM, userText];
  const hit = await lookup('comparison', cacheParts, nonEmptyText);
  if (hit) {
    await setStage(conn, job, 'Explaining the comparison (cached)');
    await conn.reducers.setComparisonSummary({ id, summary: hit });
    console.log(`[compare ${id}] cached`);
    return;
  }

  await setStage(conn, job, 'Explaining the comparison');
  const client = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: models.comparison.id,
      max_tokens: models.comparison.maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
      output_config: { effort: models.comparison.effort },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Error(`Anthropic rejected the API key (${error.status}): ${error.message}`);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude refused to explain this comparison.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens before finishing the summary.');
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!text) throw new Error('Claude returned no text content.');
  const summary = text.text.trim();
  if (summary.length === 0) throw new Error('Claude returned an empty summary.');

  await conn.reducers.setComparisonSummary({ id, summary });
  await store('comparison', cacheParts, summary);

  const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;
  const cost = inputTokens * models.comparison.usdPerInputToken + outputTokens * models.comparison.usdPerOutputToken;
  console.log(`[compare ${id}] ${inputTokens} in / ${outputTokens} out tokens, ${((performance.now() - started) / 1000).toFixed(1)}s, $${cost.toFixed(4)}`);
}
