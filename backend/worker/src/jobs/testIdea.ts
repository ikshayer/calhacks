import { lookup, store } from '../cache.ts';
import { config } from '../config.ts';
import { askJev } from '../jev.ts';
import { setStage } from '../stage.ts';
import type { DbConnection } from '../module_bindings/index.ts';
import type { Job } from '../module_bindings/types.ts';
import { askClaude, runIdeaPipeline } from './ideaPipeline.ts';
export { computeMetrics, validateParsedIdea, validateIdeaScoreMap, validateAnalysis, validatePlain } from './ideaPipeline.ts';
export type { ParsedIdea, AnalysisDraft, PlainAnswer, PlainPair } from './ideaPipeline.ts';

export async function testIdea(conn: DbConnection, job: Job): Promise<void> {
  const anthropicKey = config.anthropicApiKey;
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set on the worker, so ideas cannot be tested.');
  const jevKey = config.jevApiKey;
  if (!jevKey) throw new Error('JEV_API_KEY is not set on the worker, so ideas cannot be tested.');
  const id = BigInt(job.targetId);
  const row = conn.db.ideaTest.id.find(id);
  if (!row) throw new Error(`test_idea: unknown idea test ${job.targetId}`);
  if (row.status !== 'running') throw new Error(`test_idea: idea test ${id} is ${row.status}, not running`);
  const profile = conn.db.companyProfile.id.find(row.profileId);
  if (!profile) throw new Error(`test_idea: idea test ${id} references unknown profile ${row.profileId}`);
  const members = [...conn.db.audienceMember.iter()]
    .filter((m) => m.profileId === row.profileId && m.audienceVersion === profile.audienceVersion)
    .sort((a, b) => a.memberId - b.memberId);
  const { result } = await runIdeaPipeline({ ...row, profile, members }, {
    cache: { lookup, store },
    concurrency: Math.max(1, config.jevConcurrency),
    claude: (call) => askClaude(anthropicKey, call),
    jev: (state, questions) => askJev(jevKey, state, questions),
    stage: (stage) => setStage(conn, job, stage),
  });
  await conn.reducers.setIdeaResult(result);
}
