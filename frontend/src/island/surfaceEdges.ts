export interface SurfaceKinds { Water: number; Grass: number; Sand: number; Road: number; Plaza: number; Dock: number }
export interface SurfaceDetail {
  x: number; y: number; z: number
  width: number; height: number; depth: number
  color: string
  kind: 'wall' | 'cap' | 'curb' | 'shore' | 'paving' | 'fascia' | 'post' | 'rail' | 'plank'
}

/** Decoration is derived from the existing mask; navigation and random streams are untouched. */
export function surfaceBorders(tiles: Uint8Array, grid: number, tile: number, kinds: SurfaceKinds): SurfaceDetail[] {
  const details: SurfaceDetail[] = []
  const postPositions = new Set<string>()
  const wallCorners = new Set<string>()
  const center = (grid - 1) / 2
  const directions = [[1,0], [-1,0], [0,1], [0,-1]] as const
  const add = (kind: SurfaceDetail['kind'], x: number, y: number, z: number,
    width: number, height: number, depth: number, color: string) => {
    details.push({ kind, x, y, z, width, height, depth, color })
  }
  const strip = (kind: SurfaceDetail['kind'], x: number, z: number, dx: number,
    y: number, height: number, thickness: number, length: number, color: string) => {
    add(kind, x, y, z, dx === 0 ? length : thickness, height, dx === 0 ? thickness : length, color)
  }

  for (let index = 0; index < tiles.length; index++) {
    const kind = tiles[index]!
    if (kind === kinds.Water) continue
    const gx = index % grid
    const gz = Math.floor(index / grid)
    const x = (gx - center) * tile
    const z = (gz - center) * tile

    if (kind === kinds.Dock) {
      // Small inset seams read as actual boards without outlining dock tile joins.
      for (let plank = 1; plank < 6; plank++) {
        add('plank', x, 0.012, z - tile / 2 + plank * tile / 6, tile - 0.24, 0.016, 0.025, '#72523d')
      }
    }

    for (const [dx, dz] of directions) {
      const nx = gx + dx
      const nz = gz + dz
      const neighbor = nx >= 0 && nz >= 0 && nx < grid && nz < grid
        ? tiles[nz * grid + nx] : kinds.Water
      const edgeX = x + dx * tile / 2
      const edgeZ = z + dz * tile / 2

      if (neighbor === kinds.Water && kind !== kinds.Dock) {
        const thickness = 0.22
        // Segments end at corner blocks, avoiding overlapping coplanar cap faces.
        strip('wall', edgeX, edgeZ, dx, -0.34, 0.78, thickness, tile - thickness, '#a58364')
        strip('cap', edgeX, edgeZ, dx, 0.07, 0.10, thickness, tile - thickness, '#e0c39a')
        for (const sign of [-1, 1]) {
          const cx = edgeX + dz * sign * tile / 2
          const cz = edgeZ + dx * sign * tile / 2
          const key = `${cx.toFixed(4)},${cz.toFixed(4)}`
          if (wallCorners.has(key)) continue
          wallCorners.add(key)
          add('wall', cx, -0.34, cz, thickness, 0.78, thickness, '#a58364')
          add('cap', cx, 0.07, cz, thickness, 0.10, thickness, '#e0c39a')
        }
      }

      const isPath = kind === kinds.Road || kind === kinds.Plaza
      if (isPath && (neighbor === kinds.Grass || neighbor === kinds.Sand)) {
        // Curbs live on the non-walkable side, clear of resident lane offsets.
        strip('curb', edgeX + dx * 0.10, edgeZ + dz * 0.10, dx, 0.055, 0.11, 0.20, tile, '#d8bc94')
        strip('curb', edgeX + dx * 0.015, edgeZ + dz * 0.015, dx, 0.006, 0.01, 0.045, tile, '#967553')
      }

      if (kind === kinds.Grass && neighbor === kinds.Sand) {
        strip('shore', edgeX - dx * 0.06, edgeZ - dz * 0.06, dx, 0.025, 0.05, 0.12, tile, '#9b995e')
      }

      if (kind === kinds.Plaza && neighbor !== kinds.Plaza && neighbor !== kinds.Water) {
        // Flush inset paving bands leave road approaches open and continuous.
        strip('paving', edgeX - dx * 0.19, edgeZ - dz * 0.19, dx, 0.012, 0.018, 0.24, tile - 0.01, '#e2c89e')
        strip('paving', edgeX - dx * 0.36, edgeZ - dz * 0.36, dx, 0.012, 0.018, 0.06, tile - 0.01, '#ac805b')
      }

      if (kind === kinds.Dock && neighbor === kinds.Water) {
        strip('fascia', edgeX, edgeZ, dx, -0.16, 0.30, 0.20, tile, '#705341')
        strip('cap', edgeX, edgeZ, dx, 0.045, 0.09, 0.20, tile, '#b88a5d')
        // Rail only along exposed dock sides; all land and other dock approaches stay open.
        strip('rail', edgeX, edgeZ, dx, 0.78, 0.075, 0.075, tile, '#e0c39a')
        for (const sign of [-1, 1]) {
          const px = edgeX + dz * sign * tile / 2
          const pz = edgeZ + dx * sign * tile / 2
          const key = `${px.toFixed(4)},${pz.toFixed(4)}`
          if (postPositions.has(key)) continue
          postPositions.add(key)
          add('post', px, 0.46, pz, 0.16, 1.04, 0.16, '#8d694a')
          add('cap', px, 1.0, pz, 0.22, 0.07, 0.22, '#e0c39a')
        }
      }
    }
  }
  return details
}
