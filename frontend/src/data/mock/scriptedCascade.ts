import { createRng } from '../../lib/rng.ts'
import type {
  Audience,
  ContentSignals,
  Decision,
  GroupMetrics,
  ReactionKind,
  RoundEvent,
  RunMetrics,
  RunOptions,
} from '@/data/types'

export type { ContentSignals }

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Stand-in for the Anthropic scoring stage.
 *
 * Returns P(watch-through | exposed), P(like | watched), and so on - all
 * conditional on exposure, as the sim spec requires. It is a transparent
 * heuristic over interest overlap and content signals, NOT a trained model, and
 * the UI labels it as such wherever its numbers appear.
 */
export function scoreAudience(
  audience: Audience,
  content: ContentSignals,
  seed: number,
  /** Fraction of members whose scoring batch fails. Real batches do fail. */
  failureRate = 0.012,
): Decision[] {
  const rng = createRng(seed ^ 0x5ca1ab1e)
  const topics = content.topics.map((t) => t.toLowerCase())

  return audience.members.map((member) => {
    if (rng.chance(failureRate)) {
      return {
        memberId: member.id,
        pWatch: 0,
        pLike: 0,
        pComment: 0,
        pShare: 0,
        explanation: 'Scoring batch failed for this member - no prediction.',
        missing: true,
      }
    }

    const overlap = member.interests.filter((interest) =>
      topics.some((t) => t.includes(interest.toLowerCase()) || interest.toLowerCase().includes(t)),
    ).length
    const affinity = clamp01(overlap / 3)

    // Attention is mostly the hook plus pacing; relevance decides whether it lands.
    const attention = clamp01(0.18 + 0.45 * content.hookStrength + 0.2 * content.pacing)
    const pWatch = clamp01(attention * (0.55 + 0.6 * affinity) + rng.range(-0.05, 0.05))

    const pLike = clamp01(
      pWatch * (0.3 + 0.45 * affinity + 0.2 * content.warmth) + rng.range(-0.04, 0.04),
    )
    const pComment = clamp01(
      pLike * (0.12 + 0.3 * content.clarityOfAsk) + rng.range(-0.02, 0.02),
    )
    // Sharing is the scarcest action and the most sensitive to a clear ask.
    //
    // These coefficients are a DECLARED ASSUMPTION, not a measured rate. They are
    // chosen so that the cascade's critical threshold (mean p(share) x mean degree
    // ~= 1) falls between a weak video and a well-targeted one: a vague ask fizzles
    // out in two or three rounds, a clear one spreads. That boundary is the whole
    // point of the tool, so it has to be somewhere -- but where it sits is a
    // modelling choice the report has to disclose, and calibrating it against real
    // engagement data is exactly the open work HACK.md flags as needing a spike.
    const pShare = clamp01(
      pWatch * (0.04 + 0.55 * affinity * content.clarityOfAsk + 0.18 * content.warmth) +
        rng.range(-0.02, 0.02),
    )

    const explanation = buildExplanation(member.interests, overlap, content.clarityOfAsk)
    return { memberId: member.id, pWatch, pLike, pComment, pShare, explanation }
  })
}

function buildExplanation(interests: string[], overlap: number, clarityOfAsk: number): string {
  if (overlap === 0) {
    return `Nothing here maps onto what this member follows (${interests.join(', ')}), so attention drops early.`
  }
  const driver = interests[0] ?? 'a shared interest'
  const askNote =
    clarityOfAsk > 0.6
      ? 'The ask is explicit, so passing it on is plausible.'
      : 'The ask stays vague, so they are unlikely to pass it on.'
  return `The hook lands on "${driver}", which this member follows. ${askNote}`
}

export interface CascadeResult {
  rounds: RoundEvent[]
  metrics: RunMetrics
}

interface TrialOutcome {
  rounds: RoundEvent[]
  totalActions: number
}

/**
 * One cascade trial.
 *
 * Round 0 exposes a seeded subset. Every exposed member rolls its own
 * probabilities exactly once - a member re-exposed by a second neighbour does
 * not act twice - and a share exposes that member's neighbours in the next
 * round.
 */
function runTrial(
  audience: Audience,
  decisions: Map<number, Decision>,
  options: RunOptions,
  trialSeed: number,
): TrialOutcome {
  const rng = createRng(trialSeed)
  const total = audience.members.length

  const exposed = new Uint8Array(total)
  const hasActed = new Uint8Array(total)
  const rounds: RoundEvent[] = []
  let totalActions = 0

  const seedCount = Math.max(1, Math.round(options.seedExposure * total))
  let frontier = rng.shuffle(audience.members.map((m) => m.id)).slice(0, seedCount)
  for (const id of frontier) exposed[id] = 1

  for (let round = 0; round < options.maxRounds && frontier.length > 0; round++) {
    const acts: RoundEvent['acted'] = []
    const shares: RoundEvent['shares'] = []
    const ignored: number[] = []
    const nextFrontier: number[] = []

    for (const id of frontier) {
      if (hasActed[id]) continue
      hasActed[id] = 1

      const decision = decisions.get(id)
      // A missing prediction is not a zero: the member is exposed but excluded
      // from the action statistics entirely.
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

      acts.push({ memberId: id, kinds })
      totalActions += kinds.length

      if (kinds.includes('share')) {
        const newly: number[] = []
        for (const neighbour of audience.adjacency[id] ?? []) {
          if (exposed[neighbour]) continue
          exposed[neighbour] = 1
          newly.push(neighbour)
          nextFrontier.push(neighbour)
        }
        // Record the share even when every neighbour had already seen it -
        // the action happened, it just exposed nobody new.
        shares.push({ from: id, to: newly })
      }
    }

    rounds.push({ type: 'round', round, exposed: frontier, acted: acts, shares, ignored })
    frontier = nextFrontier
  }

  return { rounds, totalActions }
}

/**
 * Run the cascade.
 *
 * Trial 0 is the canonical one - it is what the island animates and what the
 * metrics report. The remaining trials exist only to describe spread, which is
 * variability *within these assumptions*, not a validated prediction interval
 * for real engagement.
 */
export function runCascade(
  audience: Audience,
  decisionList: Decision[],
  options: RunOptions,
  trials = 200,
): CascadeResult {
  const decisions = new Map(decisionList.map((d) => [d.memberId, d]))
  const canonical = runTrial(audience, decisions, options, options.seed)

  const totals: number[] = []
  for (let t = 1; t < trials; t++) {
    totals.push(runTrial(audience, decisions, options, options.seed + t * 0x9e3779b1).totalActions)
  }
  totals.sort((a, b) => a - b)
  const quantile = (q: number) =>
    totals.length === 0
      ? canonical.totalActions
      : (totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] as number)

  return {
    rounds: canonical.rounds,
    metrics: summarise(audience, decisionList, canonical, {
      p10: quantile(0.1),
      p50: quantile(0.5),
      p90: quantile(0.9),
    }),
  }
}

function summarise(
  audience: Audience,
  decisions: Decision[],
  trial: TrialOutcome,
  spread: RunMetrics['spread'],
): RunMetrics {
  const groupOf = new Map(audience.members.map((m) => [m.id, m.groupId]))

  const byGroup = new Map<string, GroupMetrics>()
  const ensure = (groupId: string) => {
    const existing = byGroup.get(groupId)
    if (existing) return existing
    const fresh: GroupMetrics = {
      groupId,
      exposed: 0,
      watch: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    }
    byGroup.set(groupId, fresh)
    return fresh
  }
  for (const member of audience.members) ensure(member.groupId)

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

  const missing = decisions.filter((d) => d.missing).length
  const scored = decisions.length - missing

  return {
    uniqueExposed,
    watch: tally.watch,
    likes: tally.like,
    comments: tally.comment,
    shares: tally.share,
    rounds: trial.rounds.length,
    coverage: decisions.length === 0 ? 0 : scored / decisions.length,
    missing,
    byGroup: [...byGroup.values()],
    spread,
  }
}
