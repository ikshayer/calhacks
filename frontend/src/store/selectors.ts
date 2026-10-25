import type { ReactionKind, RoundEvent } from '@/data/types'

/** One member's path through a run, read off the round log. */
export interface MemberTimeline {
  /** Round they were first exposed in, or null if the cascade never reached them. */
  exposedAtRound: number | null
  /** Members whose share exposed them. Empty for seed exposures in round 0. */
  exposedBy: number[]
  actedAtRound: number | null
  kinds: ReactionKind[]
  /** Neighbours this member shared on to. */
  sharedTo: number[]
  /** Exposed but did nothing. */
  ignored: boolean
}

/**
 * Reads one member's story out of the round log.
 *
 * The rounds are already the source of truth for the island's choreography, so
 * this derives from them rather than keeping a second per-member index in the
 * store that could drift from the log. A run has a few hundred members and a
 * handful of rounds, so one pass per selection is cheaper than the bookkeeping.
 *
 * Callers should memoise on `[run?.id, run?.rounds.length, memberId]`: rounds
 * are appended while a run streams in, so the length is what signals new data.
 */
export function memberTimeline(rounds: RoundEvent[], memberId: number): MemberTimeline {
  const timeline: MemberTimeline = {
    exposedAtRound: null,
    exposedBy: [],
    actedAtRound: null,
    kinds: [],
    sharedTo: [],
    ignored: false,
  }
  const exposedBy = new Set<number>()
  const sharedTo = new Set<number>()

  for (const event of rounds) {
    if (timeline.exposedAtRound === null && event.exposed.includes(memberId)) {
      timeline.exposedAtRound = event.round
    }

    const action = event.acted.find((entry) => entry.memberId === memberId)
    if (action && timeline.actedAtRound === null) {
      timeline.actedAtRound = event.round
      timeline.kinds = action.kinds
    }

    if (event.ignored.includes(memberId)) timeline.ignored = true

    // A share in round r exposes its targets in round r + 1. Several sharers
    // can reach the same member, so every share edge into them is named rather
    // than guessing which one landed first.
    for (const share of event.shares) {
      if (share.from === memberId) for (const id of share.to) sharedTo.add(id)
      if (share.to.includes(memberId)) exposedBy.add(share.from)
    }
  }

  timeline.exposedBy = [...exposedBy]
  timeline.sharedTo = [...sharedTo]
  return timeline
}
