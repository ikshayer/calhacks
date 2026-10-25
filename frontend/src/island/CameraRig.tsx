import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { IslandSim } from './scene/IslandSim'
import { ISLAND_VIEW } from './scene/islandView'
import {
  APPROACH_TIMEOUT_SEC,
  ARRIVE_EPSILON,
  FOLLOW_EASE_SEC,
  FOLLOW_MIN_DISTANCE,
  FOLLOW_TRACK_TAU_SEC,
  dollyDestination,
  headPosition,
  lerpFactor,
  tauFor,
} from './scene/followCamera'

interface CameraRigProps {
  sim: IslandSim
  /** Villager index to follow, or null to hand the camera back. */
  followIndex: number | null
  /**
   * True when someone is selected who has no body on the island.
   *
   * Most of the audience is simulated without being rendered, and the sidebar
   * offers those members as neighbours to click. There is nothing to follow,
   * but flying home is the wrong answer: the user did not deselect, and a
   * camera that leaps back to the island view reads as the click having gone
   * wrong. Holding still leaves the view they already had.
   */
  hold?: boolean
  controls: RefObject<OrbitControlsImpl | null>
}

type Phase = 'idle' | 'approach' | 'follow' | 'release'

/** Module-level so the per-frame loop does not mutate the controls prop inline. */
function setMinDistance(orbit: OrbitControlsImpl, distance: number): void {
  orbit.minDistance = distance
}

/**
 * Dollies onto the selected resident, then tracks them as they walk.
 *
 * Only the dolly-in and the return trip script the camera. While following,
 * this rig moves `controls.target` and nothing else: the camera's position is
 * left to OrbitControls, so the user can still orbit and zoom around the person
 * they are watching. A fully scripted camera would feel like a cutscene and
 * fight the user's hands; moving just the pivot makes it feel like an operator
 * keeping the subject in frame while the viewer chooses the angle.
 *
 * Selecting a different resident mid-follow re-approaches from wherever the
 * camera is, and keeps the original "home" snapshot so deselecting still
 * returns to the view the user had before they started following anyone.
 */
export function CameraRig({ sim, followIndex, hold = false, controls }: CameraRigProps) {
  const reduceMotion = Boolean(useReducedMotion())
  const phase = useRef<Phase>('idle')
  const lastIndex = useRef<number | null>(null)
  /**
   * Whether `homePosition`/`homeTarget` hold a view worth going back to.
   *
   * Following can be interrupted by selecting someone with no body, which
   * parks the camera mid-town. Re-snapshotting on the next selection would
   * make that parked view the new "home", so the original is kept until a
   * release actually returns to it.
   */
  const homeSet = useRef(false)
  /** Previous `hold`, so clearing a held selection still triggers the return. */
  const lastHold = useRef(false)
  /** Seconds spent in the current approach, against `APPROACH_TIMEOUT_SEC`. */
  const approachElapsed = useRef(0)
  const scratch = useMemo(
    () => ({
      homePosition: new THREE.Vector3(),
      homeTarget: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      focus: new THREE.Vector3(),
      destination: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ camera }, delta) => {
    const orbit = controls.current
    if (!orbit) return
    const { homePosition, homeTarget, direction, focus, destination } = scratch
    // A frame hitch must not turn into a jump.
    const dt = Math.min(delta, 0.1)

    // A stale index (audience rebuilt with fewer residents) falls through to release.
    const index = followIndex !== null && followIndex < sim.count ? followIndex : null

    // `hold` is part of the transition: going from a held selection to nothing
    // selected leaves the index null on both sides, and the camera would
    // otherwise sit parked in the town with no way back.
    if (index !== lastIndex.current || hold !== lastHold.current) {
      if (index !== null) {
        if (!homeSet.current) {
          // First selection: remember the user's view so deselecting can restore it.
          homePosition.copy(camera.position)
          homeTarget.copy(orbit.target)
          homeSet.current = true
        }
        // Dolly along the orbit the user is already on so the view does not wrench around.
        direction.copy(camera.position).sub(orbit.target)
        if (direction.lengthSq() < 1e-6) direction.set(0, 0.5, 1)
        direction.normalize()
        setMinDistance(orbit, FOLLOW_MIN_DISTANCE)
        approachElapsed.current = 0
        phase.current = 'approach'
      } else if (hold) {
        // Someone is still selected, they just have no body to follow. Stop
        // driving the camera and leave the view exactly as the user left it.
        phase.current = 'idle'
      } else if (homeSet.current) {
        phase.current = 'release'
      }
      lastIndex.current = index
      lastHold.current = hold
    }

    switch (phase.current) {
      case 'idle':
        return

      case 'approach': {
        if (index === null) return
        headPosition(focus, sim.x[index]!, sim.y[index]!, sim.z[index]!)
        dollyDestination(destination, focus, direction, sim.groundHeight(focus.x, focus.z))
        if (reduceMotion) {
          camera.position.copy(destination)
          orbit.target.copy(focus)
          phase.current = 'follow'
        } else {
          const k = lerpFactor(dt, tauFor(FOLLOW_EASE_SEC))
          camera.position.lerp(destination, k)
          orbit.target.lerp(focus, k)
          approachElapsed.current += dt
          if (
            camera.position.distanceTo(destination) < ARRIVE_EPSILON ||
            approachElapsed.current >= APPROACH_TIMEOUT_SEC
          ) {
            phase.current = 'follow'
          }
        }
        orbit.update()
        return
      }

      case 'follow': {
        if (index === null) return
        headPosition(focus, sim.x[index]!, sim.y[index]!, sim.z[index]!)
        if (reduceMotion) orbit.target.copy(focus)
        else orbit.target.lerp(focus, lerpFactor(dt, FOLLOW_TRACK_TAU_SEC))
        orbit.update()
        return
      }

      case 'release': {
        if (reduceMotion) {
          camera.position.copy(homePosition)
          orbit.target.copy(homeTarget)
        } else {
          const k = lerpFactor(dt, tauFor(FOLLOW_EASE_SEC))
          camera.position.lerp(homePosition, k)
          orbit.target.lerp(homeTarget, k)
        }
        orbit.update()
        if (
          reduceMotion ||
          (camera.position.distanceTo(homePosition) < ARRIVE_EPSILON &&
            orbit.target.distanceTo(homeTarget) < ARRIVE_EPSILON)
        ) {
          setMinDistance(orbit, ISLAND_VIEW.minDistance)
          homeSet.current = false
          phase.current = 'idle'
        }
        return
      }
    }
  })

  return null
}
