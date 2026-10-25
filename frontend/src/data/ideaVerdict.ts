import type { IdeaResident } from './types.ts'

/**
 * One rule for turning a resident's simulated P(visit) into a verdict, shared
 * by the island rings, the sidebar and the member panel so they never disagree.
 * Thresholds are declared, not fitted: raw JEV probabilities for ideas are uncalibrated.
 */
export type IdeaVerdict = 'going' | 'maybe' | 'not'

export const VERDICT_THRESHOLDS = { going: 0.5, maybe: 0.3 } as const

export const VERDICT_STYLE: Record<IdeaVerdict, { label: string; color: string }> = {
  going: { label: 'Would go', color: '#7fb069' },
  maybe: { label: 'Maybe', color: '#f2b53c' },
  not: { label: 'Would not go', color: '#8a8f88' },
}

/** `undefined` for a resident with no prediction (scoring failed). */
export function verdictOf(resident: IdeaResident): IdeaVerdict | undefined {
  if (resident.missing) return undefined
  if (resident.pVisit >= VERDICT_THRESHOLDS.going) return 'going'
  if (resident.pVisit >= VERDICT_THRESHOLDS.maybe) return 'maybe'
  return 'not'
}
