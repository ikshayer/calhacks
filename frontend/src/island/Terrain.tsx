import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { TILE, Tile, tileToWorld, type Island, type Lamp } from './scene/island'
import { Water } from './Water'
import { SurfaceBorders } from './SurfaceBorders'

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
      <SurfaceBorders island={island} shadows={shadows} />
      <PlazaBenches island={island} shadows={shadows} />
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

/**
 * Benches facing the fountain. Geometry, because the kit ships no seating.
 *
 * The plaza is where residents gather and where the camera already rests, so it
 * is worth the few extra boxes. Positions are chosen from the plaza tiles the
 * generator left empty rather than authored by hand: the seeded plot layout is
 * covered by a baseline fixture and must not be edited to make room for these.
 */
function PlazaBenches({ island, shadows }: { island: Island; shadows: boolean }) {
  const benches = useMemo(() => {
    const taken = island.plots.map((plot) => ({ x: plot.x, z: plot.z }))
    const candidates = Array.from(island.tiles).flatMap((kind, index) => {
      if (kind !== Tile.Plaza) return []
      const { x, z } = tileToWorld(index)
      const radius = Math.hypot(x, z)
      // Clear of the fountain itself, inside the ring the parasols occupy.
      if (radius < TILE * 0.9 || radius > TILE * 1.7) return []
      if (taken.some((plot) => Math.hypot(plot.x - x, plot.z - z) < 1.3)) return []
      return [{ x, z, angle: Math.atan2(x, z) }]
    })
    // Spread the chosen seats around the fountain instead of clumping on one side.
    candidates.sort((a, b) => a.angle - b.angle)
    const wanted = Math.min(4, candidates.length)
    return Array.from({ length: wanted }, (_, i) =>
      candidates[Math.floor((i * candidates.length) / wanted)]!)
  }, [island])

  const parts = useMemo(() => {
    const out: THREE.Matrix4[] = []
    const colors: string[] = []
    for (const bench of benches) {
      // Seats face the fountain, so the backrest sits on the outward side.
      const base = new THREE.Matrix4()
        .makeRotationY(Math.atan2(-bench.x, -bench.z))
        .setPosition(bench.x, 0, bench.z)
      const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => {
        out.push(base.clone().multiply(new THREE.Matrix4().makeScale(w, h, d).setPosition(x, y, z)))
        colors.push(color)
      }
      box(0, 0.42, 0, 1.5, 0.12, 0.44, '#c08a52')       // seat
      box(0, 0.68, -0.21, 1.5, 0.40, 0.10, '#c08a52')   // backrest
      box(-0.62, 0.21, 0, 0.12, 0.42, 0.40, '#6d5340')  // legs
      box(0.62, 0.21, 0, 0.12, 0.42, 0.40, '#6d5340')
    }
    return { out, colors }
  }, [benches])

  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const color = new THREE.Color()
    parts.out.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color.set(parts.colors[index]!))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [parts])

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
  }, [shadows])

  if (!parts.out.length) return null

  return (
    <instancedMesh ref={ref} name="Plaza benches" args={[undefined, undefined, parts.out.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
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
