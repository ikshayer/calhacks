import * as THREE from 'three'
import { Activity } from './scene/IslandSim.ts'

/**
 * Poses laid over the animation, rather than more clips.
 *
 * The residents ship with four actions — idle, walk, wave and look around —
 * and nothing that reads as holding a phone, agreeing with something, or
 * brushing it off. Authoring those would mean re-exporting twenty characters
 * out of Blender and re-running the deformation checks against all of them.
 *
 * Instead the handful of bones that carry those gestures are rotated on top of
 * whatever the mixer produced.
 *
 * That has to be done carefully. `PropertyMixer` only writes a bone back when
 * the value it computed differs from the one it wrote last, so a bone whose
 * track holds the same value for the whole clip — the neck, on every one of
 * these clips — is never written at all. Rotating such a bone in place
 * compounds the rotation every frame, and the heads wound round and round.
 *
 * So each posed bone keeps the animation's pose separately from the pose this
 * writes, and every frame is composed from the former rather than from
 * whatever is on the bone.
 *
 * The rig makes this tractable: every bone's local +Y runs along its own
 * length, and the spine from the hip up to the head is identity-rotated, so
 * the head's local axes are the model's — +Y up, +Z the way it faces. Head
 * movement is therefore exact rather than approximate.
 */

/** Bones the overlay writes to. A design missing any of them simply opts out. */
const HEAD = 'head'
const NECK = 'neck'
const ARMS = ['bicep.L', 'bicep.R', 'forearm.L', 'forearm.R'] as const

/**
 * Finds a bone under the name the rig was authored with.
 *
 * glTF strips the characters three.js reserves for property paths, so the
 * `bicep.L` of the Blender rig arrives as `bicepL`. Looking only for the
 * authored spelling silently finds nothing and the arms never move, so both
 * are tried.
 */
function findBone(model: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return model.getObjectByName(name) ??
    model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name))
}

/** Phone held at chest height: elbows bent up, upper arms forward and in. */
const PHONE_FOREARM = 1.15
const PHONE_BICEP_FORWARD = 0.34
const PHONE_BICEP_IN = 0.17
/** Reading something in your hands puts your chin down, not just your eyes. */
const PHONE_HEAD_DOWN = 0.32
const PHONE_NECK_DOWN = 0.12

/** Agreement: a couple of nods across the beat. */
const NOD_ANGLE = 0.2
const NOD_CYCLES = 2
/** Dismissal: a slower, wider shake. */
const SHAKE_ANGLE = 0.3
const SHAKE_CYCLES = 2.5

/**
 * Nobody holds still.
 *
 * Without this the phone pose is a mannequin, which at close range reads worse
 * than no pose at all. The drift is small and slow enough to be felt rather
 * than seen.
 */
const DRIFT_ANGLE = 0.035
const DRIFT_RATE = 1.3

/** Seconds for a pose to come in or go out, matching the clip cross-fade. */
const POSE_TAU = 0.06

export interface ResidentPose {
  /**
   * Writes this frame's pose. Call once per mixer update, after it, with the
   * time that update covered.
   */
  apply(dt: number, activity: number, elapsed: number, gaze: number): void
}

/**
 * Binds an overlay to one resident's skeleton.
 *
 * Returns null when the design does not carry the bones this works through, so
 * an unexpected export degrades to the plain clips instead of throwing in the
 * middle of a frame.
 */
export function createPoseOverlay(model: THREE.Object3D, phase = 0): ResidentPose | null {
  const head = findBone(model, HEAD)
  const neck = findBone(model, NECK)
  if (!head || !neck) return null

  const arms = ARMS.map((name) => findBone(model, name))
  const hasArms = arms.every((bone): bone is THREE.Object3D => Boolean(bone))

  const delta = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  /** How far the phone pose is in, 0..1. Smoothed so poses do not snap on. */
  let phone = 0

  /** A bone, the animation's pose for it, and the pose this last left on it. */
  interface Posed {
    bone: THREE.Object3D
    animated: THREE.Quaternion
    written: THREE.Quaternion
  }
  const track = (bone: THREE.Object3D): Posed => ({
    bone,
    animated: bone.quaternion.clone(),
    written: bone.quaternion.clone(),
  })

  /**
   * Rotates a bone by `(x, y, z)` radians about its own axes, replacing rather
   * than compounding whatever this wrote last frame.
   *
   * A bone that differs from what was written has been moved by the mixer, so
   * that becomes the new animated pose; one that matches was left untouched,
   * and the previous animated pose still stands. Either way the result is
   * composed from the animation, never from the last overlay.
   */
  const turn = (posed: Posed, x: number, y: number, z: number) => {
    if (!posed.bone.quaternion.equals(posed.written)) posed.animated.copy(posed.bone.quaternion)
    const length = Math.hypot(x, y, z)
    if (length < 1e-6) {
      // Still written back, so releasing a pose returns the bone to the clip.
      posed.bone.quaternion.copy(posed.animated)
    } else {
      axis.set(x / length, y / length, z / length)
      delta.setFromAxisAngle(axis, length)
      // Post-multiplied, so the rotation is read in the bone's own frame and
      // bends with the animation rather than against it.
      posed.bone.quaternion.copy(posed.animated).multiply(delta)
    }
    posed.written.copy(posed.bone.quaternion)
  }

  const posedHead = track(head)
  const posedNeck = track(neck)
  const posedArms = hasArms
    ? { bicepL: track(arms[0]), bicepR: track(arms[1]), forearmL: track(arms[2]), forearmR: track(arms[3]) }
    : null

  return {
    apply(dt, activity, elapsed, gaze) {
      const wantsPhone = activity === Activity.OnPhone ||
        activity === Activity.Reacting ||
        activity === Activity.Sharing ||
        activity === Activity.Dismissing
      // Dismissing lowers the phone as it shakes its head, so the beat ends
      // with the arms already on their way down.
      const target = wantsPhone
        ? (activity === Activity.Dismissing ? Math.max(0, 1 - elapsed / 0.9) : 1)
        : 0
      phone += (target - phone) * Math.min(1, dt / POSE_TAU)
      if (phone < 1e-3 && target === 0) phone = 0

      const drift = Math.sin((elapsed + phase * 10) * DRIFT_RATE) * DRIFT_ANGLE

      let headPitch = phone * (PHONE_HEAD_DOWN + drift)
      let headYaw = gaze * (1 - phone * 0.55)

      if (activity === Activity.Reacting) {
        headPitch += Math.sin((elapsed / DWELL_REACTING) * Math.PI * 2 * NOD_CYCLES) * NOD_ANGLE
      } else if (activity === Activity.Dismissing) {
        headYaw += Math.sin((elapsed / DWELL_DISMISSING) * Math.PI * 2 * SHAKE_CYCLES) * SHAKE_ANGLE
      }

      // Head local axes are the model's: +X pitches the chin down, +Y turns it.
      turn(posedHead, headPitch, headYaw, 0)
      turn(posedNeck, phone * PHONE_NECK_DOWN, headYaw * 0.3, 0)

      if (!posedArms) return

      // Local +Z bends the elbow; the right arm mirrors, so its sign flips.
      // Local +X swings the upper arm, the same way on both sides, and local
      // +Z brings it across the chest, which mirrors.
      //
      // These are written every frame even when the phone is down, so that
      // putting it away returns the arms to the clip instead of stranding them
      // at the last pose.
      const bend = phone * (PHONE_FOREARM + drift)
      const lift = phone * PHONE_BICEP_FORWARD
      const across = phone * PHONE_BICEP_IN
      turn(posedArms.bicepL, lift, 0, -across)
      turn(posedArms.bicepR, lift, 0, across)
      turn(posedArms.forearmL, 0, 0, bend)
      turn(posedArms.forearmR, 0, 0, -bend)
    },
  }
}

/**
 * Beat lengths the gestures are timed against.
 *
 * Kept here rather than imported so the overlay stays a pure function of the
 * arguments it is handed, and a change to the simulation's dwell table cannot
 * silently desynchronise a nod. They are only used to spread a fixed number of
 * cycles across a beat.
 */
const DWELL_REACTING = 1.6
const DWELL_DISMISSING = 0.9
