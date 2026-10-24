/**
 * Original-versus-revision comparison. Pure TypeScript, independent of the
 * table schema like cascade.ts; index.ts maps rows in and out.
 *
 * Probabilities are compared only over members with a valid (non-missing)
 * decision in BOTH runs, so a failed scoring batch in one run never reads as a
 * zero against the other (HACK.md: "Compare only matched valid members and
 * report coverage").
 */

export interface CompareMember {
  id: number;
  groupId: string;
}

export interface CompareDecision {
  memberId: number;
  pWatch: number;
  pLike: number;
  pComment: number;
  pShare: number;
  missing: boolean;
}

export interface Means {
  pWatch: number;
  pLike: number;
  pComment: number;
  pShare: number;
}

export interface GroupComparison {
  groupId: string;
  matched: number;
  base: Means;
  revised: Means;
  delta: Means;
}

export interface Spread {
  p10: number;
  p50: number;
  p90: number;
}

export type Verdict = 'revised' | 'original' | 'inconclusive';

export interface CompareResult {
  audienceSize: number;
  matched: number;
  /** matched / audienceSize. */
  coverage: number;
  base: Means;
  revised: Means;
  delta: Means;
  groups: GroupComparison[];
  verdict: Verdict;
}

/** Below this share of the audience matched in both runs, no verdict is given. */
const MIN_MATCHED_COVERAGE = 0.8;

const ZERO: Means = { pWatch: 0, pLike: 0, pComment: 0, pShare: 0 };

function mean(sum: Means, n: number): Means {
  if (n === 0) return ZERO;
  return { pWatch: sum.pWatch / n, pLike: sum.pLike / n, pComment: sum.pComment / n, pShare: sum.pShare / n };
}

function diff(revised: Means, base: Means): Means {
  return {
    pWatch: revised.pWatch - base.pWatch,
    pLike: revised.pLike - base.pLike,
    pComment: revised.pComment - base.pComment,
    pShare: revised.pShare - base.pShare,
  };
}

/**
 * A winner needs each run's typical (p50) total actions to sit outside the
 * other's P10-P90 band, in both directions. This is the rule the browser mock's
 * ComparePanel uses: a plain "do the bands overlap" test calls a tie when one
 * version triples the other's median but the tails graze.
 */
export function spreadVerdict(base: Spread, revised: Spread): Verdict {
  const separated = (a: Spread, b: Spread) => a.p50 > b.p90 || a.p50 < b.p10;
  const decisive = base.p50 !== revised.p50 && separated(base, revised) && separated(revised, base);
  if (!decisive) return 'inconclusive';
  return revised.p50 > base.p50 ? 'revised' : 'original';
}

export function compareRuns(
  members: CompareMember[],
  baseDecisions: CompareDecision[],
  revisedDecisions: CompareDecision[],
  baseSpread: Spread,
  revisedSpread: Spread
): CompareResult {
  const baseById = new Map(baseDecisions.filter((d) => !d.missing).map((d) => [d.memberId, d]));
  const revisedById = new Map(revisedDecisions.filter((d) => !d.missing).map((d) => [d.memberId, d]));

  const total = { base: { ...ZERO }, revised: { ...ZERO }, n: 0 };
  const perGroup = new Map<string, { base: Means; revised: Means; n: number }>();

  for (const m of members) {
    const b = baseById.get(m.id);
    const r = revisedById.get(m.id);
    if (!b || !r) continue;
    let g = perGroup.get(m.groupId);
    if (!g) {
      g = { base: { ...ZERO }, revised: { ...ZERO }, n: 0 };
      perGroup.set(m.groupId, g);
    }
    for (const acc of [total, g]) {
      acc.base.pWatch += b.pWatch;
      acc.base.pLike += b.pLike;
      acc.base.pComment += b.pComment;
      acc.base.pShare += b.pShare;
      acc.revised.pWatch += r.pWatch;
      acc.revised.pLike += r.pLike;
      acc.revised.pComment += r.pComment;
      acc.revised.pShare += r.pShare;
      acc.n += 1;
    }
  }

  const base = mean(total.base, total.n);
  const revised = mean(total.revised, total.n);
  const groups: GroupComparison[] = [...perGroup.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([groupId, g]) => {
      const gb = mean(g.base, g.n);
      const gr = mean(g.revised, g.n);
      return { groupId, matched: g.n, base: gb, revised: gr, delta: diff(gr, gb) };
    });

  const coverage = members.length === 0 ? 0 : total.n / members.length;
  const verdict = coverage < MIN_MATCHED_COVERAGE ? 'inconclusive' : spreadVerdict(baseSpread, revisedSpread);

  return {
    audienceSize: members.length,
    matched: total.n,
    coverage,
    base,
    revised,
    delta: diff(revised, base),
    groups,
    verdict,
  };
}
