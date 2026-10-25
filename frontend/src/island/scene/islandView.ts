import { ISLAND_SPACING } from './island.ts'

/** Open on the town square from a low diagonal, with foreground homes and sea behind it. */
export const ISLAND_VIEW = {
  position: [32, 17, 39] as const,
  target: [7, 0, 0] as const,
  fov: 38,
  minDistance: 18,
  maxDistance: 115 * ISLAND_SPACING,
}
