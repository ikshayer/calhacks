import * as THREE from 'three'
import { TILE, Tile, tileToWorld, type Island } from './scene/island.ts'
import { architectureFor, islandTileAt, type RenderPlot, type planTown } from './townArchitecture.ts'
import { placedStaticMatrix, staticBounds, type StaticPart } from './staticTown.ts'
import { createRng, hashSeed } from '../lib/rng.ts'

export interface LandscapePart {
  shape: 'box' | 'round' | 'cylinder'
  matrix: THREE.Matrix4
  color: string
  feature: string
}
export interface LandscapeObstacle { feature: string; bounds: THREE.Box3 }

export { WALK_CLEARANCE, walkCorridors } from './walkCorridors.ts'
import { walkCorridors } from './walkCorridors.ts'
import { groundHeight } from './scene/ground.ts'

/** A render-only composition: no changes to source plots, walk links, or any simulation RNG. */
export function planLandscape(island: Island, town: ReturnType<typeof planTown>, assets: Map<string, StaticPart[]>) {
  const rng = createRng(hashSeed('giving-garden-landscape-v1'))
  const corridors = walkCorridors(island)
  const parts: LandscapePart[] = []
  const obstacles: LandscapeObstacle[] = []
  const buildings = town.plots.filter(plot => plot.style || plot.model.includes('/building'))
  const buildingBounds = buildings.map(plot => plot.style
    ? architectureFor(plot, town.styles.get(plot.style)!).totalBounds.expandByScalar(0.18)
    : staticBounds(assets.get(plot.model)!).applyMatrix4(placedStaticMatrix(plot, new THREE.Matrix4())).expandByScalar(0.18))
  // Door approaches extend to the path even when the building is set back in its lot.
  const approaches = town.plots.filter(plot => plot.style).map(plot => {
    const style = town.styles.get(plot.style!)!
    const door = architectureFor(plot, style).door
    const end = plot.approach ?? (style.scope === 'land' ? TILE * 1.5 : TILE)
    return new THREE.Box3(new THREE.Vector3(door.x - 0.9, -1, door.z), new THREE.Vector3(door.x + 0.9, 10, end))
      .applyMatrix4(new THREE.Matrix4().makeRotationY(plot.rotation).setPosition(plot.x, plot.y ?? 0, plot.z))
  })
  const plots: RenderPlot[] = [...buildings]
  const box = (x: number, z: number, w: number, d: number) => new THREE.Box3(
    new THREE.Vector3(x - w / 2, -0.1, z - d / 2), new THREE.Vector3(x + w / 2, 20, z + d / 2))
  const clear = (bounds: THREE.Box3, allowCanopyOverlap = false) => {
    if ([...corridors, ...buildingBounds, ...approaches,
      ...obstacles.filter(item => !(allowCanopyOverlap && item.feature.includes('/tree-'))).map(item => item.bounds)]
      .some(other => bounds.intersectsBox(other))) return false
    // Sample the entire footprint, including tile boundaries, so no planting floats over a cove.
    const stepsX = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / 0.5))
    const stepsZ = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / 0.5))
    const h = groundHeight(island, (bounds.min.x + bounds.max.x) / 2, (bounds.min.z + bounds.max.z) / 2)
    for (let ix = 0; ix <= stepsX; ix++) {
      const x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, ix / stepsX)
      for (let iz = 0; iz <= stepsZ; iz++) {
        const z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, iz / stepsZ)
        if (islandTileAt(island, x, z) === Tile.Water) return false
        if (Math.abs(groundHeight(island, x, z) - h) > 0.04) return false
      }
    }
    return true
  }
  const add = (shape: LandscapePart['shape'], feature: string, x: number, y: number, z: number,
    w: number, h: number, d: number, color: string, angle = 0) => {
    const matrix = new THREE.Matrix4().makeRotationY(angle)
      .multiply(new THREE.Matrix4().makeScale(w, h, d)).setPosition(x, y + groundHeight(island, x, z), z)
    parts.push({ shape, matrix, color, feature })
  }
  const reserve = (feature: string, bounds: THREE.Box3) => obstacles.push({ feature, bounds })
  const addPlot = (model: string, x: number, z: number, scale: number, rotation = 0) => {
    const plot = { model, x, y: groundHeight(island, x, z), z, scale, rotation, sourceIndex: -plots.length - 1, style: null, theme: 'home' as const, relocated: true }
    const bounds = staticBounds(assets.get(model)!).applyMatrix4(placedStaticMatrix(plot, new THREE.Matrix4()))
    bounds.min.y = -0.1; bounds.max.y = 20
    if (!clear(bounds, model.includes('/tree-'))) return false
    plots.push(plot); reserve(model, bounds)
    return true
  }
  const hedge = (feature: string, x: number, z: number, w: number, d: number, color = '#54734b') => {
    const bounds = box(x, z, w, d)
    if (!clear(bounds)) return false
    add('box', feature, x, 0.09, z, w, 0.18, d, '#b8a17c')
    // One continuous mass reads as a planted bed rather than a row of loose balls.
    add('round', feature, x, 0.42, z, w, 0.70, d, color)
    const alongX = w >= d
    const count = Math.max(2, Math.floor(Math.max(w, d) / 0.65))
    for (let i = 0; i < count; i++) {
      const offset = ((i + 0.5) / count - 0.5) * Math.max(w, d) * 0.75
      add('round', feature, x + (alongX ? offset : 0), 0.76, z + (alongX ? 0 : offset),
        0.24, 0.18, 0.24, feature === 'coastal planting' ? '#e0c48b' : '#d99178')
    }
    reserve(feature, bounds)
    return true
  }
  const bench = (x: number, z: number, angle: number, feature: string) => {
    const bounds = box(0, 0, 1.95, 0.80).applyMatrix4(new THREE.Matrix4().makeRotationY(angle).setPosition(x, groundHeight(island, x, z), z))
    if (!clear(bounds)) return false
    const base = new THREE.Matrix4().makeRotationY(angle).setPosition(x, groundHeight(island, x, z), z)
    const part = (px: number, y: number, pz: number, w: number, h: number, d: number, color: string) => {
      parts.push({ shape: 'box', feature, color, matrix: base.clone().multiply(new THREE.Matrix4().makeScale(w, h, d).setPosition(px, y, pz)) })
    }
    part(0, 0.56, 0, 1.9, 0.14, 0.65, '#b68654')
    part(0, 0.96, -0.29, 1.9, 0.62, 0.12, '#b68654')
    for (const side of [-1, 1]) {
      part(side * 0.73, 0.27, 0, 0.14, 0.54, 0.57, '#465957')
      part(side * 0.86, 0.77, 0, 0.10, 0.10, 0.59, '#465957')
    }
    reserve(feature, bounds)
    return true
  }

  // Keep source coastal rocks only where their actual bounds leave paths and doors clear.
  for (const plot of town.plots.filter(plot => plot.model.startsWith('island/rocks'))) {
    const bounds = staticBounds(assets.get(plot.model)!).applyMatrix4(placedStaticMatrix(plot, new THREE.Matrix4()))
    bounds.min.y = -0.1; bounds.max.y = 20
    if (clear(bounds)) { plots.push({ ...plot }); reserve('coastal rock', bounds) }
  }

  // Seating belongs to garden pockets just outside the square, not to walk graph nodes.
  const plazaEdge = TILE * 2.5
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    for (const side of [-1, 1]) {
      const x = dx ? dx * (plazaEdge + 1.15) : side * TILE * 1.55
      const z = dz ? dz * (plazaEdge + 1.15) : side * TILE * 1.55
      const angle = Math.atan2(-x, -z)
      if (bench(x, z, angle, 'plaza garden seating')) {
        hedge('plaza garden planting', x + dx * 0.85, z + dz * 0.85, dx ? 0.65 : 2.2, dz ? 0.65 : 2.2, '#628451')
      }
    }
  }

  // Small formal urns sit in the spaces between the plaza's protected walking corridors.
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const x = dx * TILE * 1.5, z = dz * TILE * 1.5
    const bounds = box(x, z, 0.6, 0.6)
    if (!clear(bounds)) continue
    add('cylinder', 'plaza urn', x, 0.22, z, 0.56, 0.44, 0.56, '#d4c0a1')
    add('round', 'plaza urn', x, 0.62, z, 0.6, 0.56, 0.6, '#61855b')
    add('round', 'plaza urn', x, 0.85, z, 0.48, 0.22, 0.48, '#e6ba72')
    reserve('plaza urn', bounds)
  }

  // Reuse parasols as garden destinations, away from the plaza through routes.
  const gardenCandidates = Array.from(island.tiles).flatMap((kind, index) => {
    if (kind !== Tile.Grass && kind !== Tile.Sand) return []
    const { x, z } = tileToWorld(index)
    return [{ x, z, score: Math.hypot(x, z) }]
  })
  for (const theme of ['cafe', 'market'] as const) {
    const shop = town.plots.find(plot => plot.theme === theme)
    if (!shop) continue
    const candidates = [...gardenCandidates].sort((a, b) => Math.hypot(a.x - shop.x, a.z - shop.z) - Math.hypot(b.x - shop.x, b.z - shop.z))
    for (const candidate of candidates) {
      if (Math.hypot(candidate.x - shop.x, candidate.z - shop.z) > TILE * 3) break
      if (addPlot(`town/commercial/detail-parasol-${theme === 'cafe' ? 'a' : 'b'}`, candidate.x, candidate.z, 6.1)) break
    }
  }

  // The empty south-west peninsula becomes a coastal garden, with two seats and a grove.
  const peninsula = gardenCandidates.filter(p => p.x < 11 && p.z > 24).sort((a, b) => b.z - a.z)
  let coastalSeats = 0
  for (const p of peninsula) {
    if (coastalSeats >= 2) break
    if (bench(p.x, p.z, Math.PI, 'coastal garden seating')) coastalSeats++
  }

  // A small number of groves replaces the old even distribution of tiny tree dots.
  const groveCenters: { x: number; z: number }[] = []
  const candidates = rng.shuffle(gardenCandidates).sort((a, b) => Number(b.x < 8 && b.z > 24) - Number(a.x < 8 && a.z > 24))
  let treeCount = 0
  for (const center of candidates) {
    if (groveCenters.length >= 9) break
    if (groveCenters.some(other => Math.hypot(other.x - center.x, other.z - center.z) < TILE * 2.3)) continue
    let planted = 0
    for (const [offsetX, offsetZ, height] of [[-0.75, 0, 4.8], [0.8, 0.6, 3.8], [0, -1.0, 3.1]]) {
      const model = `town/suburban/tree-${height! > 4 ? 'large' : 'small'}`
      const scale = height! / staticBounds(assets.get(model)!).getSize(new THREE.Vector3()).y
      if (addPlot(model, center.x + offsetX!, center.z + offsetZ!, scale, rng.range(0, Math.PI * 2))) { planted++; treeCount++ }
    }
    if (planted) {
      groveCenters.push(center)
      hedge('grove underplanting', center.x, center.z + 1.3, 2.6, 0.65)
    }
  }

  // Coast-side beds break selected long stair-step runs without changing the shore mask.
  let coastBeds = 0
  for (const p of rng.shuffle(gardenCandidates)) {
    if (coastBeds >= 13) break
    const outward = [[TILE, 0], [-TILE, 0], [0, TILE], [0, -TILE]]
      .find(([dx, dz]) => islandTileAt(island, p.x + dx!, p.z + dz!) === Tile.Water)
    if (!outward) continue
    if (hedge('coastal planting', p.x, p.z, outward[0] ? 0.85 : 2.3, outward[0] ? 2.3 : 0.85, '#78895c')) coastBeds++
  }

  // Connect residential frontages with a few substantial garden strips, not scattered dots.
  let gardenBeds = 0
  for (const p of gardenCandidates.sort((a, b) => a.score - b.score)) {
    if (gardenBeds >= 12) break
    if (hedge('neighborhood garden', p.x, p.z, 2.6, 0.85, p.x < 0 ? '#668452' : '#527d73')) gardenBeds++
  }
  return { plots, parts, obstacles, corridors, buildingBounds, approaches,
    summary: { trees: treeCount, groves: groveCenters.length, coastBeds, gardenBeds, coastalSeats,
      plazaSeats: obstacles.filter(item => item.feature === 'plaza garden seating').length,
      urns: obstacles.filter(item => item.feature === 'plaza urn').length,
      parts: parts.length } }
}
