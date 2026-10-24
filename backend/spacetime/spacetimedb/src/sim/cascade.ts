import { createRng } from './rng'

/**
 * The sharing cascade, ported from frontend/src/data/mock/scriptedCascade.ts.
 *
 * Kept in plain TypeScript with its own small types so it stays independent of
 * the table schema; index.ts maps rows in and out. The semantics must match the
 * browser mock exactly, because the island choreographs itself from these
 * rounds and the mock is the labelled offline fallback.
 */

export type ReactionKind = 'watch' | 'like' | 'comment' | 'share'

export interface SimMember {
  id: number
  groupId: string
}

export interface SimDecision {
  memberId: number
  pWatch: number
  pLike: number
  pComment: number
  pShare: number
  missing: boolean
}

export interface SimOptions {
  seed: number
  seedExposure: number
  maxRounds: number
}

export interface SimRound {
  round: number
  exposed: number[]
  acted: { memberId: number; kinds: ReactionKind[] }[]
  shares: { from: number; to: number[] }[]
  ignored: number[]
}

export interface SimGroupMetrics {
  groupId: string
  exposed: number
  watch: number
  likes: number
  comments: number
  shares: number
}

export interface SimMetrics {
  uniqueExposed: number
  watch: number
  likes: number
  comments: number
  shares: number
  rounds: number
  coverage: number
  missing: number
  byGroup: SimGroupMetrics[]
  spread: { p10: number; p50: number; p90: number }
}

interface TrialOutcome {
  rounds: SimRound[]
  totalActions: number
}

/**
 * One trial. Round 0 exposes a seeded subset; every exposed member rolls its
 * probabilities exactly once, and a share exposes that member's neighbours in
 * the next round.
 */
function runTrial(
  members: SimMember[],
  adjacency: number[][],
  decisions: Map<number, SimDecision>,
  options: SimOptions,
  trialSeed: number,
): TrialOutcome {
  const rng = createRng(trialSeed)
  const total = members.length

  const exposed = new Uint8Array(total)
  const hasActed = new Uint8Array(total)
  const rounds: SimRound[] = []
  let totalActions = 0

  const seedCount = Math.max(1, Math.round(options.seedExposure * total))
  let frontier = rng.shuffle(members.map((m) => m.id)).slice(0, seedCount)
  for (const id of frontier) exposed[id] = 1

  for (let round = 0; round < options.maxRounds && frontier.length > 0; round++) {
    const acted: SimRound['acted'] = []
    const shares: SimRound['shares'] = []
    const ignored: number[] = []
    const nextFrontier: number[] = []

    for (const id of frontier) {
      if (hasActed[id]) continue
      hasActed[id] = 1

      const decision = decisions.get(id)
      // A missing prediction is not a zero: exposed, but excluded from the statistics.
      if (!decision || decision.missing) continue

      const kinds: ReactionKind[] = []
      if (rng.chance(decision.pWatch)) {
        kinds.push('watch')
        if (rng.chance(decision.pLike)) kinds.push('like')
        if (rng.chance(decision.pComment)) kinds.push('comment')
        if (rng.chance(decision.pShare)) kinds.push('share')
      }

      if (kinds.length === 0) {
        ignored.push(id)
        continue
      }

      acted.push({ memberId: id, kinds })
      totalActions += kinds.length

      if (kinds.includes('share')) {
        const newly: number[] = []
        for (const neighbour of adjacency[id] ?? []) {
          if (exposed[neighbour]) continue
          exposed[neighbour] = 1
          newly.push(neighbour)
          nextFrontier.push(neighbour)
        }
        shares.push({ from: id, to: newly })
      }
    }

    rounds.push({ round, exposed: frontier, acted, shares, ignored })
    frontier = nextFrontier
  }

  return { rounds, totalActions }
}

/**
 * Trial 0 is canonical: it is what the island animates and what the metrics
 * report. The other trials only describe spread within these assumptions.
 */
export function runCascade(
  members: SimMember[],
  edges: { a: number; b: number }[],
  decisionList: SimDecision[],
  options: SimOptions,
  trials = 200,
): { rounds: SimRound[]; metrics: SimMetrics } {
  const adjacency: number[][] = members.map(() => [])
  for (const { a, b } of edges) {
    adjacency[a]?.push(b)
    adjacency[b]?.push(a)
  }
  const decisions = new Map(decisionList.map((d) => [d.memberId, d]))
  const canonical = runTrial(members, adjacency, decisions, options, options.seed)

  const totals: number[] = []
  for (let t = 1; t < trials; t++) {
    totals.push(runTrial(members, adjacency, decisions, options, options.seed + t * 0x9e3779b1).totalActions)
  }
  totals.sort((a, b) => a - b)
  const quantile = (q: number) =>
    totals.length === 0
      ? canonical.totalActions
      : (totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] as number)

  return {
    rounds: canonical.rounds,
    metrics: summarise(members, decisions, canonical, {
      p10: quantile(0.1),
      p50: quantile(0.5),
      p90: quantile(0.9),
    }),
  }
}

function summarise(
  members: SimMember[],
  /** Deduped by member, so a retried batch can never inflate coverage. */
  decisions: Map<number, SimDecision>,
  trial: TrialOutcome,
  spread: SimMetrics['spread'],
): SimMetrics {
  const groupOf = new Map(members.map((m) => [m.id, m.groupId]))

  const byGroup = new Map<string, SimGroupMetrics>()
  const ensure = (groupId: string) => {
    const existing = byGroup.get(groupId)
    if (existing) return existing
    const fresh: SimGroupMetrics = { groupId, exposed: 0, watch: 0, likes: 0, comments: 0, shares: 0 }
    byGroup.set(groupId, fresh)
    return fresh
  }
  for (const member of members) ensure(member.groupId)

  let uniqueExposed = 0
  const tally = { watch: 0, like: 0, comment: 0, share: 0 }

  for (const round of trial.rounds) {
    uniqueExposed += round.exposed.length
    for (const id of round.exposed) ensure(groupOf.get(id) ?? '').exposed++

    for (const act of round.acted) {
      const group = ensure(groupOf.get(act.memberId) ?? '')
      for (const kind of act.kinds) {
        tally[kind]++
        if (kind === 'watch') group.watch++
        else if (kind === 'like') group.likes++
        else if (kind === 'comment') group.comments++
        else group.shares++
      }
    }
  }

  let scored = 0
  let missing = 0
  for (const member of members) {
    const decision = decisions.get(member.id)
    if (decision && !decision.missing) scored++
    else missing++
  }

  return {
    uniqueExposed,
    watch: tally.watch,
    likes: tally.like,
    comments: tally.comment,
    shares: tally.share,
    rounds: trial.rounds.length,
    coverage: members.length === 0 ? 0 : scored / members.length,
    missing,
    byGroup: [...byGroup.values()],
    spread,
  }
}
