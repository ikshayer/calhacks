import * as THREE from 'three'

export interface WalkMetadata {
  strideLength: number
  cycleSeconds: number
}

/** Independent clip playback and stride-synchronized travel in model units. */
export class ResidentPlayback {
  readonly mixer: THREE.AnimationMixer
  readonly actions: Map<string, THREE.AnimationAction>
  private active = new Set<THREE.AnimationAction>()
  private transition: { elapsed: number; from: Map<THREE.AnimationAction, number> } | null = null
  private selected: THREE.AnimationAction | null = null
  private readonly root: THREE.Object3D
  private readonly walk: WalkMetadata
  private readonly phase: number

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], walk: WalkMetadata, phase = 0) {
    const clip = clips.find((candidate) => candidate.name === 'test_walk')
    if (!clip || !(walk.strideLength > 0) || !(walk.cycleSeconds > 0) ||
      Math.abs(clip.duration - walk.cycleSeconds) > 1e-4) {
      throw new Error('Resident walk clip and stride metadata must agree')
    }
    this.root = root
    this.walk = walk
    this.phase = phase
    this.mixer = new THREE.AnimationMixer(root)
    this.actions = new Map(clips.map((item) => [item.name, this.mixer.clipAction(item)]))
  }

  select(name: string, immediate = false): void {
    const next = this.actions.get(name) ?? null
    if (next === this.selected) return
    if (!next) {
      this.mixer.stopAllAction()
      this.active.clear()
      this.transition = null
      this.selected = null
      return
    }
    if (!this.active.has(next)) {
      next.reset().setEffectiveWeight(0).play()
      next.time = this.phase % next.getClip().duration
      this.active.add(next)
    }
    const from = new Map([...this.active].map((action) => [action, action.getEffectiveWeight()]))
    const first = !this.selected || immediate
    this.selected = next
    if (first) {
      for (const action of this.active) if (action !== next) action.stop()
      this.active = new Set([next])
      next.setEffectiveWeight(1)
      this.transition = null
      this.mixer.update(0)
    } else this.transition = { elapsed: 0, from }
  }

  /** Fades use real time; clip cadence and travel use the same speed multiplier. */
  step(deltaSeconds: number, speed: number): number {
    if (deltaSeconds <= 0) return 0
    const walkAction = this.actions.get('test_walk')!
    const before = this.active.has(walkAction) ? walkAction.getEffectiveWeight() : 0
    if (this.transition) {
      this.transition.elapsed += deltaSeconds
      const progress = Math.min(1, this.transition.elapsed / 0.18)
      for (const action of this.active) {
        const weight = THREE.MathUtils.lerp(this.transition.from.get(action) ?? 0,
          action === this.selected ? 1 : 0, progress)
        action.setEffectiveWeight(weight)
      }
      if (progress === 1) {
        for (const action of this.active) if (action !== this.selected) action.stop()
        this.active = new Set(this.selected ? [this.selected] : [])
        this.transition = null
      }
    }
    for (const action of this.active) action.setEffectiveTimeScale(speed)
    this.mixer.update(deltaSeconds)
    const after = this.active.has(walkAction) ? walkAction.getEffectiveWeight() : 0
    return this.walk.strideLength / this.walk.cycleSeconds * deltaSeconds * speed * (before + after) / 2
  }

  snapshot() {
    return { clip: this.selected?.getClip().name ?? '', time: this.selected?.time ?? 0,
      walkWeight: this.active.has(this.actions.get('test_walk')!)
        ? this.actions.get('test_walk')!.getEffectiveWeight() : 0,
      totalWeight: [...this.active].reduce((sum, action) => sum + action.getEffectiveWeight(), 0) }
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.active.clear()
  }
}
