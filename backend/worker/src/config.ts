/** Worker configuration, read once from the environment (repo-root .env). */

import { fileURLToPath } from 'node:url';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
}

export const config = {
  spacetimeHost: process.env.SPACETIME_HOST ?? 'ws://127.0.0.1:3000',
  spacetimeDb: required('SPACETIME_DB'),
  workerSecret: required('WORKER_SECRET'),
  /**
   * Where the worker keeps its SpacetimeDB token, so it keeps one identity across
   * restarts. One file per database: a local-server token is not valid on Maincloud.
   */
  tokenFile: process.env.WORKER_TOKEN_FILE ?? `.worker-token-${process.env.SPACETIME_DB}`,
  apifyToken: process.env.APIFY_TOKEN,
  /** Niche accounts scraped for every profile, in addition to its inspiration accounts. */
  referenceAccounts: list('REFERENCE_ACCOUNTS'),
  /** Required only when a score_run job runs, so the worker still starts without it. */
  jevApiKey: process.env.JEV_API_KEY,
  jevConcurrency: Number(process.env.JEV_CONCURRENCY ?? 16),
  /** Required only when an analyse_video job runs. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  reelsPerAccount: Number(process.env.REELS_PER_ACCOUNT ?? 10),
  /** CACHE_DISABLED=1 recomputes everything (analysis, scores, reports, explanations). */
  cacheDisabled: process.env.CACHE_DISABLED === '1',
  /**
   * Folder that `demo:<file>` sourceUrls resolve against. Defaults to the
   * frontend's public/demo, so the browser plays the same file the worker analyses.
   */
  demoVideosDir: process.env.DEMO_VIDEOS_DIR || fileURLToPath(new URL('../../../frontend/public/demo/', import.meta.url)),
  /** Where uploaded videos are stored; `upload:<file>` sourceUrls resolve against it. */
  uploadsDir: process.env.UPLOADS_DIR || fileURLToPath(new URL('../uploads/', import.meta.url)),
  /** Local HTTP server that receives video uploads from the browser. */
  uploadPort: Number(process.env.UPLOAD_PORT ?? 8787),
  /** Browser origins allowed to upload, comma-separated. Both local dev ports and the Vercel deployment by default. */
  uploadAllowedOrigins: (process.env.UPLOAD_ALLOWED_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,https://calhacks-giving-garden.vercel.app')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};
