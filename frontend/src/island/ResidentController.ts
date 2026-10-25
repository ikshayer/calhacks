import * as THREE from 'three'
import type { ResidentPose } from './residentPose.ts'

export interface AnimationSample { dt: number; activity: number; speed: number; gaze: number }

/**
 * The clips an activity plays: one to stand or walk on, and optionally a
 * gesture played through once on entry before settling onto the base.
 */
export interface ActivityClips { base: string; gesture?: string }

/**
 * Activity numbers mirror IslandSim's, which is why they appear here as plain
 * numbers: this controller is deliberately constructible without the
 * simulation, so it can be exercised on its own.
 */
const DEFAULT_CLIPS: Record<number, ActivityClips> = {
  0: { base: 'test_walk' },
  4: { base: 'test_Idle', gesture: 'test_wave' },
  6: { base: 'test_look_around' },
}
const STANDING: ActivityClips = { base: 'test_Idle' }

export const defaultActivityClips = (activity: number): ActivityClips =>
  DEFAULT_CLIPS[activity] ?? STANDING

export interface ResidentControllerOptions {
  /** Which clips each activity plays. Defaults to the table above. */
  clips?: (activity: number) => ActivityClips
  /** Gestures layered over the clips — the phone, nods, gaze. Optional. */
  pose?: ResidentPose | null
}
/** Activity numbers mirror IslandSim; this controller has no simulation/data dependency. */
export class ResidentController {
  readonly mixer: THREE.AnimationMixer
  readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly root: THREE.Object3D
  private readonly phase: number
  private readonly baseSpeed: number
  private active = new Set<THREE.AnimationAction>()
  private started = new Set<THREE.AnimationAction>()
  private resumeTimes = new Map<THREE.AnimationAction, number>()
  private selected: THREE.AnimationAction | null = null
  private transition: { elapsed: number; from: Map<THREE.AnimationAction, number> } | null = null
  private samples: AnimationSample[] = []
  private activity = -1
  private gestureElapsed = 0
  /** Time spent in the current activity, which the gestures are timed against. */
  private activityElapsed = 0
  private gaze = 0
  private pendingActivity = -1
  private readonly plan: (activity: number) => ActivityClips
  private readonly pose: ResidentPose | null
  urgent = true

  constructor(
    root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    baseSpeed: number,
    phase: number,
    options: ResidentControllerOptions = {},
  ) {
    if (!(baseSpeed > 0) || !Number.isFinite(baseSpeed)) throw new Error('Resident stride speed must be positive')
    for (const required of ['test_Idle', 'test_walk', 'test_wave']) {
      if (!clips.some((clip) => clip.name === required)) throw new Error(`Resident clip missing: ${required}`)
    }
    this.root = root
    this.phase = phase
    this.baseSpeed = baseSpeed
    this.plan = options.clips ?? defaultActivityClips
    this.pose = options.pose ?? null
    this.mixer = new THREE.AnimationMixer(root)
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip))
    this.select('test_Idle', true)
  }

  /** Queue historical state with its elapsed time, so skipped frames cannot replay new state over old debt. */
  sample(dt: number, activity: number, speed: number, gaze = 0): void {
    if (dt <= 0) return
    if (activity !== this.pendingActivity) this.urgent = true
    this.pendingActivity = activity
    // Gaze is a pose, not a clip: the latest value is what gets drawn, so it
    // does not split a sample that could otherwise be merged.
    this.gaze = gaze
    const previous = this.samples.at(-1)
    if (previous?.activity === activity && previous.speed === speed) previous.dt += dt
    else this.samples.push({ dt, activity, speed, gaze })
  }

  advance(): void {
    let covered = 0
    for (const sample of this.samples) {
      const plan = this.plan(sample.activity)
      if (sample.activity !== this.activity) {
        this.activity = sample.activity
        this.gestureElapsed = 0
        this.activityElapsed = 0
        this.select(plan.gesture ?? plan.base, false, plan.gesture !== undefined)
      }
      let remaining = sample.dt
      // A gesture plays through once on entry, then settles onto the base clip.
      const gesture = plan.gesture ? this.actions.get(plan.gesture) : undefined
      if (gesture && this.gestureElapsed < gesture.getClip().duration) {
        const duration = gesture.getClip().duration
        const gestureTime = Math.min(remaining, duration - this.gestureElapsed)
        this.step(gestureTime, sample.speed)
        this.gestureElapsed += gestureTime
        remaining -= gestureTime
        if (this.gestureElapsed >= duration) this.select(plan.base)
      }
      if (remaining > 0) this.step(remaining, sample.speed)
      covered += sample.dt
      this.activityElapsed += sample.dt
    }
    this.samples.length = 0
    this.urgent = !!this.transition
    // After the mixer, which overwrites bone orientations on every update.
    if (covered > 0) this.pose?.apply(covered, this.activity, this.activityElapsed, this.gaze)
  }

  /** `once` plays the clip through a single time and holds its last pose. */
  private select(requested: string, immediate = false, once = false): void {
    // An export without one of the optional clips falls back to standing
    // rather than failing inside a frame.
    const name = this.actions.has(requested) ? requested : 'test_Idle'
    const next = this.actions.get(name)!
    if (next === this.selected) return
    if (once) {
      const weight = this.active.has(next) ? next.getEffectiveWeight() : 0
      next.reset().setEffectiveWeight(weight).play()
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
      this.active.add(next)
    } else if (!this.active.has(next)) {
      const time = this.started.has(next) ? this.resumeTimes.get(next) ?? next.time : this.phase * next.getClip().duration
      next.reset().setEffectiveWeight(0).play()
      next.time = time
      this.started.add(next)
      this.active.add(next)
    }
    const from = new Map([...this.active].map((action) => [action, action.getEffectiveWeight()]))
    this.selected = next
    if (immediate) {
      for (const action of this.active) if (action !== next) action.stop()
      this.active = new Set([next])
      next.setEffectiveWeight(1)
      this.transition = null
      this.mixer.update(0)
    } else this.transition = { elapsed: 0, from }
  }

  private step(dt: number, speed: number): void {
    // Split exactly at fade boundaries, so coarse budget updates retain the
    // same clip clocks and complete pose as a resident evaluated every frame.
    const slice = this.transition ? Math.min(dt, Math.max(0, 0.18 - this.transition.elapsed)) : dt
    let finished = false
    if (this.transition) {
      this.transition.elapsed += slice
      const progress = Math.min(1, this.transition.elapsed / 0.18)
      for (const action of this.active) action.setEffectiveWeight(THREE.MathUtils.lerp(
        this.transition.from.get(action) ?? 0, action === this.selected ? 1 : 0, progress))
      finished = progress === 1
    }
    for (const action of this.active) {
      action.setEffectiveTimeScale(action.getClip().name === 'test_walk' ? speed / this.baseSpeed : 1)
    }
    this.mixer.update(slice)
    if (finished) {
      for (const action of this.active) if (action !== this.selected) {
        this.resumeTimes.set(action, action.time)
        action.stop()
      }
      this.active = new Set([this.selected!])
      this.transition = null
    }
    if (dt - slice > 1e-12) this.step(dt - slice, speed)
  }

  snapshot() {
    return { clip: this.selected?.getClip().name, queued: this.samples.length,
      totalWeight: [...this.active].reduce((total, action) => total + action.getEffectiveWeight(), 0),
      walkTime: this.clipTime('test_walk'), idleTime: this.clipTime('test_Idle') }
  }

  private clipTime(name: string): number {
    const action = this.actions.get(name)!
    return this.active.has(action) ? action.time : this.resumeTimes.get(action) ?? action.time
  }

  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); this.samples.length = 0 }
}
