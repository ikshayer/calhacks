/**
 * Seeded pseudo-random numbers, ported from frontend/src/lib/rng.ts.
 *
 * The module cannot use `ctx.random` for the cascade: a run has to honour the
 * seed in its RunOptions so an original and its revision see identical trials.
 * mulberry32 is plain integer arithmetic, so it is deterministic inside a
 * reducer and matches the browser mock bit for bit.
 */

export interface Rng {
  next(): number
  chance(p: number): boolean
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    chance: (p) => next() < p,
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
}
