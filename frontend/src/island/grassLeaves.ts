import * as THREE from 'three'
import { GRID, TILE, Tile, type Island } from './scene/island.ts'
import { islandTileAt } from './townArchitecture.ts'
import { createRng, hashSeed } from '../lib/rng.ts'
import type { LeafCard } from './leafCards.ts'
import { groundHeight } from './scene/ground.ts'

const SUBDIVISIONS = 12
const SAMPLE_GRID = GRID * SUBDIVISIONS
const MAX_PATCHES = 18
const MIN_TUFTS = 28
const STEP = TILE / SUBDIVISIONS
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

interface GrassSample { key: number; x: number; y: number; z: number; tile: number }
interface GrassPatch { x: number; z: number; tiles: number[]; tufts: { x: number; z: number }[] }

/** Dense, connected beds cross grass tile joins and taper into the surrounding lawn. */
export function planGrassLeaves(island: Island, blocked: readonly THREE.Box3[]) {
  const rng = createRng(hashSeed('coastal-grass-leaves-v2'))
  const cards: LeafCard[] = []
  const patches: GrassPatch[] = []
  const palette = ['#6c8848', '#78934d', '#8b9c59'].map(value => new THREE.Color(value))
  const samples = new Map<number, GrassSample>()
  const bounds = new THREE.Box3()

  // A continuous grid lets beds flow over tile joins. Reserve the full leaf
  // envelope first so a building or route cannot split a bed into stray tufts.
  island.tiles.forEach((kind, tile) => {
    if (kind !== Tile.Grass) return
    for (let sz = 0; sz < SUBDIVISIONS; sz++) for (let sx = 0; sx < SUBDIVISIONS; sx++) {
      const gx = tile % GRID * SUBDIVISIONS + sx
      const gz = Math.floor(tile / GRID) * SUBDIVISIONS + sz
      const x = (gx + 0.5 - SAMPLE_GRID / 2) * STEP + rng.range(-0.035, 0.035)
      const z = (gz + 0.5 - SAMPLE_GRID / 2) * STEP + rng.range(-0.035, 0.035)
      // Reservations are horizontal: lifted flowers/props must still exclude a bed below them.
      bounds.min.set(x - 0.34, -100, z - 0.34)
      bounds.max.set(x + 0.34, 100, z + 0.34)
      if (blocked.some(box => box.intersectsBox(bounds))) continue
      if ([bounds.min.x, bounds.max.x].some(px => [bounds.min.z, bounds.max.z].some(pz => islandTileAt(island, px, pz) !== Tile.Grass))) continue
      const y = groundHeight(island, x, z)
      if ([bounds.min.x, bounds.max.x].some(px => [bounds.min.z, bounds.max.z].some(pz => Math.abs(groundHeight(island, px, pz) - y) > 0.04))) continue
      const key = gz * SAMPLE_GRID + gx
      samples.set(key, { key, x, y, z, tile })
    }
  })

  const neighbors = (sample: GrassSample) => DIRECTIONS.flatMap(([dx, dz]) => {
    const gx = sample.key % SAMPLE_GRID + dx
    const gz = Math.floor(sample.key / SAMPLE_GRID) + dz
    const neighbor = gx >= 0 && gx < SAMPLE_GRID && gz >= 0 && gz < SAMPLE_GRID
      ? samples.get(gz * SAMPLE_GRID + gx) : undefined
    return neighbor && Math.abs(neighbor.y - sample.y) < 0.04 ? [neighbor] : []
  })

  // Grow one bed per connected, unobstructed lawn. A bed needs a real
  // grass-to-grass join; isolated tiles and narrow leftover strips stay open.
  const remaining = new Set(samples.keys())
  const regions: GrassSample[][] = []
  for (const sample of samples.values()) {
    if (!remaining.delete(sample.key)) continue
    const region = [sample]
    for (let cursor = 0; cursor < region.length; cursor++) {
      for (const neighbor of neighbors(region[cursor]!)) {
        if (remaining.delete(neighbor.key)) region.push(neighbor)
      }
    }
    if (region.length >= MIN_TUFTS) regions.push(region)
  }
  regions.sort((a, b) => b.length - a.length)

  for (const region of regions) {
    if (patches.length >= MAX_PATCHES) break
    const seeds = rng.shuffle(region.filter(sample => neighbors(sample).some(other => other.tile !== sample.tile))).slice(0, 12)
    let best: GrassSample[] = []
    for (const seed of seeds) {
      const turn = rng.range(0, Math.PI * 2)
      const cos = Math.cos(turn), sin = Math.sin(turn)
      const radiusX = TILE * rng.range(0.85, 1.10)
      const radiusZ = TILE * rng.range(0.48, 0.65)
      const inside = (sample: GrassSample) => {
        const dx = sample.x - seed.x, dz = sample.z - seed.z
        const u = (dx * cos + dz * sin) / radiusX
        const v = (-dx * sin + dz * cos) / radiusZ
        const angle = Math.atan2(v, u)
        return Math.hypot(u, v) < 1 + 0.12 * Math.sin(angle * 3 + turn) + 0.07 * Math.sin(angle * 5 - turn)
      }
      const bed = [seed]
      const visited = new Set([seed.key])
      for (let cursor = 0; cursor < bed.length; cursor++) {
        for (const neighbor of neighbors(bed[cursor]!)) {
          if (visited.has(neighbor.key) || !inside(neighbor)) continue
          visited.add(neighbor.key)
          bed.push(neighbor)
        }
      }
      if (bed.length > best.length) best = bed
    }
    const tiles = [...new Set(best.map(sample => sample.tile))]
    if (best.length < MIN_TUFTS || tiles.length < 2) continue
    const keys = new Set(best.map(sample => sample.key))
    patches.push({ x: best.reduce((sum, sample) => sum + sample.x, 0) / best.length,
      z: best.reduce((sum, sample) => sum + sample.z, 0) / best.length,
      tiles, tufts: best.map(({ x, z }) => ({ x, z })) })

    const patchColor = rng.pick(palette)
    for (const sample of best) {
      const edge = neighbors(sample).filter(other => keys.has(other.key)).length < 4
      const leaves = rng.int(6, 8)
      const turn = rng.range(0, Math.PI * 2)
      for (let leaf = 0; leaf < leaves; leaf++) {
        const angle = turn + leaf / leaves * Math.PI * 2 + rng.range(-0.3, 0.3)
        const growth = new THREE.Vector3(Math.cos(angle) * 0.55, rng.range(0.9, 1.3), Math.sin(angle) * 0.55).normalize()
        const face = new THREE.Vector3(Math.cos(angle), 0.15, Math.sin(angle))
        face.addScaledVector(growth, -face.dot(growth)).normalize()
        const right = growth.clone().cross(face).normalize()
        const length = rng.range(0.30, 0.46) * (edge ? 0.72 : 1)
        const matrix = new THREE.Matrix4().makeBasis(right, growth, face)
          .scale(new THREE.Vector3(length * rng.range(0.42, 0.58), length, 1))
          .setPosition(sample.x + Math.cos(angle) * 0.035, sample.y + 0.004, sample.z + Math.sin(angle) * 0.035)
        cards.push({ matrix, color: patchColor.clone().multiplyScalar(rng.range(0.94, 1.10)), detail: leaf >= 6 ? 1 : 0 })
      }
    }
  }
  return { cards, patches }
}
