/**
 * Fit the fixed JEV calibration multipliers from real reference reels.
 *
 * 1. Scrape recent reels from niche accounts (Apify).
 * 2. Observed per-play rates: likes/plays and comments/plays, averaged per reel.
 * 3. Score every reel with JEV against a sample audience (caption as content,
 *    since reel video analysis does not exist yet).
 * 4. like/comment multipliers map JEV's mean per-exposure rate onto the observed
 *    rate; the share multiplier makes a typical reel's per-exposure share chance
 *    SHARE_TARGET (a declared assumption: the scrape has no share counts).
 *    Watch-through has no observed counterpart and stays 1.
 *
 * Writes calibration.json. Run from backend/worker:
 *   npx tsx --env-file=../../.env --tsconfig ../../frontend/tsconfig.app.json scripts/calibrate.ts bontonfarms,grownorthtexas,...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildMillbrookAudience, validateMillbrookWorld } from '../../../frontend/src/data/millbrook.ts';
import { predictionProfile } from '../../../frontend/src/data/predictionProfile.ts';
import { emptyProfile, suggestedGroups } from '../../../frontend/src/onboarding/suggestAudience.ts';
import type { CompanyProfile } from '../../../frontend/src/data/types.ts';
import { scrapeReels, type Reel } from '../src/apify.ts';
import { scoreMember, type JevState, type Signal } from '../src/jev.ts';

const SHARE_TARGET = 0.1;
const REELS_PER_ACCOUNT = 10;
const CONCURRENCY = 16;
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

const accounts = (process.argv[2] ?? process.env.REFERENCE_ACCOUNTS ?? '')
  .split(',')
  .map((a) => a.trim().replace(/^@/, ''))
  .filter(Boolean);
if (accounts.length === 0) throw new Error('Pass accounts as a comma-separated argument or set REFERENCE_ACCOUNTS');
const apiKey = process.env.JEV_API_KEY;
if (!apiKey) throw new Error('Missing JEV_API_KEY in .env');

const groups = suggestedGroups();
const profile: CompanyProfile = { ...emptyProfile(), id: 'calibration', name: 'calibration', groups };
// The same 50 Millbrook residents the app simulates, with the same profile JEV sees in a live run.
const world: unknown = JSON.parse(readFileSync(new URL('../../../frontend/public/millbrook-50/data/personas.json', import.meta.url), 'utf8'));
validateMillbrookWorld(world);
const audience = buildMillbrookAudience(world, profile);
const profiles = audience.members.map((m) => {
  const json = predictionProfile(m);
  if (!json) return undefined;
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`member ${m.id} profile is not an object`);
  return Object.fromEntries(Object.entries(parsed));
});
const groupById = new Map(groups.map((g) => [g.id, g]));

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(`Scraping ${accounts.join(', ')} ...`);
const reels = (await scrapeReels(accounts, REELS_PER_ACCOUNT)).filter(
  (r): r is Reel & { plays: bigint; likes: bigint; comments: bigint } =>
    r.plays !== undefined && r.plays > 0n && r.likes !== undefined && r.comments !== undefined,
);
if (reels.length < 5) throw new Error(`Only ${reels.length} usable reels (need plays, likes and comments); add accounts`);

const observed = {
  like: mean(reels.map((r) => Number(r.likes) / Number(r.plays))),
  comment: mean(reels.map((r) => Number(r.comments) / Number(r.plays))),
};

function stateFor(memberIndex: number, reel: Reel): JevState {
  const member = audience.members[memberIndex]!;
  const group = groupById.get(member.groupId);
  return {
    person: {
      audience_group: group?.label ?? member.groupId,
      group_description: group?.blurb ?? '',
      interests: member.interests,
      habits: member.persona,
      responds_to: member.hotButtons,
      turned_off_by: member.ignores,
      ...(profiles[memberIndex] ? { profile: profiles[memberIndex] } : {}),
    },
    reel: {
      account: `@${reel.ownerUsername}`,
      content: `${reel.durationSec ? `${Math.round(reel.durationSec)}-second ` : ''}Instagram reel. Caption: ${reel.caption || '(no caption)'}`,
    },
  };
}

// Per-exposure predicted rates, averaged over members, then over reels.
const tasks = reels.flatMap((reel, r) => audience.members.map((_, m) => ({ r, m, reel })));
const perReel = reels.map(() => ({ like: [] as number[], comment: [] as number[], share: [] as number[] }));
let tokens = 0;
let failures = 0;
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < tasks.length) {
      const { r, m, reel } = tasks[next++]!;
      try {
        const { p, inputTokens } = await scoreMember(apiKey, stateFor(m, reel));
        tokens += inputTokens;
        perReel[r]!.like.push(p.watch * p.like);
        perReel[r]!.comment.push(p.watch * p.comment);
        perReel[r]!.share.push(p.watch * p.share);
      } catch (error) {
        failures++;
        console.error(`reel ${reel.shortCode} member ${m}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }),
);
if (failures > tasks.length * 0.05) throw new Error(`${failures}/${tasks.length} JEV calls failed; not writing a calibration`);

const predicted = {
  like: mean(perReel.map((x) => mean(x.like))),
  comment: mean(perReel.map((x) => mean(x.comment))),
  share: mean(perReel.map((x) => mean(x.share))),
};

const multipliers: Record<Signal, number> = {
  watch: 1,
  like: observed.like / predicted.like,
  comment: observed.comment / predicted.comment,
  share: SHARE_TARGET / predicted.share,
};

const calibration = {
  version: 1,
  createdAt: new Date().toISOString(),
  source: `${reels.length} reels from ${accounts.map((a) => `@${a}`).join(', ')} (Apify), scored by JEV against ${audience.members.length} Millbrook residents`,
  uncalibrated: false,
  multipliers,
  notes:
    `Observed per play: likes ${(observed.like * 100).toFixed(2)}%, comments ${(observed.comment * 100).toFixed(2)}% (mean of per-reel ratios). ` +
    `JEV raw per exposure on the same reels: likes ${(predicted.like * 100).toFixed(2)}%, comments ${(predicted.comment * 100).toFixed(2)}%, shares ${(predicted.share * 100).toFixed(2)}%. ` +
    `Share multiplier targets a declared ${SHARE_TARGET * 100}% per-exposure share chance for a typical reel (no share data in the scrape). ` +
    `Watch-through is uncalibrated JEV output. Reference reels were described to JEV by caption only; real runs use full video summaries.`,
};
writeFileSync(new URL('../calibration.json', import.meta.url), `${JSON.stringify(calibration, null, 2)}\n`);

console.log(`\nUsable reels: ${reels.length}  JEV calls: ${tasks.length - failures}/${tasks.length}  cost $${(tokens * USD_PER_INPUT_TOKEN).toFixed(4)}`);
console.log(`Observed  like ${(observed.like * 100).toFixed(2)}%  comment ${(observed.comment * 100).toFixed(2)}%`);
console.log(`JEV raw   like ${(predicted.like * 100).toFixed(2)}%  comment ${(predicted.comment * 100).toFixed(2)}%  share ${(predicted.share * 100).toFixed(2)}%`);
console.log(`Multipliers ${JSON.stringify(Object.fromEntries(Object.entries(multipliers).map(([k, v]) => [k, Number(v.toFixed(4))])))}`);
