import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { IslandSim } from '../scene/IslandSim'

/**
 * Marks every villager in one audience group with a disc on the ground.
 *
 * This is what replaced the group names floating over the town. A permanent
 * label told you where a group lived whether you cared or not and made the
 * place look like a diagram; this answers the same question — "which of these
 * people are the students?" — only when you ask it, by pointing at a row in
 * the sidebar. The discs follow, because villagers keep walking.
 */
export function GroupHighlight({
  sim,
  groupId,
  color,
}: {
  sim: IslandSim
  groupId: string
  color: string
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const members = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < sim.count; i++) {
      if (sim.groupOfIndex(i) === groupId) indices.push(i)
    }
    return indices
  }, [sim, groupId])

  const geometry = useMemo(() => new THREE.RingGeometry(0.62, 1.0, 22), [])
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [color],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
    [],
  )
  const scale = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const position = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.07
    scale.setScalar(pulse)

    members.forEach((villager, index) => {
      position.set(sim.x[villager] as number, 0.08, sim.z[villager] as number)
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale))
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  if (members.length === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, members.length]}
      frustumCulled={false}
      renderOrder={3}
    />
  )
}
