import type * as THREE from 'three'

/**
 * Framing for the camera that follows a selected resident.
 *
 * The opening view is a bird's-eye shot from ~120 units out, where a resident
 * is a few pixels tall. Following only pays off if the person is legible, so
 * the dolly stops at a distance where a body fills roughly a fifth of the
 * frame height at the scene's 38 degree field of view: close enough to read
 * their walk, far enough that the neighbours they are heading towards stay in
 * shot. That is below OrbitControls' usual `minDistance`, hence the lowered
 * floor while following.
 */
export const FOLLOW_DISTANCE = 13
/** Look at the head, not the feet, or the body sits at the bottom of frame. */
export const FOLLOW_HEIGHT = 2.4
/** Seconds the dolly-in (and the return home) takes to settle. */
export const FOLLOW_EASE_SEC = 0.75
/**
 * Floor on `controls.minDistance` while following. Under `FOLLOW_DISTANCE` so
 * the user can still zoom in on the person they are watching, but not so low
 * that the camera ends up inside the character.
 */
export const FOLLOW_MIN_DISTANCE = 6
/**
 * Terrain clearance for the camera. High enough that a ramp or hill under the
 * camera cannot swallow the lens during the dolly.
 */
export const FOLLOW_MIN_CLEARANCE = 4
/**
 * Time constant for the target tracking a walking resident. Much shorter than
 * the dolly's: the target should stay glued to the person, with just enough
 * smoothing to hide the stepped changes in their path.
 */
export const FOLLOW_TRACK_TAU_SEC = 0.12
/** Distance at which an eased move counts as arrived. */
export const ARRIVE_EPSILON = 0.25
/**
 * Hard cap on the approach, in seconds.
 *
 * An exponential ease chasing a moving target settles at a lag of roughly
 * speed × tau, so convergence depends on how fast residents walk — at today's
 * 0.50–0.75 u/s the lag lands just inside `ARRIVE_EPSILON`, but speeding
 * residents up would push it outside and the approach would never finish.
 * Approach holds the camera position, so that failure mode is silent: the user
 * would simply find that orbiting no longer works. This cap hands control back
 * regardless.
 */
export const APPROACH_TIMEOUT_SEC = FOLLOW_EASE_SEC * 2

/**
 * Time constant for an ease that is ~95% done after `seconds` (three time
 * constants of an exponential approach).
 */
export const tauFor = (seconds: number): number => seconds / 3

/** Frame-rate independent lerp factor for an exponential approach. */
export const lerpFactor = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau)

/** Writes the point to look at (the resident's head) into `out`. */
export function headPosition(out: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
  return out.set(x, y + FOLLOW_HEIGHT, z)
}

/**
 * Lowest angle above the horizon the follow camera will sit at, in radians.
 *
 * Inheriting the user's orbit angle keeps the dolly from wrenching the view
 * around, but the opening camera is nearly horizontal, and a near-horizontal
 * approach at `FOLLOW_DISTANCE` puts the lens inside the town: residents walk
 * between buildings, so the shot ends up behind a roof with the person you
 * just selected hidden. Clearing the terrain is not enough, because what
 * occludes them is the architecture standing on it. Looking down from ~40°
 * clears the rooftops while still reading as street level rather than a map.
 *
 * This sits just above the opening view's own angle (~36°), so it engages on
 * an ordinary selection rather than only after the user has orbited low.
 */
export const FOLLOW_MIN_ELEVATION = 0.7

/**
 * Writes the dolly destination into `out`: `FOLLOW_DISTANCE` from `focus`
 * along `direction` (unit length), tilted up to at least
 * `FOLLOW_MIN_ELEVATION` and lifted to clear the terrain at `groundY`.
 *
 * The direction's compass bearing is preserved — only its pitch is raised —
 * so the camera still arrives from the side the user was already looking from.
 */
export function dollyDestination(
  out: THREE.Vector3,
  focus: THREE.Vector3,
  direction: THREE.Vector3,
  groundY: number,
): THREE.Vector3 {
  const minY = Math.sin(FOLLOW_MIN_ELEVATION)
  if (direction.y < minY) {
    // Rescale the horizontal part so the vector stays unit length, keeping the
    // bearing and changing only how steeply the camera looks down.
    const horizontal = Math.hypot(direction.x, direction.z)
    const wanted = Math.cos(FOLLOW_MIN_ELEVATION)
    const scale = horizontal > 1e-6 ? wanted / horizontal : 0
    out.set(direction.x * scale, minY, direction.z * scale)
  } else {
    out.copy(direction)
  }
  out.multiplyScalar(FOLLOW_DISTANCE).add(focus)
  out.y = Math.max(out.y, groundY + FOLLOW_MIN_CLEARANCE)
  return out
}
