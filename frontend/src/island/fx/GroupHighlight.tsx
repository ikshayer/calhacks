import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { IslandSim } from '../scene/IslandSim'
import { createGroundRings, updateGroundRing } from './groundRings'

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
  const meshRef = useRef<THREE.Mesh>(null)

  const members = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < sim.count; i++) {
      if (sim.groupOfIndex(i) === groupId) indices.push(i)
    }
    return indices
  }, [sim, groupId])

  const { geometry, source } = useMemo(() => createGroundRings(members.length, 1.0, 22), [members.length])
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

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.07
    members.forEach((villager, index) => {
      updateGroundRing(geometry, source, index, sim, villager, pulse, 0.08)
    })
  })

  if (members.length === 0) return null

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={3}
    />
  )
}
