import { readFile, writeFile } from 'node:fs/promises';
import { config } from './config.ts';
import { scrapeReels } from './apify.ts';
import { DbConnection } from './module_bindings/index.ts';
import type { Job } from './module_bindings/types.ts';

/**
 * The worker: claims queued jobs from SpacetimeDB, does the work that needs
 * network access or API keys (Apify, Anthropic, JEV), and writes results back
 * through worker-only reducers. Keys never enter the module.
 */

type Handler = (conn: DbConnection, job: Job) => Promise<void>;

/** Upserts are sent in chunks so one reducer call stays small. */
const REEL_BATCH = 25;

const handlers: Record<string, Handler> = {
  scrape_references: async (conn, job) => {
    const profile = conn.db.companyProfile.id.find(job.targetId);
    if (!profile) throw new Error(`unknown profile ${job.targetId}`);

    const accounts = [
      ...new Set([...(profile.instagram ? [profile.instagram] : []), ...profile.inspirationAccounts, ...config.referenceAccounts]),
    ].map((a) => a.replace(/^@/, ''));
    console.log(`[scrape] ${profile.name}: ${accounts.join(', ')}`);

    const reels = await scrapeReels(accounts);
    for (let i = 0; i < reels.length; i += REEL_BATCH) {
      await conn.reducers.upsertReferenceReels({ profileId: profile.id, reels: reels.slice(i, i + REEL_BATCH) });
    }
    console.log(`[scrape] stored ${reels.length} reels for ${profile.id}`);
  },
  // analyse_video and score_run land with the Anthropic pipeline. Until then
  // those jobs stay queued rather than being claimed and failed.
};

/** Jobs already picked up by this process, so an insert and the initial sync don't double-claim. */
const seen = new Set<bigint>();

async function handleJob(conn: DbConnection, job: Job) {
  const handler = handlers[job.kind];
  if (!handler || job.status !== 'queued' || seen.has(job.id)) return;
  seen.add(job.id);

  try {
    await conn.reducers.claimJob({ jobId: job.id });
  } catch {
    return; // Another worker claimed it first.
  }

  try {
    await handler(conn, job);
    await conn.reducers.finishJob({ jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[job ${job.id}] ${job.kind} failed: ${message}`);
    await conn.reducers.failJob({ jobId: job.id, error: message }).catch(() => {});
  }
}

async function loadToken(): Promise<string | undefined> {
  try {
    return (await readFile(config.tokenFile, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

const token = await loadToken();

DbConnection.builder()
  .withUri(config.spacetimeHost)
  .withDatabaseName(config.spacetimeDb)
  .withToken(token)
  .withAutomaticReconnect()
  .onConnect(async (conn, identity, newToken) => {
    if (newToken !== token) await writeFile(config.tokenFile, newToken);
    console.log(`[worker] connected as ${identity.toHexString().slice(0, 12)}…`);

    try {
      await conn.reducers.registerWorker({ secret: config.workerSecret });
    } catch (error) {
      console.error('[worker] registration failed: is WORKER_SECRET set with set_worker_secret?', error);
      process.exit(1);
    }

    conn.db.job.onInsert((_ctx, job) => void handleJob(conn, job));
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        const queued = [...conn.db.job.iter()].filter((j) => j.status === 'queued');
        console.log(`[worker] subscribed; ${queued.length} queued job(s)`);
        for (const job of queued) void handleJob(conn, job);
      })
      .onError((ctx) => console.error('[worker] subscription error', ctx))
      .subscribe(['SELECT * FROM job', 'SELECT * FROM company_profile']);
  })
  .onConnectError((_ctx, error) => {
    console.error('[worker] could not connect:', error.message);
  })
  .build();
