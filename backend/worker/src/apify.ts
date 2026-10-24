import { mkdir, writeFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { config } from './config.ts';

const REEL_SCRAPER = 'apify/instagram-reel-scraper';

/** One reel as the module's `upsert_reference_reels` reducer expects it. */
export interface Reel {
  shortCode: string;
  url: string;
  ownerUsername: string;
  caption: string;
  hashtags: string[];
  durationSec: number | undefined;
  plays: bigint | undefined;
  likes: bigint | undefined;
  comments: bigint | undefined;
  shares: bigint | undefined;
  postedAt: string | undefined;
  videoUrl: string | undefined;
  thumbnailUrl: string | undefined;
  transcript: string | undefined;
}

/** The fields we read from the scraper's dataset. Checked against a real run on 2026-10-24. */
interface ScrapedReel {
  shortCode?: string;
  url?: string;
  ownerUsername?: string;
  caption?: string;
  hashtags?: string[];
  videoDuration?: number;
  /** Plays live here; `videoViewCount` came back null in testing. */
  videoPlayCount?: number | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  /** Only present with the paid shares add-on. */
  sharesCount?: number | null;
  timestamp?: string;
  videoUrl?: string;
  displayUrl?: string;
  transcript?: string;
  error?: string;
}

/**
 * A count the scraper did not return stays undefined. Instagram reports hidden
 * like counts as -1 or 3, so negatives are treated as missing rather than zero.
 */
function count(value: number | null | undefined): bigint | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return BigInt(Math.round(value));
}

function toReel(item: ScrapedReel): Reel | undefined {
  if (item.error || !item.shortCode || !item.url) return undefined;
  return {
    shortCode: item.shortCode,
    url: item.url,
    ownerUsername: item.ownerUsername ?? '',
    caption: item.caption ?? '',
    hashtags: item.hashtags ?? [],
    durationSec: item.videoDuration,
    plays: count(item.videoPlayCount),
    likes: count(item.likesCount),
    comments: count(item.commentsCount),
    shares: count(item.sharesCount),
    postedAt: item.timestamp,
    videoUrl: item.videoUrl,
    thumbnailUrl: item.displayUrl,
    transcript: item.transcript,
  };
}

/**
 * Scrape recent public reels from a set of accounts.
 *
 * The Reel Scraper takes usernames or reel URLs, not keywords, so the niche is
 * expressed as a list of accounts. Transcripts and share counts are paid
 * add-ons and stay off here; the reference pipeline enriches only the reels
 * the JEV filter keeps.
 */
export async function scrapeReels(accounts: string[], perAccount = config.reelsPerAccount): Promise<Reel[]> {
  if (!config.apifyToken) throw new Error('Missing APIFY_TOKEN in .env');
  if (accounts.length === 0) throw new Error('No accounts to scrape: add inspiration accounts or REFERENCE_ACCOUNTS');

  const client = new ApifyClient({ token: config.apifyToken });
  const run = await client.actor(REEL_SCRAPER).call({
    username: accounts,
    resultsLimit: perAccount,
    skipPinnedPosts: true,
  });
  if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} ended ${run.status}`);

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const reels = (items as ScrapedReel[]).map(toReel).filter((r): r is Reel => r !== undefined);
  await cacheRaw(accounts, items);
  return reels;
}

/** Keep the raw scrape on disk: CDN links expire, and it doubles as the offline demo fallback. */
async function cacheRaw(accounts: string[], items: unknown[]) {
  await mkdir('cache', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(`cache/reels-${stamp}.json`, JSON.stringify({ accounts, items }, null, 2));
}
