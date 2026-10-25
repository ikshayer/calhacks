import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { type Island, type Lamp } from './scene/island'
import { Water } from './Water'
import { SurfaceBorders } from './SurfaceBorders'
import { createTerrainMaterial } from './terrainMaterial'
import { createTerrainGeometry, createRetainingGeometry } from './terrainGeometry'
import { Fountain } from './Fountain'

/** Terrain and navigation share the same authored top triangles. */
export function Terrain({ island, shadows }: { island: Island; shadows: boolean }) {
  const geometry = useMemo(() => createTerrainGeometry(island), [island])
  const retaining = useMemo(() => createRetainingGeometry(island), [island])
  const material = useMemo(() => { const value = createTerrainMaterial(); value.vertexColors = true; return value }, [])
  useEffect(() => () => { geometry.dispose(); retaining.dispose() }, [geometry, retaining])
  useEffect(() => () => material.dispose(), [material])
  return <group>
    <mesh name="Authored island surfaces" geometry={geometry} material={material} receiveShadow={shadows} />
    <mesh name="Inland retaining walls and caps" geometry={retaining} castShadow={shadows} receiveShadow={shadows}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
    <Fountain shadows={shadows} />
    <SurfaceBorders island={island} shadows={shadows} />
    <Lamps lamps={island.lamps} />
    <Water island={island} />
  </group>
}
/**
 * Street lamps, instanced.
 *
 * Two meshes: a dark post that reads as a silhouette against the warm ground,
 * and an emissive head bright enough to clear the bloom threshold so each lamp
 * throws a small flare.
 */
function Lamps({ lamps }: { lamps: Lamp[] }) {
  const postRef = useRef<THREE.InstancedMesh>(null)
  const headRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3(1, 1, 1)

    lamps.forEach((lamp, index) => {
      position.set(lamp.x, (lamp.y ?? 0) + 1.05, lamp.z)
      postRef.current?.setMatrixAt(index, matrix.compose(position, quaternion, scale))
      position.set(lamp.x, (lamp.y ?? 0) + 2.2, lamp.z)
      headRef.current?.setMatrixAt(index, matrix.compose(position, quaternion, scale))
    })
    if (postRef.current) postRef.current.instanceMatrix.needsUpdate = true
    if (headRef.current) headRef.current.instanceMatrix.needsUpdate = true
  }, [lamps])

  if (lamps.length === 0) return null

  return (
    <group>
      <instancedMesh ref={postRef} args={[undefined, undefined, lamps.length]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 2.1, 6]} />
        <meshLambertMaterial color="#4a3a33" />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, lamps.length]}>
        <sphereGeometry args={[0.22, 10, 8]} />
        <meshBasicMaterial color="#ffe6b0" />
      </instancedMesh>
    </group>
  )
}
