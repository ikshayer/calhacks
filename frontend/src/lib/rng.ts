/**
 * Seeded pseudo-random numbers.
 *
 * Every run must be reproducible: HACK.md requires that the audience, graph,
 * starting exposure and trial seeds are preserved across an original and its
 * revision so an A/B comparison is fair. Nothing in the simulation may call
 * `Math.random()`.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [min, max). */
  range(min: number, max: number): number
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** Uniformly chosen element. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T
  /** A new array with the items shuffled (Fisher-Yates). Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[]
}

/** mulberry32 — small, fast, good enough for a simulation, and identical across browsers. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick: empty list')
      return items[Math.floor(next() * items.length)] as never
    },
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = out[i] as never
        out[i] = out[j] as never
        out[j] = a
      }
      return out
    },
  }
  return rng
}

/** Turns an arbitrary string (a campaign id, an audience version) into a stable 32-bit seed. */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
