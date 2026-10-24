import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { IslandSim } from '../scene/IslandSim'
import { createGroundRings, updateGroundRing } from './groundRings'

/**
 * A ring on the ground under the selected villager.
 *
 * Villagers keep walking after you click one, so a static highlight would be
 * lost immediately — the ring follows, and pulses so it stays findable in a
 * crowd.
 */
export function SelectionRing({ sim, index }: { sim: IslandSim; index: number }) {
  const ringRef = useRef<THREE.Mesh>(null)
  const { geometry, source } = useMemo(() => createGroundRings(1, 0.86, 32), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock }) => {
    const ring = ringRef.current
    if (!ring || index >= sim.count) return
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.4) * 0.09
    updateGroundRing(geometry, source, 0, sim, index, pulse, 0.06)
  })

  return (
    <mesh ref={ringRef} geometry={geometry} frustumCulled={false} renderOrder={2}>
      <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}
