import * as THREE from 'three'
import { GRID, TILE, Tile, tileToWorld, type Island } from './scene/island.ts'
import { surfaceHeight } from './scene/ground.ts'

const COLORS: Record<number, string> = { [Tile.Grass]: '#8fa958', [Tile.Sand]: '#ead2a0',
  [Tile.Road]: '#c3ad8d', [Tile.Plaza]: '#dfc6a2', [Tile.Dock]: '#9c6b45' }
const DEPTH: Record<number, number> = { [Tile.Grass]: 1.5, [Tile.Sand]: 1.25,
  [Tile.Road]: 1.45, [Tile.Plaza]: 1.5, [Tile.Dock]: 1.12 }

/** One static batch; top triangles exactly match the queried movement surface. */
export function createTerrainGeometry(island: Island) {
  const positions: number[] = [], colors: number[] = [], kinds: number[] = []
  const connectors = new Set(island.connectors)
  const color = new THREE.Color()
  island.tiles.forEach((kind, tile) => {
    if (kind === Tile.Water) return
    const rendered = connectors.has(tile) ? Tile.Road : kind
    color.set(COLORS[rendered]!)
    const { x, z } = tileToWorld(tile)
    const points = [[x - TILE / 2, z - TILE / 2], [x + TILE / 2, z - TILE / 2],
      [x - TILE / 2, z + TILE / 2], [x + TILE / 2, z + TILE / 2]]
      .map(([px, pz]) => [px!, surfaceHeight(island, tile, px!, pz!), pz!])
    const triangle = (a: number[], b: number[], c: number[]) => {
      positions.push(...a, ...b, ...c)
      for (let i = 0; i < 3; i++) { colors.push(color.r, color.g, color.b); kinds.push(rendered) }
    }
    triangle(points[0]!, points[2]!, points[3]!); triangle(points[0]!, points[3]!, points[1]!)
    for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0]]) {
      const topA = points[a!]!, topB = points[b!]!
      const bottomA = [topA[0]!, -DEPTH[kind]!, topA[2]!], bottomB = [topB[0]!, -DEPTH[kind]!, topB[2]!]
      triangle(topA, topB, bottomB); triangle(topA, bottomB, bottomA)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('surfaceKind', new THREE.Float32BufferAttribute(kinds, 1))
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  return geometry
}

/** Exposed inland faces with caps; continuous ramp seams stay open. */
export function createRetainingGeometry(island: Island) {
  const positions: number[] = [], colors: number[] = []
  const wall = new THREE.Color('#ac8e70'), cap = new THREE.Color('#e5ccaa')
  const add = (points: number[][], color: THREE.Color) => {
    for (const triangle of [[0, 1, 2], [0, 2, 3]]) for (const at of triangle) {
      positions.push(...points[at]!); colors.push(color.r, color.g, color.b)
    }
  }
  island.tiles.forEach((kind, tile) => {
    if (kind === Tile.Water) return
    const { x, z } = tileToWorld(tile)
    const gx = tile % GRID, gz = Math.floor(tile / GRID)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx!, nz = gz + dz!
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue
      const neighbor = nz * GRID + nx
      if (island.tiles[neighbor] === Tile.Water) continue
      const ax = x + dx! * TILE / 2 - dz! * TILE / 2, az = z + dz! * TILE / 2 + dx! * TILE / 2
      const bx = x + dx! * TILE / 2 + dz! * TILE / 2, bz = z + dz! * TILE / 2 - dx! * TILE / 2
      const ha = surfaceHeight(island, tile, ax, az), hb = surfaceHeight(island, tile, bx, bz)
      const la = surfaceHeight(island, neighbor, ax, az), lb = surfaceHeight(island, neighbor, bx, bz)
      if (ha < la - 1e-5 || hb < lb - 1e-5 || Math.max(ha - la, hb - lb) < 0.02) continue
      // The terrain already owns the structural side plane. Offset the stone
      // finish so the two surfaces cannot compete for the same depth samples.
      const face = 0.012
      add([[ax + dx! * face, la, az + dz! * face], [bx + dx! * face, lb, bz + dz! * face],
        [bx + dx! * face, hb, bz + dz! * face], [ax + dx! * face, ha, az + dz! * face]], wall)
      const inset = 0.13
      add([[ax + dx! * face, ha + 0.025, az + dz! * face], [bx + dx! * face, hb + 0.025, bz + dz! * face],
        [bx - dx! * inset, hb + 0.025, bz - dz! * inset], [ax - dx! * inset, ha + 0.025, az - dz! * inset]], cap)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  return geometry
}
