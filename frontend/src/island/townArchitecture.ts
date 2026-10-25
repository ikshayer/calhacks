import * as THREE from 'three'
import { TILE, GRID, Tile, tileToWorld, type Island, type Plot } from './scene/island.ts'
import { BUILDING_PROFILES, fitBuilding, staticBounds, placedStaticMatrix, remapBuildingY, type BuildingFit, type StaticPart } from './staticTown.ts'
import { continuousGroundSpan, groundHeight, groundTile, surfaceHeight } from './scene/ground.ts'
import { walkCorridors } from './walkCorridors.ts'

export interface RenderPlot extends Plot {
  sourceIndex: number; style: string | null; theme: 'home' | 'cafe' | 'bakery' | 'market' | 'harbour'; relocated: boolean
  /** A longer garden approach when the nearest street became the side of a ramp. */
  approach?: number
}
export interface BuildingStyle { key: string; model: string; fit: BuildingFit; bounds: THREE.Box3; scope: 'land' | 'harbor' }
export interface ArchitectureBox { matrix: THREE.Matrix4; color: string }
export interface ArchitectureSign { matrix: THREE.Matrix4; theme: RenderPlot['theme'] }

export function islandTileAt(island: Island, x: number, z: number): number {
  const gx = Math.round(x / TILE + (GRID - 1) / 2)
  const gz = Math.round(z / TILE + (GRID - 1) / 2)
  return gx >= 0 && gz >= 0 && gx < GRID && gz < GRID ? island.tiles[gz * GRID + gx]! : Tile.Water
}

function footprint(bounds: THREE.Box3, plot: Plot): THREE.Box3 {
  const box = bounds.clone().applyMatrix4(placedStaticMatrix(plot, new THREE.Matrix4()))
  box.min.y = -1; box.max.y = 30
  return box
}

export function planTown(placements: readonly Plot[], island: Island, assets: Map<string, StaticPart[]>) {
  const plots: RenderPlot[] = placements.map((plot, sourceIndex) => ({ ...plot, sourceIndex, style: null, theme: 'home', relocated: false }))
  const styles = new Map<string, BuildingStyle>()
  const rawBounds = new Map([...assets].map(([key, parts]) => [key, staticBounds(parts)]))
  for (const plot of plots) {
    const profile = BUILDING_PROFILES[plot.model.split('/').at(-1)!]
    if (!profile) continue
    const scope = islandTileAt(island, plot.x, plot.z) === Tile.Dock ? 'harbor' : 'land'
    const key = `${plot.model}:${scope}`
    plot.style = key
    if (styles.has(key)) continue
    const peers = plots.filter((other) => other.model === plot.model &&
      (islandTileAt(island, other.x, other.z) === Tile.Dock ? 'harbor' : 'land') === scope)
    const maxScale = Math.max(...peers.map((peer) => peer.scale))
    const averageScale = peers.reduce((total, peer) => total + peer.scale, 0) / peers.length
    const parts = assets.get(plot.model)!
    const fit = fitBuilding(parts, profile, maxScale, averageScale, scope === 'land' ? 5.9 : 2.7)
    const rotated = staticBounds(parts.map((part) => ({ ...part, matrix: new THREE.Matrix4().makeRotationY(profile.yaw).multiply(part.matrix) })))
    const bounds = new THREE.Box3(
      new THREE.Vector3(rotated.min.x * fit.horizontal, remapBuildingY(rotated.min.y, fit), rotated.min.z * fit.horizontal),
      new THREE.Vector3(rotated.max.x * fit.horizontal, remapBuildingY(rotated.max.y, fit), rotated.max.z * fit.horizontal))
    styles.set(key, { key, model: plot.model, fit, bounds, scope })
  }

  // Neighboring low homes face the low cross street rather than a ramp's side
  // retaining wall. Only render orientation changes; source lots/designs stay intact.
  if (island.surfaces) for (const plot of plots.filter(plot => plot.style && styles.get(plot.style)!.scope === 'land')) {
    const door = architectureFor(plot, styles.get(plot.style!)!).door
    const clearApproach = (angle: number, length: number) => {
      const sin = Math.sin(angle), cos = Math.cos(angle)
      const x = plot.x + cos * door.x + sin * length
      const z = plot.z - sin * door.x + cos * length
      if (![Tile.Road, Tile.Plaza, Tile.Dock].includes(islandTileAt(island, x, z) as 3 | 4 | 5)) return false
      return [-0.80, 0, 0.80].every(side => {
        const sx = plot.x + cos * (door.x + side) + sin * (door.z + 0.10)
        const sz = plot.z - sin * (door.x + side) + cos * (door.z + 0.10)
        const ex = plot.x + cos * (door.x + side) + sin * length
        const ez = plot.z - sin * (door.x + side) + cos * length
        return Math.abs(groundHeight(island, sx, sz) - (plot.y ?? 0)) < 1e-5 && continuousGroundSpan(island, sx, sz, ex, ez)
      })
    }
    if (clearApproach(plot.rotation, TILE * 1.5)) continue
    const candidates = [TILE * 1.5, TILE * 2.5].flatMap(length => [plot.rotation, 0, Math.PI, -Math.PI / 2, Math.PI / 2]
      .map(rotation => ({ rotation, length })))
    const chosen = candidates.find(candidate => clearApproach(candidate.rotation, candidate.length))
    if (!chosen) throw new Error(`No continuous ground approach for building ${plot.sourceIndex}`)
    plot.rotation = chosen.rotation; plot.approach = chosen.length
  }

  const worldBounds = (plot: RenderPlot) => {
    if (!plot.style) return footprint(rawBounds.get(plot.model)!, plot)
    const bounds = architectureFor(plot, styles.get(plot.style)!).totalBounds
    bounds.min.y = -1; bounds.max.y = 30
    return bounds
  }
  const land = plots.filter((plot) => plot.style && styles.get(plot.style)!.scope === 'land')
  const harbor = plots.filter((plot) => plot.style && styles.get(plot.style)!.scope === 'harbor')
  const themePlots = [...land].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 3)
  themePlots.forEach((plot, index) => {
    plot.theme = (['cafe', 'bakery', 'market'] as const)[index]!
  })
  const fixedBuildings = plots.filter((plot) => !plot.style && plot.model.includes('/building'))
  const blockedBuildings = [...land, ...fixedBuildings].map((plot) => worldBounds(plot).expandByScalar(0.16))
  const props = plots.filter((plot) => !plot.style && !plot.model.includes('/building'))
  const changedProps = new Set<RenderPlot>()
  const isWalking = (kind: number) => kind === Tile.Road || kind === Tile.Plaza || kind === Tile.Dock
  const corridors = island.connectors?.length ? walkCorridors(island) : []

  for (const [harborIndex, plot] of harbor.entries()) {
    plot.theme = harborIndex === 0 ? 'harbour' : 'home'
    const candidates = Array.from(island.tiles).flatMap((kind, index) => {
      if (kind !== Tile.Grass && kind !== Tile.Sand) return []
      const { x, z } = tileToWorld(index)
      const approaches = [[1,0], [-1,0], [0,1], [0,-1]].filter(([dx, dz]) => isWalking(islandTileAt(island, x + dx! * TILE, z + dz! * TILE)))
      if (!approaches.length) return []
      const direction = approaches.sort((a, b) =>
        Math.hypot(x + a[0]! * TILE - plot.x, z + a[1]! * TILE - plot.z) -
        Math.hypot(x + b[0]! * TILE - plot.x, z + b[1]! * TILE - plot.z))[0]!
      const candidate = { ...plot, x, z, y: groundHeight(island, x, z), rotation: Math.atan2(direction[0]!, direction[1]!) }
      const bounds = worldBounds(candidate).expandByScalar(0.16)
      if (blockedBuildings.some((other) => other.intersectsBox(bounds))) return []
      if (corridors.some(other => other.intersectsBox(bounds))) return []
      if ([bounds.min.x, bounds.max.x].some(px => [bounds.min.z, bounds.max.z].some(pz =>
        Math.abs(groundHeight(island, px, pz) - candidate.y) > 0.04))) return []
      const blockingProps = props.filter((other) => worldBounds(other).expandByScalar(0.12).intersectsBox(bounds))
      return [{ candidate, bounds, blockingProps, score: Math.hypot(x - plot.x, z - plot.z) + blockingProps.length * 3 }]
    }).sort((a, b) => a.score - b.score)
    const chosen = candidates[0]
    if (!chosen) throw new Error(`No clear land position for waterfront building ${plot.sourceIndex}`)
    Object.assign(plot, chosen.candidate, { relocated: true, theme: harborIndex === 0 ? 'harbour' : 'home' })
    blockedBuildings.push(chosen.bounds)
    chosen.blockingProps.forEach((prop) => changedProps.add(prop))
  }

  // Relocate only decorations displaced by the old pier houses; retain their designs and sizes.
  for (const prop of changedProps) {
    const candidates = Array.from(island.tiles).flatMap((kind, index) => {
      if (kind !== Tile.Grass && kind !== Tile.Sand) return []
      const candidate = { ...prop, ...tileToWorld(index) }
      if (island.surfaces) candidate.y = groundHeight(island, candidate.x, candidate.z)
      const bounds = worldBounds(candidate).expandByScalar(0.12)
      if (blockedBuildings.some((other) => other.intersectsBox(bounds))) return []
      if (props.some((other) => other !== prop && worldBounds(other).expandByScalar(0.12).intersectsBox(bounds))) return []
      for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
        if (![Tile.Grass, Tile.Sand].includes(islandTileAt(island, x, z) as 1 | 2)) return []
      }
      return [{ candidate, distance: Math.hypot(candidate.x - prop.x, candidate.z - prop.z) }]
    }).sort((a, b) => a.distance - b.distance)
    if (!candidates[0]) throw new Error('No clear garden position for displaced waterfront decoration')
    Object.assign(prop, candidates[0].candidate, { relocated: true })
  }
  return { plots, styles }
}

/** Garden flowers, offset per lot so neighbouring beds do not repeat the same run. */
const BLOOM_COLORS = ['#d9654e', '#e8b84b', '#c9709e', '#e07f4a']

export function architectureFor(plot: RenderPlot, style: BuildingStyle, island?: Island) {
  const boxes: ArchitectureBox[] = []
  const signs: ArchitectureSign[] = []
  const rotation = new THREE.Matrix4().makeRotationY(plot.rotation).setPosition(plot.x, plot.y ?? 0, plot.z)
  const add = (x: number, y: number, z: number, width: number, height: number, depth: number, color: string) => {
    boxes.push({ matrix: rotation.clone().multiply(new THREE.Matrix4().makeScale(width, height, depth).setPosition(x, y, z)), color })
  }
  const bounds = style.bounds.clone()
  bounds.min.multiplyScalar(plot.scale); bounds.max.multiplyScalar(plot.scale)
  const width = bounds.max.x - bounds.min.x
  const depth = bounds.max.z - bounds.min.z
  const cx = (bounds.min.x + bounds.max.x) / 2
  const cz = (bounds.min.z + bounds.max.z) / 2
  const x = style.fit.profile.doorX * style.fit.horizontal * plot.scale
  const z = style.fit.profile.doorZ * style.fit.horizontal * plot.scale + 0.065
  const accent = plot.theme === 'cafe' ? '#3f9290' : plot.theme === 'bakery' ? '#c97667'
    : plot.theme === 'market' ? '#78984f' : plot.theme === 'harbour' ? '#477f9c'
      : plot.x < 0 ? '#789578' : '#638895'

  // Solid foundation edges stop at the doorway; paving remains flush and navigable.
  add(cx, 0.10, bounds.min.z - 0.025, width + 0.09, 0.20, 0.10, '#967f69')
  add(bounds.min.x - 0.025, 0.10, cz, 0.10, 0.20, depth, '#967f69')
  add(bounds.max.x + 0.025, 0.10, cz, 0.10, 0.20, depth, '#967f69')
  const doorWidth = 1.28
  const doorHeight = 2.42
  add(x, doorHeight / 2 + 0.035, z, doorWidth, doorHeight, 0.05, accent)
  add(x - doorWidth / 2 - 0.055, 1.27, z + 0.015, 0.11, 2.54, 0.10, '#e9d7b5')
  add(x + doorWidth / 2 + 0.055, 1.27, z + 0.015, 0.11, 2.54, 0.10, '#e9d7b5')
  add(x, 2.56, z + 0.015, doorWidth + 0.22, 0.13, 0.10, '#e9d7b5')
  add(x + doorWidth * 0.33, 1.12, z + 0.055, 0.07, 0.07, 0.05, '#d6b276')
  // A modest inset glazed panel makes the entrance read without erasing adjacent windows.
  add(x, 1.70, z + 0.028, 0.85, 0.76, 0.018, '#8cb2b2')
  const edge = style.scope === 'land' ? TILE : TILE / 2 - 0.12
  const pathStart = z + 0.10
  if (edge > pathStart && !island?.surfaces) add(x, 0.018, (pathStart + edge) / 2, 1.55, 0.024, edge - pathStart, '#d4bc96')

  // Keep the kit's roof silhouette. The overall model bounds include porches and
  // setbacks, so a rectangular fascia derived from them floats away from the roof.

  // A low fence across the frontage, split by the entrance, gives each lot a
  // readable boundary. The gap is wider than the paving so the approach the
  // residents actually walk is never narrowed. Painted rather than planted: a
  // green hedge on green grass disappears at the overview camera, which is the
  // distance this detail has to survive. Land lots only, because a waterfront
  // structure has no front garden and the half-lot it is fitted to cannot hold
  // the railing without pushing totalBounds past the plot allowance.
  const fenceGap = 0.86
  const fenceZ = bounds.max.z + 0.26
  const rail = plot.x < 0 ? '#d8d9b7' : '#b9d1c9'
  for (const side of style.scope === 'land' ? ([-1, 1] as const) : []) {
    const outer = side < 0 ? bounds.min.x : bounds.max.x
    const inner = x + side * fenceGap
    const span = Math.abs(outer - inner)
    if (span < 0.34) continue
    add((outer + inner) / 2, 0.21, fenceZ, span, 0.42, 0.11, rail)
    // Posts at the gate and the lot corner stop the rail reading as a floating slab.
    add(inner, 0.26, fenceZ, 0.15, 0.52, 0.17, '#9d8664')
    add(outer, 0.26, fenceZ, 0.15, 0.52, 0.17, '#9d8664')
    // A short return down the side closes the front garden.
    add(outer, 0.21, fenceZ - 0.30, 0.11, 0.42, 0.60, rail)

    // Pass 3 planting, on the street side of the railing rather than the garden
    // side. Behind the rail the bed is occluded by it at every camera angle the
    // overview allows; in front it reads, and it stays inside the depth the
    // side return already claims, so the lot allowance is unchanged.
    const bedZ = fenceZ + 0.17
    add((outer + inner) / 2, 0.08, bedZ, span, 0.16, 0.22, '#5a4634')
    const blooms = Math.min(4, Math.floor(span / 0.45))
    for (let i = 0; i < blooms; i++) {
      const t = (i + 0.5) / blooms
      const at = Math.min(outer, inner) + span * t
      add(at, 0.27, bedZ, 0.28, 0.24, 0.22, BLOOM_COLORS[(i + plot.sourceIndex) % BLOOM_COLORS.length]!)
    }
  }

  if (plot.theme !== 'home') {
    const awningWidth = Math.min(2.65, width - 0.24)
    const awningX = THREE.MathUtils.clamp(x, bounds.min.x + awningWidth / 2, bounds.max.x - awningWidth / 2)
    const awningZ = Math.min(z + 0.29, edge - 0.32)
    add(awningX, 2.88, awningZ, awningWidth, 0.12, 0.62, accent)
    add(awningX, 2.76, awningZ + 0.29, awningWidth, 0.22, 0.07, accent)
    for (let stripe = 0; stripe < 5; stripe++) add(awningX - awningWidth / 2 + (stripe + 0.5) * awningWidth / 5,
      2.947, awningZ, awningWidth / 10, 0.016, 0.61, '#ead6b5')
    // A taller fascia and visible stripe color identify shops from the overview.
    signs.push({ theme: plot.theme, matrix: rotation.clone().multiply(new THREE.Matrix4().makeScale(awningWidth, 0.51, 1)
      .setPosition(awningX, 3.23, awningZ + 0.335)) })
    if (plot.theme === 'harbour') {
      // A small gabled harbor-office pennant gives the waterfront its own silhouette.
      add(cx, bounds.max.y + 0.36, cz, 0.06, 0.72, 0.06, '#80674d')
      add(cx + 0.44, bounds.max.y + 0.53, cz, 0.86, 0.36, 0.035, accent)
    }
  }
  const totalBounds = bounds.clone().applyMatrix4(rotation)
  const unitBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
  for (const box of boxes) totalBounds.union(unitBox.clone().applyMatrix4(box.matrix))
  return { boxes, signs, door: { x, z, width: doorWidth, height: doorHeight }, footprint: bounds, totalBounds }
}

/** Flush paving follows the whole door approach, including the graded front gardens. */
export function entrancePaving(plot: RenderPlot, style: BuildingStyle, island: Island): ArchitectureBox[] {
  if (!island.surfaces) return []
  const door = architectureFor(plot, style).door
  const end = plot.approach ?? (style.scope === 'land' ? TILE * 1.5 : TILE)
  const start = door.z + 0.10
  // Slabs end at tile boundaries: no slab can bridge a flat/ramp grade break.
  const boundaries = [start, end]
  const sin = Math.sin(plot.rotation), cos = Math.cos(plot.rotation)
  for (const [origin, direction] of [[plot.x + cos * door.x, sin], [plot.z - sin * door.x, cos]]) {
    if (Math.abs(direction!) < 0.5) continue
    for (let gridLine = 0; gridLine <= GRID; gridLine++) {
      const local = ((gridLine - GRID / 2) * TILE - origin!) / direction!
      if (local > start + 1e-7 && local < end - 1e-7) boundaries.push(local)
    }
  }
  boundaries.sort((a, b) => a - b)
  const slabs: [number, number][] = []
  for (let at = 1; at < boundaries.length; at++) {
    const a = boundaries[at - 1]!, b = boundaries[at]!
    const count = Math.ceil((b - a) / 0.25)
    for (let i = 0; i < count; i++) slabs.push([a + (b - a) * i / count, a + (b - a) * (i + 1) / count])
  }
  const base = new THREE.Matrix4().makeRotationY(plot.rotation).setPosition(plot.x, 0, plot.z)
  const boxes: ArchitectureBox[] = []
  for (const [a, b] of slabs) {
    const length = b - a
    const matrix = base.clone().multiply(new THREE.Matrix4().makeScale(1.55, 0.024, length)
      .setPosition(door.x, 0, (a + b) / 2))
    const e = matrix.elements, x = e[12]!, z = e[14]!, tile = groundTile(x, z)
    // Sample inside the same triangle/tile at the centre: horizontal paving becomes a graded slab.
    const h = groundHeight(island, x, z)
    const epsilon = 0.001
    const sample = (px: number, pz: number) => surfaceHeight(island, tile, px, pz)
    const sx = (sample(x + epsilon, z) - sample(x - epsilon, z)) / (2 * epsilon)
    const sz = (sample(x, z + epsilon) - sample(x, z - epsilon)) / (2 * epsilon)
    e[1] = e[0]! * sx + e[2]! * sz; e[9] = e[8]! * sx + e[10]! * sz; e[13] = h + 0.018
    boxes.push({ matrix, color: '#d4bc96' })
  }
  return boxes
}
