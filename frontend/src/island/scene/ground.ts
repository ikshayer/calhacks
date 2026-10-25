import { buildIsland, GRID, TILE, Tile, tileToWorld, type Island } from './island.ts'

export const TERRACE_HEIGHT = 1.4
export const MAX_WALK_GRADE = 0.3
const CENTER = (GRID - 1) / 2

export function groundTile(x: number, z: number): number {
  const gx = Math.floor(x / TILE + GRID / 2)
  const gz = Math.floor(z / TILE + GRID / 2)
  return gx >= 0 && gz >= 0 && gx < GRID && gz < GRID ? gz * GRID + gx : -1
}

/** Matches the NW-SE diagonal used by terrain geometry, including ramp breaks. */
export function surfaceHeight(island: Island, tile: number, x: number, z: number): number {
  if (!island.surfaces || tile < 0) return 0
  const { x: cx, z: cz } = tileToWorld(tile)
  const u = Math.max(0, Math.min(1, (x - cx) / TILE + 0.5))
  const v = Math.max(0, Math.min(1, (z - cz) / TILE + 0.5))
  const at = tile * 4
  const nw = island.surfaces[at]!, ne = island.surfaces[at + 1]!
  const sw = island.surfaces[at + 2]!, se = island.surfaces[at + 3]!
  return v >= u ? nw + (se - sw) * u + (sw - nw) * v
    : nw + (ne - nw) * u + (se - ne) * v
}

export function groundHeight(island: Island, x: number, z: number): number {
  return surfaceHeight(island, groundTile(x, z), x, z)
}

/** A short ground decoration can cross ramps, but must stop at cliffs or water. */
export function continuousGroundSpan(island: Island, x: number, z: number, toX: number, toZ: number): boolean {
  const cuts = [0, 1]
  const dx = toX - x, dz = toZ - z
  for (const [start, end, delta] of [[x, toX, dx], [z, toZ, dz]]) {
    if (Math.abs(delta!) < 1e-8) continue
    const first = Math.floor(Math.min(start!, end!) / TILE + GRID / 2) + 1
    const last = Math.floor(Math.max(start!, end!) / TILE + GRID / 2)
    for (let gridLine = first; gridLine <= last; gridLine++) {
      const t = ((gridLine - GRID / 2) * TILE - start!) / delta!
      if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t)
    }
  }
  cuts.sort((a, b) => a - b)
  let previous = groundTile(x, z)
  for (let at = 1; at < cuts.length; at++) {
    const mid = (cuts[at - 1]! + cuts[at]!) / 2
    const tile = groundTile(x + dx * mid, z + dz * mid)
    if (tile < 0 || island.tiles[tile] === Tile.Water) return false
    const t = cuts[at - 1]!, px = x + dx * t, pz = z + dz * t
    if (Math.abs(surfaceHeight(island, previous, px, pz) - surfaceHeight(island, tile, px, pz)) > 1e-5) return false
    previous = tile
  }
  const end = groundTile(toX, toZ)
  return end >= 0 && island.tiles[end] !== Tile.Water &&
    Math.abs(surfaceHeight(island, previous, toX, toZ) - surfaceHeight(island, end, toX, toZ)) < 1e-5
}

/** Full-width boundary continuity, rather than centre heights alone. */
export function continuousEdge(island: Island, from: number, to: number): boolean {
  const a = tileToWorld(from), b = tileToWorld(to)
  if (Math.abs(Math.abs(a.x - b.x) + Math.abs(a.z - b.z) - TILE) > 1e-5) return false
  const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z)
  for (const lane of [-TILE / 2, 0, TILE / 2]) {
    const x = (a.x + b.x) / 2 - dz * lane
    const z = (a.z + b.z) / 2 + dx * lane
    if (Math.abs(surfaceHeight(island, from, x, z) - surfaceHeight(island, to, x, z)) > 1e-5) return false
  }
  return true
}

function authorTerrace(island: Island) {
  const surfaces = new Float32Array(GRID * GRID * 4)
  island.surfaces = surfaces
  island.tiles.forEach((kind, index) => {
    if (kind === Tile.Water || kind === Tile.Sand || kind === Tile.Dock || kind === Tile.Plaza) return
    const gx = index % GRID - CENTER, gz = Math.floor(index / GRID) - CENTER
    const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
    for (const [corner, [dx, dz]] of corners.entries()) {
      let height = 0
      if (gx >= -4 && gx <= 0 && gz >= -10 && gz <= -6) height = TERRACE_HEIGHT
      // The existing two avenues descend before the low cross street/plaza.
      if ((gx === -4 || gx === 0) && kind === Tile.Road && gz >= -6 && gz <= -5) {
        height = TERRACE_HEIGHT * (-(gz + dz!) - 4.5) / 2
      } else if (gx >= -4 && gx <= 0 && gz === -5) {
        // Front gardens meet the house foundations at the top and the street at the foot.
        height = TERRACE_HEIGHT * (-(gz + dz!) - 4.5)
      }
      if (gz === -8 && kind === Tile.Road && gx >= -6 && gx <= -5) {
        height = TERRACE_HEIGHT * (gx + dx! + 6.5) / 2
      }
      if (gz === -8 && kind === Tile.Road && gx >= 1 && gx <= 2) {
        height = TERRACE_HEIGHT * (2.5 - gx - dx!) / 2
      }
      surfaces[index * 4 + corner] = height
    }
  })
}

/** Keep the original street mask and plots; repair historic detached piers over land. */
function connectHarbors(island: Island) {
  const nodes = new Set(island.walkable)
  const connected = new Set<number>()
  const flood = (start: number) => {
    const queue = [start]; connected.add(start)
    for (const tile of queue) for (const next of neighbors(tile)) {
      if (nodes.has(next) && !connected.has(next) && continuousEdge(island, tile, next)) {
        connected.add(next); queue.push(next)
      }
    }
  }
  const neighbors = (tile: number) => {
    const gx = tile % GRID, gz = Math.floor(tile / GRID)
    return [[gx - 1, gz], [gx + 1, gz], [gx, gz - 1], [gx, gz + 1]]
      .filter(([x, z]) => x! >= 0 && x! < GRID && z! >= 0 && z! < GRID).map(([x, z]) => z! * GRID + x!)
  }
  const plaza = island.walkable.find(tile => island.tiles[tile] === Tile.Plaza)!
  flood(plaza)
  const connectors: number[] = []
  // Conservative source lot envelopes. Pier houses are relocated by planTown.
  const buildings = island.plots.filter(plot => plot.model.includes('/building') && island.tiles[groundTile(plot.x, plot.z)] !== Tile.Dock)
  const clear = (tile: number) => {
    const { x, z } = tileToWorld(tile)
    const radius = TILE * 0.26 + 0.48
    return !buildings.some(plot => Math.abs(x - plot.x) < TILE + radius && Math.abs(z - plot.z) < TILE + radius)
  }
  while ([...nodes].some(tile => !connected.has(tile))) {
    const starts = [...nodes].filter(tile => !connected.has(tile))
    const queue = [...starts], previous = new Map<number, number | null>(starts.map(tile => [tile, null]))
    let target: number | undefined
    for (let cursor = 0; cursor < queue.length && target === undefined; cursor++) {
      const tile = queue[cursor]!
      for (const next of neighbors(tile)) {
        if (previous.has(next) || island.tiles[next] === Tile.Water || !continuousEdge(island, tile, next)) continue
        if (!nodes.has(next) && !clear(next)) continue
        previous.set(next, tile); queue.push(next)
        if (connected.has(next)) { target = next; break }
      }
    }
    if (target === undefined) throw new Error('No clear land approach joins the harbor to town')
    let tile: number | null = target
    while (tile !== null) {
      if (!nodes.has(tile)) { nodes.add(tile); connectors.push(tile) }
      tile = previous.get(tile) ?? null
    }
    connected.clear(); flood(plaza)
  }
  island.connectors = connectors.sort((a, b) => a - b)
  island.walkable = [...nodes].sort((a, b) => a - b)
  const slots = new Map(island.walkable.map((tile, slot) => [tile, slot]))
  island.links = island.walkable.map(tile => neighbors(tile).flatMap(next => {
    const slot = slots.get(next)
    return slot !== undefined && continuousEdge(island, tile, next) ? [slot] : []
  }))
}

export function buildElevatedIsland(seed: number): Island {
  const island = buildIsland(seed)
  authorTerrace(island)
  connectHarbors(island)
  validateGroundGraph(island)
  island.plots = island.plots.map(plot => ({ ...plot, y: groundHeight(island, plot.x, plot.z) }))
  island.lamps = island.lamps.map(lamp => ({ ...lamp, y: groundHeight(island, lamp.x, lamp.z) }))
  return island
}

/** Checks the actual rebuilt slot graph; useful independently of renderer state. */
export function validateGroundGraph(island: Island): void {
  if (!island.walkable.length) throw new Error('The town has no walking nodes')
  if (island.links.length !== island.walkable.length || new Set(island.walkable).size !== island.walkable.length) {
    throw new Error('Invalid walking slot table')
  }
  if (island.surfaces && (island.surfaces.length !== GRID * GRID * 4 || !island.surfaces.every(Number.isFinite))) {
    throw new Error('Invalid surface corners')
  }
  for (const tile of island.walkable) {
    if (!Number.isInteger(tile) || tile < 0 || tile >= island.tiles.length || island.tiles[tile] === Tile.Water) {
      throw new Error('Walking nodes must occupy real land')
    }
    if (island.surfaces) {
      const at = tile * 4
      const nw = island.surfaces[at]!, ne = island.surfaces[at + 1]!
      const sw = island.surfaces[at + 2]!, se = island.surfaces[at + 3]!
      if (Math.max(Math.hypot(se - sw, sw - nw), Math.hypot(ne - nw, se - ne)) / TILE > MAX_WALK_GRADE) {
        throw new Error(`Walking tile ${tile} exceeds the ramp grade limit`)
      }
    }
  }
  const visited = new Set([0]), queue = [0]
  for (const at of queue) {
    if (!island.links[at]?.length) throw new Error(`Stranded walking slot ${at}`)
    for (const next of island.links[at]!) {
      if (!Number.isInteger(next) || next < 0 || next >= island.walkable.length) throw new Error('Invalid walking link slot')
      const tile = island.walkable[at]!, target = island.walkable[next]!
      if (island.tiles[target] === Tile.Water || !continuousEdge(island, tile, target) || !island.links[next]?.includes(at)) {
        throw new Error(`Invalid ground transition ${at} -> ${next}`)
      }
      if (!visited.has(next)) { visited.add(next); queue.push(next) }
    }
  }
  if (visited.size !== island.walkable.length) throw new Error('Disconnected walking regions')
}
