import * as THREE from 'three'

export interface AnimationSample { dt: number; activity: number; speed: number }
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
  private pendingActivity = -1
  urgent = true

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], baseSpeed: number, phase: number) {
    if (!(baseSpeed > 0) || !Number.isFinite(baseSpeed)) throw new Error('Resident stride speed must be positive')
    for (const required of ['test_Idle', 'test_walk', 'test_wave']) {
      if (!clips.some((clip) => clip.name === required)) throw new Error(`Resident clip missing: ${required}`)
    }
    this.root = root
    this.phase = phase
    this.baseSpeed = baseSpeed
    this.mixer = new THREE.AnimationMixer(root)
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip))
    this.select('test_Idle', true)
  }

  /** Queue historical state with its elapsed time, so skipped frames cannot replay new state over old debt. */
  sample(dt: number, activity: number, speed: number): void {
    if (dt <= 0) return
    if (activity !== this.pendingActivity) this.urgent = true
    this.pendingActivity = activity
    const previous = this.samples.at(-1)
    if (previous?.activity === activity && previous.speed === speed) previous.dt += dt
    else this.samples.push({ dt, activity, speed })
  }

  advance(): void {
    for (const sample of this.samples) {
      if (sample.activity !== this.activity) {
        this.activity = sample.activity
        this.gestureElapsed = 0
        this.select(this.activity === 0 ? 'test_walk' : this.activity === 4 ? 'test_wave' : 'test_Idle')
      }
      let remaining = sample.dt
      // Sharing waves once on entry. Watches, phone and dismissal retain neutral Idle.
      const waveDuration = this.actions.get('test_wave')!.getClip().duration
      if (this.activity === 4 && this.gestureElapsed < waveDuration) {
        const gestureTime = Math.min(remaining, waveDuration - this.gestureElapsed)
        this.step(gestureTime, sample.speed)
        this.gestureElapsed += gestureTime
        remaining -= gestureTime
        if (this.gestureElapsed >= waveDuration) this.select('test_Idle')
      }
      if (remaining > 0) this.step(remaining, sample.speed)
    }
    this.samples.length = 0
    this.urgent = !!this.transition
  }

  private select(name: string, immediate = false): void {
    const next = this.actions.get(name)!
    if (next === this.selected) return
    if (name === 'test_wave') {
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
