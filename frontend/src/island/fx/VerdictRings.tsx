import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { IslandSim } from '../scene/IslandSim'
import { createGroundRings, updateGroundRing } from './groundRings'

/**
 * Rings an explicit list of residents in one colour.
 *
 * Three of these, one per verdict, colour the town by how each resident
 * answered an idea. Members without a body on the island are skipped.
 */
export function VerdictRings({
  sim,
  memberIds,
  color,
}: {
  sim: IslandSim
  memberIds: number[]
  color: string
}) {
  const meshRef = useRef<THREE.Mesh>(null)

  const villagers = useMemo(() => {
    const indices: number[] = []
    for (const id of memberIds) {
      const index = sim.indexOfMember(id)
      if (index !== undefined) indices.push(index)
    }
    return indices
  }, [sim, memberIds])

  const { geometry, source } = useMemo(() => createGroundRings(villagers.length, 1.0, 22), [villagers.length])
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
    villagers.forEach((villager, index) => {
      updateGroundRing(geometry, source, index, sim, villager, pulse, 0.08)
    })
  })

  if (villagers.length === 0) return null

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
