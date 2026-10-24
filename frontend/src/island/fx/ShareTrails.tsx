import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { IslandSim } from '../scene/IslandSim'

const MAX_TRAILS = 160
/** Peak height of the arc a share travels along. */
const ARC_HEIGHT = 2.6

/**
 * Shares in flight, drawn as a glowing dot arcing from one villager to another.
 *
 * Every trail follows an actual edge of the sharing graph, which is the point:
 * it shows that the spread is a network effect between specific people, not a
 * number going up. The arc makes direction readable in a crowd and lifts the
 * dot clear of the villagers' heads.
 *
 * One Points object with a fixed-size pool, so a busy round allocates nothing.
 */
export function ShareTrails({ sim }: { sim: IslandSim }) {
  const pointsRef = useRef<THREE.Points>(null)

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRAILS * 3), 3))
    geom.setDrawRange(0, 0)
    return geom
  }, [])

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: new THREE.Color('#ffd166'),
        size: 1.0,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attribute.array as Float32Array
    const count = Math.min(sim.trails.length, MAX_TRAILS)

    for (let i = 0; i < count; i++) {
      const trail = sim.trails[i]
      if (!trail) continue
      const t = trail.progress
      const fromX = sim.x[trail.from] as number
      const fromZ = sim.z[trail.from] as number
      const toX = sim.x[trail.to] as number
      const toZ = sim.z[trail.to] as number

      array[i * 3] = fromX + (toX - fromX) * t
      // A parabola peaking at the midpoint.
      array[i * 3 + 1] = 1.9 + Math.sin(t * Math.PI) * ARC_HEIGHT
      array[i * 3 + 2] = fromZ + (toZ - fromZ) * t
    }

    geometry.setDrawRange(0, count)
    attribute.needsUpdate = true
  })

  return <points ref={pointsRef} args={[geometry, material]} frustumCulled={false} />
}
