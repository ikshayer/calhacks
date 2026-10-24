import { useEffect, useRef } from 'react'
import type { RoundEvent } from '@/data/types'
import { useAppStore } from '@/store/useAppStore'
import type { IslandSim } from './scene/IslandSim'

/** How long one round is held on screen before the next is staged, in ms. */
const ROUND_DWELL = 2600

/**
 * Drives the island from the cascade's round events.
 *
 * Playback is kept separate from delivery on purpose. Rounds arrive when the
 * backend computes them; the user watches them at their own pace, and can scrub
 * back to see a round again. Those are different clocks, so the store
 * accumulates every round it receives and this hook decides what the island is
 * currently showing.
 *
 * Scrubbing backwards replays from scratch rather than trying to undo: a
 * cascade caps at six rounds, so a full replay costs nothing and cannot drift
 * out of sync with the data.
 */
export function useCascadePlayback(sim: IslandSim | null, rounds: RoundEvent[], runId: string | null) {
  const round = useAppStore((state) => state.playback.round)
  const playing = useAppStore((state) => state.playback.playing)
  const speed = useAppStore((state) => state.playback.speed)
  const seekRound = useAppStore((state) => state.seekRound)

  /** How many rounds are currently staged on the island. */
  const appliedRef = useRef(0)

  // A different run, or a different island, means start over.
  useEffect(() => {
    if (!sim) return
    sim.reset()
    appliedRef.current = 0
  }, [sim, runId])

  // Reconcile the island with the requested round.
  useEffect(() => {
    if (!sim) return
    const target = Math.min(round, rounds.length)

    if (target < appliedRef.current) {
      sim.reset()
      appliedRef.current = 0
    }
    for (let index = appliedRef.current; index < target; index++) {
      const event = rounds[index]
      if (event) sim.applyRound(event)
    }
    appliedRef.current = target
  }, [sim, rounds, round])

  // Advance while playing and there is something left to show.
  useEffect(() => {
    if (!playing || round >= rounds.length) return
    const timer = setTimeout(() => seekRound(round + 1), ROUND_DWELL / Math.max(speed, 0.1))
    return () => clearTimeout(timer)
  }, [playing, round, rounds.length, speed, seekRound])
}
