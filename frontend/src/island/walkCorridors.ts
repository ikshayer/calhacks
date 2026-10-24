import * as THREE from 'three'
import { TILE, tileToWorld, type Island } from './scene/island.ts'

/** Every possible signed lane, body clearance, and junction turn. Altitude independent. */
export const WALK_CLEARANCE = TILE * 0.26 + 0.48
export function walkCorridors(island: Island): THREE.Box3[] {
  return island.walkable.flatMap((tile, slot) => {
    const from = tileToWorld(tile)
    const targets = [from, ...island.links[slot]!.filter(other => other > slot).map(other => tileToWorld(island.walkable[other]!))]
    return targets.map(to => new THREE.Box3(
      new THREE.Vector3(Math.min(from.x, to.x) - WALK_CLEARANCE, -100, Math.min(from.z, to.z) - WALK_CLEARANCE),
      new THREE.Vector3(Math.max(from.x, to.x) + WALK_CLEARANCE, 100, Math.max(from.z, to.z) + WALK_CLEARANCE)))
  })
}
