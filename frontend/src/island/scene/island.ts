import { createRng, type Rng } from '@/lib/rng'

/**
 * The island, built as a grid of tiles rather than a disc.
 *
 * A perfect circle reads as a diagram; a coastline that steps in and out reads
 * as a place. So the land is a square lattice of tiles, kept or dropped against
 * a wobbling radius, with a bay cut into one side and piers reaching out of
 * another. Everything downstream — roads, plots, the walkable graph — is
 * derived from that mask, so the town fits whatever shape the coast takes.
 */

/** Side length of one tile, in world units. */
export const TILE = 2.4
/** Tiles across. Odd, so there is a true centre tile. */
export const GRID = 29
/** Nominal land radius before the coastline is perturbed. */
const BASE_RADIUS = 26

export const Tile = {
  Water: 0,
  Grass: 1,
  Sand: 2,
  Road: 3,
  Plaza: 4,
  Dock: 5,
} as const
export type Tile = (typeof Tile)[keyof typeof Tile]

/** Road grid period, in tiles: 3 tiles of block, then 1 of road. */
const ROAD_PERIOD = 4

export interface Plot {
  model: string
  x: number
  z: number
  rotation: number
  scale: number
  /**
   * Per-building tint, multiplied over the palette texture.
   *
   * The kits ship cream walls, so a street of them is a street of the same
   * house. A gentle wash of colour per building gives the town the painted
   * look the reference has, while staying light enough that windows, doors and
   * roofs still read through it.
   */
  tint?: string
}

export interface Lamp {
  x: number
  z: number
}

export interface Island {
  /** `GRID * GRID` tile kinds, row-major, indexed `z * GRID + x`. */
  tiles: Uint8Array
  /** Walkable road/plaza/dock tiles, as indices into `tiles`. */
  walkable: number[]
  /** `walkable` adjacency, by position in that array. */
  links: number[][]
  plots: Plot[]
  /** Street lamps, placed at junctions. Drawn as geometry, not models. */
  lamps: Lamp[]
}

export const tileToWorld = (index: number) => {
  const gx = index % GRID
  const gz = Math.floor(index / GRID)
  return {
    x: (gx - (GRID - 1) / 2) * TILE,
    z: (gz - (GRID - 1) / 2) * TILE,
  }
}

const inBounds = (gx: number, gz: number) => gx >= 0 && gz >= 0 && gx < GRID && gz < GRID

/**
 * Kenney's city kits are authored at roughly a quarter of the character pack's
 * scale — a house model is the same height as a person model. This brings a
 * building up to a storybook two-and-a-bit times a resident's height.
 */
export const BUILDING_SCALE = 2.6

const HOUSES = [
  'building-type-a', 'building-type-b', 'building-type-c', 'building-type-e',
  'building-type-g', 'building-type-h', 'building-type-k', 'building-type-m',
  'building-type-p', 'building-type-r', 'building-type-t',
] as const

const SHOPS = [
  'building-a', 'building-c', 'building-e', 'building-g', 'building-i',
  'building-k', 'building-n',
] as const

const TOWERS = ['building-skyscraper-a', 'building-skyscraper-c', 'building-skyscraper-e'] as const

/** Sun-faded seaside colours. Kept pale so the texture underneath survives. */
const BUILDING_TINTS = [
  '#ffd9c2', '#ffcfa8', '#f7d9a0', '#e8dcb8', '#ffc8b4',
  '#d8e3c0', '#c9ddd6', '#ffe0cc', '#f2c9c2', '#e6d2e0',
] as const

export function islandModelKeys(): string[] {
  return [
    ...HOUSES.map((m) => `town/suburban/${m}`),
    ...SHOPS.map((m) => `town/commercial/${m}`),
    ...TOWERS.map((m) => `town/commercial/${m}`),
    'town/suburban/tree-large',
    'town/suburban/tree-small',
    'town/suburban/planter',
    'town/suburban/fence-low',
    'town/commercial/detail-parasol-a',
    'town/commercial/detail-parasol-b',
    'island/rocks-low',
    'island/rocks-high',
  ]
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function buildIsland(seed: number): Island {
  const rng = createRng(seed)
  const tiles = new Uint8Array(GRID * GRID)

  carveLand(tiles)
  carveRoads(tiles)
  carvePlaza(tiles)
  carveDocks(tiles, rng)
  markBeaches(tiles)

  const { walkable, links } = buildWalkGraph(tiles)
  const plots = placeBuildings(tiles, rng)
  const lamps = placeLamps(tiles, links, walkable)

  return { tiles, walkable, links, plots, lamps }
}

/**
 * Land mask.
 *
 * The radius wobbles with three sine terms at different frequencies, which
 * gives headlands and coves at different sizes rather than one smooth lobe. A
 * bay is then subtracted so the coast has a real bite in it.
 */
function carveLand(tiles: Uint8Array) {
  const bay = { x: -17, z: 15, r: 15 }

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const index = gz * GRID + gx
      const { x, z } = tileToWorld(index)
      const angle = Math.atan2(z, x)
      const radius =
        BASE_RADIUS *
        (1 +
          0.15 * Math.sin(3 * angle + 1.2) +
          0.1 * Math.sin(5 * angle + 0.4) +
          0.06 * Math.sin(7 * angle + 2.1))

      if (Math.hypot(x, z) > radius) continue
      if (Math.hypot(x - bay.x, z - bay.z) < bay.r) continue
      tiles[index] = Tile.Grass
    }
  }
}

/** A regular grid of streets, clipped to whatever land exists. */
function carveRoads(tiles: Uint8Array) {
  const centre = (GRID - 1) / 2
  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const index = gz * GRID + gx
      if (tiles[index] !== Tile.Grass) continue
      const onAvenue = (gx - centre) % ROAD_PERIOD === 0
      const onStreet = (gz - centre) % ROAD_PERIOD === 0
      if (onAvenue || onStreet) tiles[index] = Tile.Road
    }
  }
  pruneStubs(tiles)
}

/**
 * Removes road tiles that lead nowhere.
 *
 * Clipping a grid to an irregular coast leaves short spurs hanging off the
 * edge. They look like mistakes, and a resident who walks down one has to turn
 * straight back, so anything with fewer than two road neighbours is returned to
 * grass until none are left.
 */
function pruneStubs(tiles: Uint8Array) {
  let changed = true
  while (changed) {
    changed = false
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        const index = gz * GRID + gx
        if (tiles[index] !== Tile.Road) continue
        let neighbours = 0
        for (const [nx, nz] of orthogonal(gx, gz)) {
          if (!inBounds(nx, nz)) continue
          const kind = tiles[nz * GRID + nx]
          if (kind === Tile.Road || kind === Tile.Plaza) neighbours++
        }
        if (neighbours < 2) {
          tiles[index] = Tile.Grass
          changed = true
        }
      }
    }
  }
}

const orthogonal = (gx: number, gz: number): [number, number][] => [
  [gx + 1, gz],
  [gx - 1, gz],
  [gx, gz + 1],
  [gx, gz - 1],
]

/** The square at the centre of town, where the fountain stands. */
function carvePlaza(tiles: Uint8Array) {
  const centre = (GRID - 1) / 2
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const gx = centre + dx
      const gz = centre + dz
      if (!inBounds(gx, gz)) continue
      const index = gz * GRID + gx
      if (tiles[index] === Tile.Water) continue
      tiles[index] = Tile.Plaza
    }
  }
}

/** Piers reaching out over the water, with houses later built along them. */
function carveDocks(tiles: Uint8Array, rng: Rng) {
  const coast: number[] = []
  for (let gz = Math.floor(GRID * 0.55); gz < GRID - 2; gz++) {
    for (let gx = 2; gx < GRID - 2; gx++) {
      const index = gz * GRID + gx
      if (tiles[index] === Tile.Water) continue
      // A south-facing edge tile: land here, open water two rows down.
      if (tiles[(gz + 1) * GRID + gx] === Tile.Water && tiles[(gz + 2) * GRID + gx] === Tile.Water) {
        coast.push(index)
      }
    }
  }
  if (coast.length === 0) return

  for (let pier = 0; pier < 3; pier++) {
    const start = rng.pick(coast)
    const gx = start % GRID
    const gz = Math.floor(start / GRID)
    const length = rng.int(2, 4)
    for (let step = 1; step <= length; step++) {
      const tz = gz + step
      if (!inBounds(gx, tz)) break
      tiles[tz * GRID + gx] = Tile.Dock
      // Widen the pier head so it is somewhere to stand, not just a plank.
      if (step === length && inBounds(gx + 1, tz)) tiles[tz * GRID + gx + 1] = Tile.Dock
    }
    tiles[start] = Tile.Dock
  }
}

/** Any land tile touching water becomes beach. */
function markBeaches(tiles: Uint8Array) {
  const sand: number[] = []
  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const index = gz * GRID + gx
      if (tiles[index] !== Tile.Grass) continue
      const coastal = orthogonal(gx, gz).some(
        ([nx, nz]) => !inBounds(nx, nz) || tiles[nz * GRID + nx] === Tile.Water,
      )
      if (coastal) sand.push(index)
    }
  }
  for (const index of sand) tiles[index] = Tile.Sand
}

/** Road, plaza and dock tiles, and which of them touch each other. */
function buildWalkGraph(tiles: Uint8Array) {
  const walkable: number[] = []
  const slotOf = new Map<number, number>()

  for (let index = 0; index < tiles.length; index++) {
    const kind = tiles[index]
    if (kind === Tile.Road || kind === Tile.Plaza || kind === Tile.Dock) {
      slotOf.set(index, walkable.length)
      walkable.push(index)
    }
  }

  const links = walkable.map((index) => {
    const gx = index % GRID
    const gz = Math.floor(index / GRID)
    const out: number[] = []
    for (const [nx, nz] of orthogonal(gx, gz)) {
      if (!inBounds(nx, nz)) continue
      const slot = slotOf.get(nz * GRID + nx)
      if (slot !== undefined) out.push(slot)
    }
    return out
  })

  return { walkable, links }
}

// ---------------------------------------------------------------------------
// What stands on the land
// ---------------------------------------------------------------------------

/**
 * Fills the blocks.
 *
 * Buildings are placed on 2x2 plots, not on single tiles. A house model is
 * about 3.6 units across and a tile is 2.4, so a building given one tile
 * overhangs its neighbours by half a metre on every side — which is exactly
 * how residents ended up walking through walls. A 4.8-unit plot holds the
 * footprint with room to spare, and because plots are claimed out of block
 * interiors they never touch a road tile.
 *
 * Plots are claimed greedily, scanning in order; whatever is left over gets
 * trees and clutter, which is what gives blocks a built edge and a green
 * middle.
 */
function placeBuildings(tiles: Uint8Array, rng: Rng): Plot[] {
  const plots: Plot[] = []
  const claimed = new Uint8Array(tiles.length)

  const buildable = (gx: number, gz: number) =>
    inBounds(gx, gz) &&
    tiles[gz * GRID + gx] === Tile.Grass &&
    !claimed[gz * GRID + gx]

  for (let gz = 0; gz < GRID - 1; gz++) {
    for (let gx = 0; gx < GRID - 1; gx++) {
      const cells: [number, number][] = [
        [gx, gz], [gx + 1, gz], [gx, gz + 1], [gx + 1, gz + 1],
      ]
      if (!cells.every(([cx, cz]) => buildable(cx, cz))) continue

      const facing = plotFacing(tiles, gx, gz)
      if (facing === null) continue

      // Plot centre sits between the four tiles.
      const x = (gx + 0.5 - (GRID - 1) / 2) * TILE
      const z = (gz + 0.5 - (GRID - 1) / 2) * TILE
      const distance = Math.hypot(x, z) / BASE_RADIUS

      const builtUp = distance < 0.45
      if (!rng.chance(builtUp ? 0.92 : distance < 0.75 ? 0.8 : 0.6)) continue

      const tower = builtUp && rng.chance(0.12)
      const model = tower
        ? `town/commercial/${rng.pick(TOWERS)}`
        : builtUp && rng.chance(0.6)
          ? `town/commercial/${rng.pick(SHOPS)}`
          : `town/suburban/${rng.pick(HOUSES)}`

      plots.push({
        model,
        x,
        z,
        rotation: facing,
        scale: BUILDING_SCALE * (tower ? rng.range(0.62, 0.78) : rng.range(0.94, 1.06)),
        tint: rng.pick(BUILDING_TINTS),
      })
      for (const [cx, cz] of cells) claimed[cz * GRID + cx] = 1
    }
  }

  decorateLeftovers(tiles, claimed, rng, plots)
  return plots
}

/**
 * Everything that is not a building: street furniture on tiles facing a road,
 * trees and rocks everywhere else.
 */
function decorateLeftovers(
  tiles: Uint8Array,
  claimed: Uint8Array,
  rng: Rng,
  plots: Plot[],
) {
  const centre = (GRID - 1) / 2

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const index = gz * GRID + gx
      const kind = tiles[index]
      const { x, z } = tileToWorld(index)

      if (kind === Tile.Plaza) {
        placePlazaFurniture(gx, gz, centre, x, z, rng, plots)
        continue
      }

      if (kind === Tile.Dock) {
        if (rng.chance(0.3)) {
          plots.push({
            model: `town/suburban/${rng.pick(HOUSES)}`,
            x, z,
            rotation: Math.PI,
            scale: BUILDING_SCALE * rng.range(0.7, 0.82),
            tint: rng.pick(BUILDING_TINTS),
          })
        }
        continue
      }

      if (kind === Tile.Sand) {
        if (rng.chance(0.26)) {
          plots.push({
            model: rng.chance(0.6) ? 'island/rocks-low' : 'island/rocks-high',
            x: x + rng.range(-0.5, 0.5),
            z: z + rng.range(-0.5, 0.5),
            rotation: rng.next() * Math.PI * 2,
            scale: rng.range(0.7, 1.15),
          })
        }
        continue
      }

      if (kind !== Tile.Grass || claimed[index]) continue

      const roadside = plotFacing(tiles, gx, gz) !== null
      if (roadside && rng.chance(0.5)) {
        // A front garden: low fence and planting rather than bare ground.
        plots.push({
          model: rng.chance(0.5) ? 'town/suburban/fence-low' : 'town/suburban/planter',
          x: x + rng.range(-0.3, 0.3),
          z: z + rng.range(-0.3, 0.3),
          rotation: rng.pick([0, Math.PI / 2]),
          scale: BUILDING_SCALE * rng.range(0.85, 1),
        })
        continue
      }

      if (rng.chance(0.62)) {
        plots.push({
          model: `town/suburban/${rng.chance(0.55) ? 'tree-large' : 'tree-small'}`,
          x: x + rng.range(-0.6, 0.6),
          z: z + rng.range(-0.6, 0.6),
          rotation: rng.next() * Math.PI * 2,
          scale: BUILDING_SCALE * rng.range(0.8, 1.25),
        })
      }
    }
  }
}

/** The direction a 2x2 plot at (gx, gz) should face, or null if no road adjoins it. */
function plotFacing(tiles: Uint8Array, gx: number, gz: number): number | null {
  const road = (nx: number, nz: number) => {
    if (!inBounds(nx, nz)) return false
    const kind = tiles[nz * GRID + nx]
    return kind === Tile.Road || kind === Tile.Plaza
  }
  if (road(gx, gz + 2) || road(gx + 1, gz + 2)) return 0
  if (road(gx, gz - 1) || road(gx + 1, gz - 1)) return Math.PI
  if (road(gx + 2, gz) || road(gx + 2, gz + 1)) return Math.PI / 2
  if (road(gx - 1, gz) || road(gx - 1, gz + 1)) return -Math.PI / 2
  return null
}

function placePlazaFurniture(
  gx: number,
  gz: number,
  centre: number,
  x: number,
  z: number,
  rng: Rng,
  plots: Plot[],
) {
  const dx = gx - centre
  const dz = gz - centre
  // The fountain tile itself stays clear; it is drawn as geometry.
  if (dx === 0 && dz === 0) return
  if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
    if (rng.chance(0.55)) {
      plots.push({
        model: rng.chance(0.5)
          ? 'town/commercial/detail-parasol-a'
          : 'town/commercial/detail-parasol-b',
        x, z,
        rotation: rng.next() * Math.PI * 2,
        scale: BUILDING_SCALE * 0.95,
      })
    }
    return
  }
  if (rng.chance(0.4)) {
    plots.push({
      model: 'town/suburban/planter',
      x, z,
      rotation: rng.next() * Math.PI * 2,
      scale: BUILDING_SCALE * 0.9,
    })
  }
}

/**
 * Splits the walkable tiles into one loose quarter per audience group.
 *
 * Sorting by angle and dealing out contiguous runs gives each group a
 * neighbourhood without drawing a boundary anywhere, which is what keeps an
 * intra-group cascade visibly local while the town stays unlabelled.
 */
export function assignHomeTiles(
  island: Island,
  groupIds: string[],
  shares: number[],
): Map<string, number[]> {
  const byAngle = island.walkable
    .map((tileIndex, slot) => {
      const { x, z } = tileToWorld(tileIndex)
      return { slot, angle: Math.atan2(z, x) }
    })
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.slot)

  const homes = new Map<string, number[]>()
  const total = shares.reduce((sum, share) => sum + share, 0) || 1
  let cursor = 0

  groupIds.forEach((groupId, index) => {
    const isLast = index === groupIds.length - 1
    const want = isLast
      ? byAngle.length - cursor
      : Math.max(1, Math.round(((shares[index] ?? 0) / total) * byAngle.length))
    const slice = byAngle.slice(cursor, cursor + want)
    homes.set(groupId, slice.length > 0 ? slice : [byAngle[index % byAngle.length] as number])
    cursor += want
  })

  return homes
}

/**
 * Street lamps at junctions.
 *
 * Placed where three or more streets meet, which is where a lamp would
 * actually go and also where people gather. Their heads are emissive, so at
 * this time of day the bloom pass turns each one into a small flare — the
 * cheapest detail in the scene and the one that most makes it look lit rather
 * than coloured.
 */
function placeLamps(tiles: Uint8Array, links: number[][], walkable: number[]): Lamp[] {
  const lamps: Lamp[] = []
  walkable.forEach((tileIndex, slot) => {
    if ((links[slot]?.length ?? 0) < 4) return
    // The plaza is a crossroads on every tile; a dozen lamps in one square
    // reads as a lamp forest, and it has parasols and a fountain already.
    if (tiles[tileIndex] === Tile.Dock || tiles[tileIndex] === Tile.Plaza) return
    const { x, z } = tileToWorld(tileIndex)
    // Tucked to the corner of the junction so nobody walks into the post.
    lamps.push({ x: x + TILE * 0.36, z: z + TILE * 0.36 })
  })
  return lamps
}

// ---------------------------------------------------------------------------
// Distance field
// ---------------------------------------------------------------------------

/** Samples per tile edge in the distance field. Four is enough for soft foam. */
const FIELD_SCALE = 4

/**
 * Tiles of open water added around the grid before the field is computed.
 *
 * Without this the field stops at the island's own grid, and the shader has to
 * assume a constant distance beyond it. That assumption does not match the
 * real distance at the boundary — the grid edge is only a few units from the
 * shore — so the sea changed colour along a hard square outline around the
 * island. Padding pushes the boundary out into water that genuinely is far
 * from land, where the assumed and real distances agree and the seam vanishes.
 */
const FIELD_PADDING = 16

export interface DistanceField {
  /** Distance from each sample to the nearest land, in world units. */
  data: Float32Array
  /** Samples per side. */
  size: number
  /** Half the width the field covers, in world units. */
  extent: number
}

export function buildDistanceField(island: Island): DistanceField {
  const tilesPerSide = GRID + FIELD_PADDING * 2
  const size = tilesPerSide * FIELD_SCALE
  const extent = (tilesPerSide * TILE) / 2
  const step = TILE / FIELD_SCALE
  const data = new Float32Array(size * size)
  const FAR = 1e6

  for (let sz = 0; sz < size; sz++) {
    for (let sx = 0; sx < size; sx++) {
      // Sample coordinates are offset by the padding to index the real grid.
      const gx = Math.floor(sx / FIELD_SCALE) - FIELD_PADDING
      const gz = Math.floor(sz / FIELD_SCALE) - FIELD_PADDING
      const outside = gx < 0 || gz < 0 || gx >= GRID || gz >= GRID
      const water = outside || island.tiles[gz * GRID + gx] === Tile.Water
      data[sz * size + sx] = water ? FAR : 0
    }
  }

  // Chamfer weights: orthogonal steps cost one sample, diagonals root two.
  const ortho = step
  const diag = step * Math.SQRT2
  const at = (x: number, z: number) =>
    x < 0 || z < 0 || x >= size || z >= size ? FAR : (data[z * size + x] as number)

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      data[z * size + x] = Math.min(
        at(x, z),
        at(x - 1, z) + ortho,
        at(x, z - 1) + ortho,
        at(x - 1, z - 1) + diag,
        at(x + 1, z - 1) + diag,
      )
    }
  }
  for (let z = size - 1; z >= 0; z--) {
    for (let x = size - 1; x >= 0; x--) {
      data[z * size + x] = Math.min(
        at(x, z),
        at(x + 1, z) + ortho,
        at(x, z + 1) + ortho,
        at(x + 1, z + 1) + diag,
        at(x - 1, z + 1) + diag,
      )
    }
  }

  return { data, size, extent }
}
