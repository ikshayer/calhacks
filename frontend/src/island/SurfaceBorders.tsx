import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GRID, TILE, Tile, ISLAND_SPACING, type Island } from './scene/island'
import { surfaceBorders } from './surfaceEdges'

/** Every repeated border uses one instanced box batch with per-instance stone/wood colors. */
export function SurfaceBorders({ island, shadows }: { island: Island; shadows: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const details = useMemo(() => surfaceBorders(island.tiles, GRID, TILE, Tile), [island])
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    for (let i = 0; i < details.length; i++) {
      const detail = details[i]!
      matrix.makeScale(detail.width, detail.height, detail.depth)
      matrix.setPosition(detail.x, detail.y, detail.z)
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, color.set(detail.color))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [details])

  return <group>
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(details.length, 1)]} receiveShadow={shadows}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
    {/* Paving follows the fountain, leaving the existing zero-height navigation intact. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]} receiveShadow={shadows}>
      <ringGeometry args={[2.08, 2.34, 64]} />
      <meshLambertMaterial color="#e2c89e" />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.017, 0]} receiveShadow={shadows}>
      <ringGeometry args={[3.55 * ISLAND_SPACING, 3.55 * ISLAND_SPACING + 0.09, 64]} />
      <meshLambertMaterial color="#ac805b" />
    </mesh>
  </group>
}
