import * as THREE from 'three'
import type { VillagerRig } from './villagerModels'

/**
 * Distance bands, in world units, and how often a villager inside each one
 * gets its skeleton re-posed.
 *
 * A stride of 3 means the mixer runs every third frame with three frames' worth
 * of accumulated time, so the animation still plays at the right *speed* — it
 * just updates in coarser steps, which is invisible on a character a long way
 * from the camera.
 */
const BANDS = [
  { within: 20, stride: 1 },
  { within: 38, stride: 2 },
  { within: Infinity, stride: 3 },
] as const

/** Villagers the camera cannot see are posed rarely, just enough to stay in sync. */
const OFFSCREEN_STRIDE = 8

/**
 * Decides which villagers get their skeleton updated this frame.
 *
 * This is the whole reason ~120 animated characters are affordable. A three.js
 * scene with hundreds of skinned meshes is bottlenecked on the CPU — mixer
 * evaluation and bone matrix updates — long before it is bottlenecked on draw
 * calls, and plain InstancedMesh cannot help because it does not skin.
 *
 * So instead of making every character cheaper, we make most of them update
 * less often: full rate up close and in view, progressively coarser with
 * distance, and barely at all off-screen. Updates are staggered by villager
 * index so the skipped work spreads evenly across frames instead of landing as
 * a spike on every third one.
 */
export class AnimationBudget {
  private frame = 0
  private readonly frustum = new THREE.Frustum()
  private readonly projection = new THREE.Matrix4()
  private readonly probe = new THREE.Sphere(new THREE.Vector3(), 1.6)

  /** Villagers posed on the most recent frame. Surfaced for the perf overlay. */
  lastUpdated = 0

  step(
    rigs: readonly VillagerRig[],
    camera: THREE.Camera,
    dt: number,
    /** Positions, read straight from the simulation's arrays. */
    x: Float32Array,
    z: Float32Array,
  ): void {
    this.frame++
    this.lastUpdated = 0

    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projection)

    const camX = camera.position.x
    const camZ = camera.position.z
    const camY = camera.position.y

    for (let i = 0; i < rigs.length; i++) {
      const rig = rigs[i] as VillagerRig
      rig.owed += dt

      const px = x[i] as number
      const pz = z[i] as number
      this.probe.center.set(px, 0.8, pz)

      let stride: number
      if (!this.frustum.intersectsSphere(this.probe)) {
        stride = OFFSCREEN_STRIDE
      } else {
        const distance = Math.sqrt(
          (px - camX) * (px - camX) + (pz - camZ) * (pz - camZ) + camY * camY,
        )
        stride = (BANDS.find((band) => distance <= band.within) ?? BANDS[2]).stride
      }

      // Stagger by index so a stride of 3 spreads over three frames rather than
      // posing every villager on the same one.
      if ((this.frame + i) % stride !== 0) continue

      rig.mixer.update(rig.owed)
      rig.owed = 0
      this.lastUpdated++
    }
  }
}
