/** Worker configuration, read once from the environment (repo-root .env). */

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
  /** Where the worker keeps its SpacetimeDB token, so it keeps one identity across restarts. */
  /** One token per database: a token from the local server is not valid on Maincloud. */
  tokenFile: process.env.WORKER_TOKEN_FILE ?? `.worker-token-${process.env.SPACETIME_DB}`,
  apifyToken: process.env.APIFY_TOKEN,
  /** Niche accounts scraped for every profile, in addition to its inspiration accounts. */
  referenceAccounts: list('REFERENCE_ACCOUNTS'),
  reelsPerAccount: Number(process.env.REELS_PER_ACCOUNT ?? 10),
};
