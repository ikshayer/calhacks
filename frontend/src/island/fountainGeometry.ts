import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
// The island declares the footprint, so navigation and geometry agree on it.
import { FOUNTAIN_RADIUS } from './scene/island.ts'

export { FOUNTAIN_RADIUS }
export const FOUNTAIN_POOL_Y = 0.49

/** Carved basin and upper bowl share the original fountain's ground footprint. */
export function createFountainGeometry() {
  const stoneParts: THREE.BufferGeometry[] = []
  const trimParts: THREE.BufferGeometry[] = []
  const poolParts: THREE.BufferGeometry[] = []
  const streamParts: THREE.BufferGeometry[] = []
  const splashCenters: THREE.Vector3[] = []
  const lathe = (profile: number[][]) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 40)
  const rim = (r: number, y: number, thickness: number) => new THREE.TorusGeometry(r, thickness, 6, 48)
    .rotateX(Math.PI / 2).translate(0, y, 0)
  stoneParts.push(new THREE.CylinderGeometry(1.62, FOUNTAIN_RADIUS, 0.16, 40).translate(0, 0.08, 0))
  stoneParts.push(lathe([
    [0.24, 0.16], [1.46, 0.16], [1.56, 0.24], [1.59, 0.38], [1.59, 0.56],
    [1.55, 0.63], [1.49, 0.67], [1.38, 0.67], [1.34, 0.59], [1.34, 0.32], [0.24, 0.32],
  ]))
  stoneParts.push(lathe([
    [0.32, 0.30], [0.35, 0.44], [0.29, 0.55], [0.20, 0.63], [0.16, 1.21],
    [0.23, 1.40], [0.46, 1.53], [0.61, 1.66], [0.66, 1.83], [0.62, 1.94],
    [0.51, 1.94], [0.46, 1.80], [0.12, 1.72],
  ]))
  stoneParts.push(lathe([[0.10, 1.72], [0.12, 1.95], [0.15, 2.05], [0.10, 2.16], [0.005, 2.20]]))
  trimParts.push(rim(1.53, 0.27, 0.035), rim(1.47, 0.65, 0.035), rim(0.58, 1.94, 0.025))
  // Fine masonry joints articulate the basin without boxing in its silhouette.
  for (let i = 0; i < 20; i++) trimParts.push(new THREE.BoxGeometry(0.015, 0.15, 0.012)
    .translate(0, 0.46, 1.59).rotateY(i * Math.PI * 2 / 20))
  poolParts.push(new THREE.CircleGeometry(1.34, 48).rotateX(-Math.PI / 2).translate(0, FOUNTAIN_POOL_Y, 0))
  poolParts.push(new THREE.CircleGeometry(0.49, 32).rotateX(-Math.PI / 2).translate(0, 1.88, 0))
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3
    const point = (r: number, y: number) => new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r)
    const overflow = new THREE.CatmullRomCurve3([point(0.59, 1.92), point(0.82, 1.92), point(1.08, 1.35), point(1.15, FOUNTAIN_POOL_Y)])
    streamParts.push(new THREE.TubeGeometry(overflow, 20, 0.035, 5, false))
    splashCenters.push(point(1.15, FOUNTAIN_POOL_Y + 0.012))
    if (i % 2 === 0) {
      const jet = new THREE.QuadraticBezierCurve3(point(0.015, 2.20), point(0.32, 2.76), point(0.41, 1.89))
      streamParts.push(new THREE.TubeGeometry(jet, 18, 0.022, 5, false))
    }
  }
  const merge = (parts: THREE.BufferGeometry[]) => {
    const geometry = mergeGeometries(parts)!
    parts.forEach(part => part.dispose())
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    return geometry
  }
  const stone = merge(stoneParts), trim = merge(trimParts), pools = merge(poolParts), streams = merge(streamParts)
  const ripple = new THREE.RingGeometry(0.87, 1, 24).rotateX(-Math.PI / 2)
  return { stone, trim, pools, streams, ripple, splashCenters,
    dispose() { for (const geometry of [stone, trim, pools, streams, ripple]) geometry.dispose() } }
}
