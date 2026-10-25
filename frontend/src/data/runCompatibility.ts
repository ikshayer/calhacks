import type { RunOptions } from './types.ts'

/** Legacy runs cannot establish that they used the same persona-backed audience. */
export function sameRunAudience(left: RunOptions, right: RunOptions): boolean {
  return Boolean(left.audienceKey) && left.audienceKey === right.audienceKey &&
    left.audienceVersion === right.audienceVersion && left.seed === right.seed &&
    left.seedExposure === right.seedExposure && left.maxRounds === right.maxRounds
}
