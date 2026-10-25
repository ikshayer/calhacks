import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GRID, TILE, Tile, ISLAND_SPACING, type Island } from './scene/island'
import { surfaceBorders } from './surfaceEdges'
import { groundHeight, groundTile, surfaceHeight } from './scene/ground'

/** Every repeated border uses one instanced box batch with per-instance stone/wood colors. */
export function SurfaceBorders({ island, shadows }: { island: Island; shadows: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const details = useMemo(() => {
    const kinds = island.tiles.slice()
    for (const tile of island.connectors ?? []) kinds[tile] = Tile.Road
    return surfaceBorders(kinds, GRID, TILE, Tile)
  }, [island])
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    for (let i = 0; i < details.length; i++) {
      const detail = details[i]!
      matrix.makeScale(detail.width, detail.height, detail.depth)
      const tile = groundTile(detail.x, detail.z), epsilon = 0.001
      const sx = (surfaceHeight(island, tile, detail.x + epsilon, detail.z) - surfaceHeight(island, tile, detail.x - epsilon, detail.z)) / (2 * epsilon)
      const sz = (surfaceHeight(island, tile, detail.x, detail.z + epsilon) - surfaceHeight(island, tile, detail.x, detail.z - epsilon)) / (2 * epsilon)
      matrix.elements[1] = sx * detail.width
      matrix.elements[9] = sz * detail.depth
      matrix.setPosition(detail.x, detail.y + groundHeight(island, detail.x, detail.z), detail.z)
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, color.set(detail.color))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [details, island])

  return <group>
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(details.length, 1)]} receiveShadow={shadows}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
    {/* The plaza and fountain remain on the original low surface. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]} receiveShadow={shadows}>
      <ringGeometry args={[1.70, 2.55, 64]} />
      <meshLambertMaterial color="#f0dcc0" />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]} receiveShadow={shadows}>
      <ringGeometry args={[2.56, 2.70, 64]} />
      <meshLambertMaterial color="#718d88" />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.017, 0]} receiveShadow={shadows}>
      <ringGeometry args={[3.55 * ISLAND_SPACING, 3.55 * ISLAND_SPACING + 0.09, 64]} />
      <meshLambertMaterial color="#ac805b" />
    </mesh>
  </group>
}
