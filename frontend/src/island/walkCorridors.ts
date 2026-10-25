import * as THREE from 'three'
import { WALK_CLEARANCE, tileToWorld, type Island } from './scene/island.ts'

export { WALK_CLEARANCE } from './scene/island.ts'

/** Boxes covering every walking lane, for landscaping to keep clear of. */
export function walkCorridors(island: Island): THREE.Box3[] {
  return island.walkable.flatMap((tile, slot) => {
    const from = tileToWorld(tile)
    const targets = [from, ...island.links[slot]!.filter(other => other > slot).map(other => tileToWorld(island.walkable[other]!))]
    return targets.map(to => new THREE.Box3(
      new THREE.Vector3(Math.min(from.x, to.x) - WALK_CLEARANCE, -100, Math.min(from.z, to.z) - WALK_CLEARANCE),
      new THREE.Vector3(Math.max(from.x, to.x) + WALK_CLEARANCE, 100, Math.max(from.z, to.z) + WALK_CLEARANCE)))
  })
}
