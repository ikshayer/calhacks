import * as THREE from 'three'
import type { IslandSim } from '../scene/IslandSim.ts'

/** One geometry batch, with independent surface samples at every ring vertex. */
export function createGroundRings(count: number, outer: number, segments: number) {
  const ring = new THREE.RingGeometry(0.62, outer, segments)
  const source = Float32Array.from(ring.getAttribute('position').array)
  const vertices = source.length / 3
  const indices = Array.from({ length: count }, (_, index) => [...ring.index!.array].map(at => at + index * vertices)).flat()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(source.length * count), 3))
  geometry.setIndex(indices)
  ring.dispose()
  return { geometry, source }
}

export function updateGroundRing(geometry: THREE.BufferGeometry, source: Float32Array,
  instance: number, sim: IslandSim, resident: number, pulse: number, clearance: number) {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
  const array = attribute.array as Float32Array
  const cx = sim.x[resident]!, cz = sim.z[resident]!
  const offset = source.length * instance
  // Keep the complete circle on this continuous surface. An outer-lane ring
  // can otherwise reach through a ramp's side wall into the lower garden.
  let fit = pulse
  for (let at = source.length / 2; at < source.length; at += 3) {
    const dx = source[at]!, dz = -source[at + 1]!
    if (sim.continuousGroundSpan(cx, cz, cx + dx * fit, cz + dz * fit)) continue
    let low = 0, high = fit
    for (let step = 0; step < 8; step++) {
      const mid = (low + high) / 2
      if (sim.continuousGroundSpan(cx, cz, cx + dx * mid, cz + dz * mid)) low = mid
      else high = mid
    }
    fit = low * 0.995
  }
  for (let at = 0; at < source.length; at += 3) {
    const x = cx + source[at]! * fit, z = cz - source[at + 1]! * fit
    array[offset + at] = x
    array[offset + at + 1] = sim.groundHeight(x, z) + clearance
    array[offset + at + 2] = z
  }
  attribute.needsUpdate = true
}
