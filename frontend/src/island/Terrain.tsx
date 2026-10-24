import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TILE, Tile, tileToWorld, type Island, type Lamp } from './scene/island'
import { Water } from './Water'
import { SurfaceBorders } from './SurfaceBorders'
import { createTerrainMaterial } from './terrainMaterial'
import { Fountain } from './Fountain'

/**
 * Tile palette, warmed for the late-afternoon light.
 *
 * These are the colours the sun then grades: a neutral daylight green would go
 * muddy under a strong orange key, so the greens are already pushed warm and
 * the sand is nearly terracotta.
 */
const TILE_COLOR: Record<number, string> = {
  // Olive rather than a true green: under a strong orange key a cool green
  // turns acid, and the reference's ground is closer to dry grass than lawn.
  [Tile.Grass]: '#8fa958',
  [Tile.Sand]: '#ead2a0',
  // Streets are warm stone, not asphalt. Dark roads cut the island into
  // pieces from above; pale ones read as paths between places.
  [Tile.Road]: '#c3ad8d',
  [Tile.Plaza]: '#dfc6a2',
  [Tile.Dock]: '#9c6b45',
}

/** How far each tile kind stands above sea level. */
const TILE_HEIGHT: Record<number, number> = {
  [Tile.Grass]: 1.5,
  [Tile.Sand]: 1.25,
  [Tile.Road]: 1.45,
  [Tile.Plaza]: 1.5,
  [Tile.Dock]: 1.12,
}

/**
 * The island, drawn as one instanced box per land tile.
 *
 * Instancing the tiles is what makes an irregular coastline affordable: the
 * whole landmass, steps and inlets and piers included, is a single draw call,
 * and the shape is data rather than a mesh somebody has to model. Per-instance
 * colour carries the roads and the plaza, so the street plan needs no extra
 * geometry on top.
 */
export function Terrain({ island, shadows }: { island: Island; shadows: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const landTiles = useMemo(
    () =>
      Array.from(island.tiles)
        .map((kind, index) => ({ kind, index }))
        .filter((tile) => tile.kind !== Tile.Water),
    [island],
  )

  const geometry = useMemo(() => {
    const value = new THREE.BoxGeometry(TILE, 1, TILE)
    value.setAttribute('surfaceKind', new THREE.InstancedBufferAttribute(Float32Array.from(landTiles, tile => tile.kind), 1))
    return value
  }, [landTiles])
  const material = useMemo(() => createTerrainMaterial(), [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const color = new THREE.Color()

    landTiles.forEach((tile, slot) => {
      const { x, z } = tileToWorld(tile.index)
      const height = TILE_HEIGHT[tile.kind] ?? 1.5
      // Boxes are anchored at their centre, so sink them by half their height
      // to leave the top face at y = 0.
      position.set(x, height / 2 - height, z)
      scale.set(1, height, 1)
      mesh.setMatrixAt(slot, matrix.compose(position, quaternion, scale))
      mesh.setColorAt(slot, color.set(TILE_COLOR[tile.kind] ?? '#7fa64e'))
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [landTiles])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.receiveShadow = shadows
    mesh.castShadow = false
  }, [shadows])

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, Math.max(landTiles.length, 1)]}
        frustumCulled={false}
      />
      <Fountain shadows={shadows} />
      <SurfaceBorders island={island} shadows={shadows} />
      <Lamps lamps={island.lamps} />
      <Water island={island} />
    </group>
  )
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
      position.set(lamp.x, 1.05, lamp.z)
      postRef.current?.setMatrixAt(index, matrix.compose(position, quaternion, scale))
      position.set(lamp.x, 2.2, lamp.z)
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
