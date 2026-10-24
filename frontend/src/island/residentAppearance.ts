import catalog from './residentCatalog.json' with { type: 'json' }

export const RESIDENT_IDS = catalog.map((entry) => entry.id)
export const RESIDENT_HEIGHT = 2.4
export const RESIDENT_ANCHORS = {
  pickRadius: RESIDENT_HEIGHT * 0.28,
  badge: RESIDENT_HEIGHT + 0.95,
  chatter: RESIDENT_HEIGHT + 0.25,
  trail: RESIDENT_HEIGHT * 0.85,
}

/** Visual randomness never consumes the audience or cascade random stream. */
export function visualHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return hash >>> 0
}

export function residentAppearance(member: { id: number; model: string }, context: string): string {
  const explicit = member.model.replace(/^mii:/, '')
  if (RESIDENT_IDS.includes(explicit)) return explicit
  return RESIDENT_IDS[visualHash(`${context}:resident:${member.id}`) % RESIDENT_IDS.length]!
}

export function residentPhase(memberId: number, context: string): number {
  return visualHash(`${context}:phase:${memberId}`) / 4294967296
}
