import { ISLAND_SPACING } from './island.ts'

/** Recenter the asymmetric landmass while keeping resident-sized close zoom available. */
export const ISLAND_VIEW = {
  position: [7, 74.4, 93] as const,
  target: [7, 0, 0] as const,
  fov: 38,
  minDistance: 18,
  maxDistance: 115 * ISLAND_SPACING,
}
