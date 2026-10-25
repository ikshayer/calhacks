import { TILE, Tile, tileToWorld, type Island } from './island.ts'

/**
 * Where residents go, and how they get there.
 *
 * The town's walking graph is small — about 120 tiles — which changes what is
 * affordable. Rather than hand every resident a route to follow and worry
 * about it going stale, every shortest path in town is solved once at startup
 * into a next-hop table. Asking "which way from here to there" is then a
 * single array read, so a resident can be given a destination on the far side
 * of the island without anyone paying for a search.
 *
 * Destinations come out of the tile mask itself, so this stays in step with
 * whatever coastline the generator produced.
 */

export const DestinationKind = {
  /** The street tile outside someone's front door. */
  Door: 'door',
  /** A junction where streets meet — somewhere to pass through or wait. */
  Corner: 'corner',
  /** The square at the centre of town. */
  Plaza: 'plaza',
  /** The end of a pier. */
  Harbor: 'harbor',
} as const
export type DestinationKind = (typeof DestinationKind)[keyof typeof DestinationKind]

/** How often each kind is chosen as the next destination. Sums to 1. */
export const DESTINATION_WEIGHTS: Record<DestinationKind, number> = {
  [DestinationKind.Door]: 0.3,
  [DestinationKind.Corner]: 0.34,
  [DestinationKind.Plaza]: 0.22,
  [DestinationKind.Harbor]: 0.14,
}

export type Destinations = Record<DestinationKind, number[]>

export interface TownRoutes {
  /** Walking slots, matching `island.walkable` indices. */
  readonly nodeCount: number
  /** The slot to step to next on a shortest path, or -1 when already there. */
  step(from: number, to: number): number
  /** Edges between two slots on a shortest path. */
  hops(from: number, to: number): number
}

/** Slots with no route to `from` are left at -1 rather than silently aliased to 0. */
const UNREACHABLE = -1
const EMPTY: ReadonlySet<number> = new Set()

/**
 * Breadth-first search from every slot, recording the first step rather than
 * the predecessor.
 *
 * Storing the first step is what makes routes stateless: a resident holds only
 * its goal, and each arrival asks the table again. A predecessor table would
 * have to be walked backwards from the goal on every step instead.
 */
export function buildRoutes(island: Island, blocked: ReadonlySet<number> = EMPTY): TownRoutes {
  const nodeCount = island.walkable.length
  if (nodeCount === 0) throw new Error('The town has no walking nodes to route between')
  if (nodeCount > 0x7fff) throw new Error(`Too many walking nodes to route: ${nodeCount}`)

  const nextHop = new Int16Array(nodeCount * nodeCount).fill(UNREACHABLE)
  const distance = new Int16Array(nodeCount * nodeCount).fill(UNREACHABLE)
  const queue = new Int32Array(nodeCount)

  for (let source = 0; source < nodeCount; source++) {
    const base = source * nodeCount
    if (blocked.has(source)) continue
    distance[base + source] = 0
    queue[0] = source
    let head = 0
    let tail = 1
    while (head < tail) {
      const at = queue[head++] as number
      const links = island.links[at]
      if (!links) continue
      for (const next of links) {
        if (blocked.has(next) || distance[base + next] !== UNREACHABLE) continue
        distance[base + next] = (distance[base + at] as number) + 1
        // The first step away from the source is the source's own neighbour.
        nextHop[base + next] = at === source ? next : (nextHop[base + at] as number)
        queue[tail++] = next
      }
    }
  }

  return {
    nodeCount,
    step: (from, to) => nextHop[from * nodeCount + to] as number,
    hops: (from, to) => distance[from * nodeCount + to] as number,
  }
}

/**
 * The places worth walking to, by kind.
 *
 * Everything here is read off the tile mask and the placed plots, so no new
 * data has to be threaded through to the simulation. Piers resolve to their
 * heads where the generator left a dead end, because the end of a pier is the
 * part worth standing on; a pier that was joined to the street grid at both
 * ends falls back to its whole length.
 */
export function townDestinations(island: Island, blocked: ReadonlySet<number> = EMPTY): Destinations {
  const plaza: number[] = []
  const dock: number[] = []
  const pierHeads: number[] = []
  const corner: number[] = []

  island.walkable.forEach((tile, slot) => {
    if (blocked.has(slot)) return
    const degree = island.links[slot]?.length ?? 0
    const kind = island.tiles[tile]
    if (kind === Tile.Plaza) plaza.push(slot)
    if (kind === Tile.Dock) {
      dock.push(slot)
      if (degree === 1) pierHeads.push(slot)
    }
    if (degree >= 3) corner.push(slot)
  })

  return {
    [DestinationKind.Plaza]: plaza,
    [DestinationKind.Harbor]: pierHeads.length > 0 ? pierHeads : dock,
    [DestinationKind.Corner]: corner,
    [DestinationKind.Door]: doorSlots(island).filter((slot) => !blocked.has(slot)),
  }
}

/**
 * Walking slots a villager cannot stand on, because something solid is there.
 *
 * A slot is out if an obstruction covers its centre: that is the case the
 * fountain creates, where the plaza's middle tile is paved, joined to its
 * neighbours, and completely filled by the basin.
 */
export function blockedSlots(island: Island): Set<number> {
  const blocked = new Set<number>()
  for (const { x, z, radius } of island.obstructions ?? []) {
    island.walkable.forEach((tile, slot) => {
      const centre = tileToWorld(tile)
      if (Math.hypot(centre.x - x, centre.z - z) < radius) blocked.add(slot)
    })
  }
  return blocked
}

/**
 * The walking tile outside each building.
 *
 * Buildings sit on 2x2 plots whose centres fall between tiles, so the nearest
 * walking slot is a better answer than tile adjacency: it lands on the street
 * the building actually fronts, including where `planTown` had to rotate a
 * house to reach a usable approach.
 */
function doorSlots(island: Island): number[] {
  const slots = new Set<number>()

  for (const plot of island.plots) {
    if (!plot.model.includes('/building')) continue
    let nearest = -1
    let best = Infinity
    island.walkable.forEach((tile, slot) => {
      const { x, z } = tileToWorld(tile)
      const reach = Math.hypot(x - plot.x, z - plot.z)
      if (reach < best) {
        best = reach
        nearest = slot
      }
    })
    // Beyond two tiles the "door" would be a street the building does not face.
    if (nearest >= 0 && best <= TILE * 2) slots.add(nearest)
  }

  // A town whose buildings all failed that test still needs a usable list, or
  // the destination picker would have a kind it can never satisfy.
  if (slots.size === 0) {
    const centre = island.walkable.findIndex((tile) => island.tiles[tile] === Tile.Plaza)
    if (centre >= 0) slots.add(centre)
  }
  return [...slots].sort((a, b) => a - b)
}
