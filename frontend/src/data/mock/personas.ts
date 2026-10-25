import { createRng, type Rng } from '@/lib/rng'
import type { Audience, AudienceGroup, AudienceMember, CompanyProfile, Edge } from '@/data/types'

/** The 12 Kenney Mini Characters base models, by file stem. */
export const CHARACTER_MODELS = [
  'character-female-a', 'character-female-b', 'character-female-c',
  'character-female-d', 'character-female-e', 'character-female-f',
  'character-male-a', 'character-male-b', 'character-male-c',
  'character-male-d', 'character-male-e', 'character-male-f',
] as const

/**
 * Optional Kenney accessories. The pack ships mobility and vision aids, so the
 * audience can look like an actual community rather than twelve identical
 * silhouettes. Assigned at random for visual variety only — no trait is
 * inferred from, or attributed to, any real person.
 */
const ACCESSORIES = [
  'aid-glasses', 'aid-sunglasses', 'aid-mask',
  'aid-cane', 'aid-crutch', 'aid_hearing',
] as const

const FIRST_NAMES = [
  'Ama', 'Noor', 'Dev', 'Mira', 'Luis', 'Tess', 'Omar', 'Hana', 'Rafa', 'June',
  'Kito', 'Elin', 'Theo', 'Nadia', 'Sam', 'Priya', 'Jonas', 'Leah', 'Yusuf', 'Cleo',
  'Bruno', 'Ines', 'Kai', 'Marta', 'Soren', 'Zoya', 'Abel', 'Rhea', 'Finn', 'Lupe',
  'Iris', 'Tariq', 'Nell', 'Oscar', 'Suri', 'Bea', 'Milo', 'Asha', 'Gus', 'Wren',
]

const LAST_INITIALS = 'ABCDEFGHJKLMNPRSTVW'.split('')

const HOT_BUTTONS = [
  'a clear ask', 'real faces', 'local place names', 'something to do this weekend',
  'free food', 'a kid-friendly angle', 'a before/after', 'a number that lands',
  'seeing waste avoided', 'a neighbour they recognise', 'a deadline', 'humour',
]

const IGNORES = [
  'long intros', 'corporate voice', 'stock footage', 'no caption',
  'a vague ask', 'guilt-tripping', 'dense text on screen', 'slow first second',
  'hashtag spam', 'a hard sell',
]

const PERSONA_SHAPES = [
  'Scrolls in short bursts and shares what makes a point fast.',
  'Watches with sound off; on-screen text decides it.',
  'Rarely comments but forwards things to one group chat.',
  'Follows local accounts closely and replies to most of them.',
  'Saves posts to act on later, often never does.',
  'Will show up if the time and place are unmistakable.',
  'Shares causes, not products.',
  'Likes generously, shares almost never.',
  'Mutes anything that feels like an ad within a second.',
  'Checks the comments before deciding what to think.',
]

function buildMember(id: number, group: AudienceGroup, rng: Rng, onIsland: boolean): AudienceMember {
  const interestPool = group.interests
  const count = Math.min(interestPool.length, rng.int(3, 5))
  const interests = rng.shuffle(interestPool).slice(0, count)

  return {
    id,
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_INITIALS)}.`,
    groupId: group.id,
    interests,
    persona: rng.pick(PERSONA_SHAPES),
    hotButtons: rng.shuffle(HOT_BUTTONS).slice(0, 2),
    ignores: rng.shuffle(IGNORES).slice(0, 2),
    model: rng.pick(CHARACTER_MODELS),
    accessory: rng.chance(0.22) ? rng.pick(ACCESSORIES) : undefined,
    onIsland,
  }
}

/** How many of the `total` audience members get a body on the island. */
export interface AudienceSize {
  total: number
  onIsland: number
}

/**
 * Build the simulation audience and its sharing graph.
 *
 * The graph is small-world, per the HACK.md sim spec: each member links to 3-8
 * others, mostly inside their own group (shared interests), with a few random
 * cross-links so a cascade can jump districts. Fully determined by `seed`, so
 * an original and a revision can be compared against an identical network.
 */
export function generateAudience(
  profile: CompanyProfile,
  size: AudienceSize,
  seed: number,
): Audience {
  const rng = createRng(seed)
  const groups = profile.groups
  if (groups.length === 0) throw new Error('generateAudience: profile has no audience groups')

  // Assign each member to a group by share, then correct rounding against the largest group.
  const counts = groups.map((g) => Math.round(g.share * size.total))
  const drift = size.total - counts.reduce((a, b) => a + b, 0)
  if (drift !== 0) {
    let biggest = 0
    for (let i = 1; i < counts.length; i++) {
      if ((counts[i] as number) > (counts[biggest] as number)) biggest = i
    }
    counts[biggest] = Math.max(0, (counts[biggest] as number) + drift)
  }

  const members: AudienceMember[] = []
  const byGroup = new Map<string, number[]>()

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi] as AudienceGroup
    const ids: number[] = []
    for (let k = 0; k < (counts[gi] as number); k++) {
      const id = members.length
      members.push(buildMember(id, group, rng, false))
      ids.push(id)
    }
    byGroup.set(group.id, ids)
  }

  // Choose the island cohort proportionally from each group, so every district is populated.
  const islandIds: number[] = []
  for (const group of groups) {
    const ids = byGroup.get(group.id) ?? []
    const want = Math.round(ids.length * (size.onIsland / Math.max(size.total, 1)))
    for (const id of rng.shuffle(ids).slice(0, want)) islandIds.push(id)
  }
  for (const id of islandIds) (members[id] as AudienceMember).onIsland = true

  // --- sharing graph ---------------------------------------------------------
  const seen = new Set<number>()
  const edges: Edge[] = []
  const addEdge = (a: number, b: number) => {
    if (a === b) return
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = lo * size.total + hi
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ a: lo, b: hi })
  }

  for (const member of members) {
    const peers = byGroup.get(member.groupId) ?? []
    const degree = rng.int(3, 8)
    for (let k = 0; k < degree; k++) {
      // ~80% of links stay inside the group; the rest reach anywhere.
      if (peers.length > 1 && rng.chance(0.8)) {
        addEdge(member.id, rng.pick(peers))
      } else {
        addEdge(member.id, rng.int(0, size.total - 1))
      }
    }
  }

  const adjacency: number[][] = Array.from({ length: size.total }, () => [])
  for (const edge of edges) {
    ;(adjacency[edge.a] as number[]).push(edge.b)
    ;(adjacency[edge.b] as number[]).push(edge.a)
  }

  return { version: profile.audienceVersion, members, edges, adjacency }
}
