import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { IslandSim } from '../scene/IslandSim'

/**
 * A ring on the ground under the selected villager.
 *
 * Villagers keep walking after you click one, so a static highlight would be
 * lost immediately — the ring follows, and pulses so it stays findable in a
 * crowd.
 */
export function SelectionRing({ sim, index }: { sim: IslandSim; index: number }) {
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const ring = ringRef.current
    if (!ring || index >= sim.count) return
    ring.position.set(sim.x[index] as number, 0.06, sim.z[index] as number)
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.4) * 0.09
    ring.scale.setScalar(pulse)
  })

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <ringGeometry args={[0.62, 0.86, 32]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}
