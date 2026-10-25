import type { Audience, AudienceGroup, CompanyProfile, Edge } from './types.ts'
import type { FamilyRelation, MillbrookWorld } from './millbrookTypes.ts'
import { createRng, hashSeed } from '../lib/rng.ts'
import { RESIDENT_IDS } from '../island/residentAppearance.ts'

export const MILLBROOK_SIZE = { total: 50, onIsland: 50 } as const

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0

function requireData(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Millbrook persona data: ${message}`)
}

/** Validate every field consumed by the profile and all cross-record references. */
export function validateMillbrookWorld(value: unknown): asserts value is MillbrookWorld {
  requireData(record(value) && value.schemaVersion === 1, 'unsupported world schema')
  requireData(integer(value.seed) && integer(value.tick) && typeof value.town === 'string', 'invalid world metadata')
  requireData(Array.isArray(value.personas) && value.personas.length === MILLBROOK_SIZE.total, 'expected exactly 50 residents')
  requireData(Array.isArray(value.households) && value.households.length > 0, 'missing households')
  const ids = new Set<string>()
  const householdIds = new Set<string>()
  for (const household of value.households) {
    requireData(record(household), 'invalid household')
    requireData(typeof household.id === 'string' && household.id.length > 0 && !householdIds.has(household.id), 'duplicate or missing household id')
    requireData(typeof household.surname === 'string' && typeof household.address === 'string' && strings(household.memberIds), 'invalid household fields')
    householdIds.add(household.id)
  }
  for (const persona of value.personas) {
    requireData(record(persona), 'invalid resident')
    requireData(typeof persona.id === 'string' && /^agent_\d{2}$/.test(persona.id) && !ids.has(persona.id), 'duplicate or invalid resident id')
    ids.add(persona.id)
    requireData(integer(persona.age), `invalid age for ${persona.id}`)
    for (const field of ['householdId', 'name', 'gender', 'occupation', 'education', 'hometown', 'backstory', 'speechStyle', 'location']) {
      requireData(typeof persona[field] === 'string', `invalid ${field} for ${persona.id}`)
    }
    for (const field of ['values', 'quirks', 'goals', 'beliefs']) {
      requireData(strings(persona[field]), `invalid ${field} for ${persona.id}`)
    }
    requireData(record(persona.personality), `missing personality for ${persona.id}`)
    for (const trait of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism']) {
      const score = persona.personality[trait]
      requireData(finite(score) && score >= 0 && score <= 1, `invalid ${trait} for ${persona.id}`)
    }
    requireData(typeof persona.mood === 'string' && ['neutral', 'happy', 'stressed', 'sad', 'excited', 'angry', 'calm'].includes(persona.mood), `invalid mood for ${persona.id}`)
    requireData(finite(persona.money) && record(persona.family) && record(persona.friends), `invalid state or relationships for ${persona.id}`)
    requireData(Array.isArray(persona.memories), `invalid memories for ${persona.id}`)
    const memories = new Set<string>()
    for (const memory of persona.memories) {
      requireData(record(memory) && typeof memory.id === 'string' && !memories.has(memory.id) && integer(memory.tick) && typeof memory.text === 'string' && finite(memory.importance) && memory.importance >= 0 && memory.importance <= 1 && strings(memory.tags), `invalid memory for ${persona.id}`)
      memories.add(memory.id)
    }
  }
  const world = value as unknown as MillbrookWorld
  const byId = new Map(world.personas.map((persona) => [persona.id, persona]))
  const membership = new Set<string>()
  for (const household of world.households) {
    for (const id of household.memberIds) {
      requireData(byId.get(id)?.householdId === household.id && !membership.has(id), 'inconsistent household membership')
      membership.add(id)
    }
  }
  requireData(membership.size === ids.size, 'resident missing from household')
  const opposite: Record<FamilyRelation, FamilyRelation> = { spouse: 'spouse', parent: 'child', child: 'parent', sibling: 'sibling' }
  for (const persona of world.personas) {
    for (const [id, relation] of Object.entries(persona.family)) {
      requireData(id !== persona.id && Object.hasOwn(opposite, relation) && byId.get(id)?.family[persona.id] === opposite[relation], `invalid family link for ${persona.id}`)
    }
    for (const [id, affinity] of Object.entries(persona.friends)) {
      requireData(id !== persona.id && byId.has(id) && finite(affinity) && affinity >= -1 && affinity <= 1 && Object.hasOwn(byId.get(id)!.friends, persona.id), `invalid friendship for ${persona.id}`)
    }
  }
}

export async function fetchMillbrookWorld(fetcher: typeof fetch = fetch): Promise<MillbrookWorld> {
  const response = await fetcher('/millbrook-50/data/personas.json')
  if (!response.ok) throw new Error(`Could not load Millbrook personas (HTTP ${response.status}).`)
  const world: unknown = await response.json()
  validateMillbrookWorld(world)
  return world
}

/** Largest remainder allocation, with group ID breaking ties reproducibly. */
export function allocateGroups(groups: AudienceGroup[], total = MILLBROOK_SIZE.total): number[] {
  if (groups.length === 0 || new Set(groups.map((group) => group.id)).size !== groups.length ||
    groups.some((group) => !group.id || !finite(group.share) || group.share < 0)) {
    throw new Error('Millbrook audience needs unique groups with non-negative finite shares.')
  }
  const sum = groups.reduce((n, group) => n + group.share, 0)
  if (!Number.isFinite(sum) || sum <= 0) throw new Error('Millbrook audience group shares must have a positive total.')
  const quotas = groups.map((group) => group.share / sum * total)
  const counts = quotas.map(Math.floor)
  const ranked = groups.map((group, index) => ({ id: group.id, index, remainder: quotas[index]! - counts[index]! }))
    .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id, 'en'))
  const remainder = total - counts.reduce((a, b) => a + b, 0)
  for (let i = 0; i < remainder; i++) counts[ranked[i]!.index]!++
  return counts
}

export function buildMillbrookAudience(world: MillbrookWorld, profile: CompanyProfile): Audience {
  // Source order never changes which source ID a numeric member ID refers to.
  const personas = [...world.personas].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const groups = [...profile.groups].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const counts = allocateGroups(groups)
  const shuffledIds = createRng(hashSeed(`${world.seed}:${profile.id}`)).shuffle(personas.map((_, index) => index))
  const assigned = new Map<number, AudienceGroup>()
  let cursor = 0
  groups.forEach((group, index) => {
    for (let n = 0; n < counts[index]!; n++) assigned.set(shuffledIds[cursor++]!, group)
  })
  const households = new Map(world.households.map((household) => [household.id, household]))
  const members = personas.map((persona, id) => ({
    id,
    name: persona.name,
    groupId: assigned.get(id)!.id,
    interests: [...assigned.get(id)!.interests],
    persona: persona.backstory,
    millbrook: { persona, household: households.get(persona.householdId)! },
    hotButtons: [],
    ignores: [],
    model: `mii:${RESIDENT_IDS[hashSeed(persona.id) % RESIDENT_IDS.length]}`,
    onIsland: true,
  }))
  const numericId = new Map(personas.map((persona, id) => [persona.id, id]))
  const seen = new Set<string>()
  const edges: Edge[] = []
  personas.forEach((persona, from) => {
    for (const sourceId of [...Object.keys(persona.family), ...Object.keys(persona.friends)]) {
      const to = numericId.get(sourceId)!
      const a = Math.min(from, to), b = Math.max(from, to)
      const key = `${a}:${b}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ a, b })
    }
  })
  edges.sort((left, right) => left.a - right.a || left.b - right.b)
  const adjacency: number[][] = Array.from({ length: members.length }, () => [])
  for (const { a, b } of edges) {
    adjacency[a]!.push(b)
    adjacency[b]!.push(a)
  }
  const definition = JSON.stringify({ world, profileId: profile.id, groups })
  return { version: profile.audienceVersion, key: `millbrook-v1:${hashSeed(definition).toString(16)}`, members, edges, adjacency }
}
