import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { TILE, Tile, tileToWorld, type Island, type Lamp } from './scene/island'
import { Water } from './Water'

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
  [Tile.Grass]: '#7fab45',
  [Tile.Sand]: '#e8b878',
  // Streets are warm stone, not asphalt. Dark roads cut the island into
  // pieces from above; pale ones read as paths between places.
  [Tile.Road]: '#c3855a',
  [Tile.Plaza]: '#d9a06a',
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

  const geometry = useMemo(() => new THREE.BoxGeometry(TILE, 1, TILE), [])
  const material = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: false }), [])

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
      <Fountain />
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

/** The centrepiece of the plaza. Geometry, because no kit ships one. */
function Fountain() {
  const waterRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const water = waterRef.current
    if (!water) return
    // A slow breathing scale reads as moving water without a shader.
    const t = clock.elapsedTime
    water.scale.setScalar(1 + Math.sin(t * 1.6) * 0.015)
  })

  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.65, 0.45, 20]} />
        <meshLambertMaterial color="#b98152" />
      </mesh>
      <mesh ref={waterRef} position={[0, 0.46, 0]}>
        <cylinderGeometry args={[1.28, 1.28, 0.08, 20]} />
        <meshLambertMaterial color="#6fc3d6" emissive="#2d7f93" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.78, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.26, 0.9, 10]} />
        <meshLambertMaterial color="#cf9a68" />
      </mesh>
      <mesh position={[0, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.62, 0.22, 0.2, 14]} />
        <meshLambertMaterial color="#cf9a68" />
      </mesh>
    </group>
  )
}
