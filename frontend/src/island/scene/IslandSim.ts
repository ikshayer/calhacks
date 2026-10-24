import type { AudienceMember, ReactionKind, RoundEvent } from '@/data/types'
import { createRng, type Rng } from '@/lib/rng'
import { TILE, tileToWorld, type Island } from './island'

/**
 * What a villager is doing. Drives both the animation clip and the floating
 * emote, so the town reads as a direct view of the cascade data.
 */
export const Activity = {
  /** Walking to the next junction. Nothing has reached them yet. */
  Walking: 0,
  /** Standing still — outside a shop, on the plaza, waiting to cross. */
  Resting: 1,
  /** Exposed: stopped, phone up, has not decided yet. */
  OnPhone: 2,
  /** Reacted — liked, commented, or watched through. */
  Reacting: 3,
  /** Shared it on. The brief moment the trails fly out. */
  Sharing: 4,
  /** Saw it and moved on. */
  Dismissing: 5,
} as const

export type Activity = (typeof Activity)[keyof typeof Activity]

/** How long each beat lasts, in seconds. */
const DWELL = {
  onPhone: 1.1,
  reacting: 1.6,
  sharing: 1.3,
  dismissing: 0.9,
  restMin: 0.7,
  restMax: 3.4,
}

const WALK_SPEED = { min: 1.3, max: 2.1 }
/** Radians per second a villager turns to face its heading. */
const TURN_RATE = 7
/** Chance of stopping at a junction rather than walking straight on. */
const PAUSE_CHANCE = 0.45
/** Chance of leaving the home quarter for somewhere else in town. */
const ROAM_CHANCE = 0.12

/** A share in flight, from one villager to another. Purely visual. */
export interface Trail {
  from: number
  to: number
  /** 0 at the source, 1 on arrival. */
  progress: number
}

export interface VillagerBadge {
  kinds: ReactionKind[]
}

/**
 * The town's movement and reaction simulation.
 *
 * Deliberately free of React and three.js: it owns flat typed arrays and is
 * stepped once per frame by whoever renders it. Keeping it out of React is what
 * lets ~120 characters animate without triggering a single re-render.
 *
 * Villagers walk the street graph rather than drifting across open ground, each
 * holding a lane offset so a street carries a spread of people instead of a
 * single-file line.
 *
 * Villager indices are dense (0..count-1) and are NOT audience member ids —
 * only a sampled cohort of the audience gets a body. Use `indexOfMember` to
 * cross the boundary.
 */
export class IslandSim {
  readonly count: number
  /** villager index -> audience member id */
  readonly memberIds: Int32Array
  readonly groupIds: string[]

  readonly x: Float32Array
  readonly z: Float32Array
  readonly angle: Float32Array
  readonly activity: Uint8Array

  /** Which reaction icons to float above a villager, while it is reacting. */
  readonly badges = new Map<number, VillagerBadge>()
  /** Shares currently in flight. Read by the trail renderer, pruned here. */
  readonly trails: Trail[] = []
  /** World position of each walkable tile, flattened as x,z pairs. */
  private readonly nodeX: Float32Array
  private readonly nodeZ: Float32Array
  private readonly links: number[][]
  readonly nodeCount: number

  /** Node the villager is walking away from, and the one it is heading to. */
  private readonly fromNode: Int32Array
  private readonly toNode: Int32Array
  /** Distance along the current segment, 0..1. */
  private readonly progress: Float32Array
  /** Signed offset from the street centreline, so villagers keep to a lane. */
  private readonly lane: Float32Array
  private readonly speed: Float32Array
  private readonly timer: Float32Array

  private readonly indexByMember = new Map<number, number>()
  private readonly homeNodes: number[][]
  private readonly rng: Rng
  /** Exposed at least once, so a second exposure cannot restage the reaction. */
  private readonly hasBeenExposed: Uint8Array

  constructor(
    members: AudienceMember[],
    island: Island,
    homesByGroup: Map<string, number[]>,
    seed: number,
  ) {
    const cohort = members.filter((m) => m.onIsland)
    this.count = cohort.length
    this.rng = createRng(seed)

    // Walkable tiles become graph nodes; residents move between tile centres.
    this.nodeCount = island.walkable.length
    this.nodeX = new Float32Array(this.nodeCount)
    this.nodeZ = new Float32Array(this.nodeCount)
    island.walkable.forEach((tileIndex, slot) => {
      const { x, z } = tileToWorld(tileIndex)
      this.nodeX[slot] = x
      this.nodeZ[slot] = z
    })
    this.links = island.links

    this.memberIds = new Int32Array(this.count)
    this.groupIds = new Array<string>(this.count)
    this.x = new Float32Array(this.count)
    this.z = new Float32Array(this.count)
    this.angle = new Float32Array(this.count)
    this.activity = new Uint8Array(this.count)
    this.fromNode = new Int32Array(this.count)
    this.toNode = new Int32Array(this.count)
    this.progress = new Float32Array(this.count)
    this.lane = new Float32Array(this.count)
    this.speed = new Float32Array(this.count)
    this.timer = new Float32Array(this.count)
    this.hasBeenExposed = new Uint8Array(this.count)
    this.homeNodes = new Array<number[]>(this.count)

    const allNodes = Array.from({ length: this.nodeCount }, (_, index) => index)

    cohort.forEach((member, index) => {
      this.memberIds[index] = member.id
      this.groupIds[index] = member.groupId
      this.indexByMember.set(member.id, index)

      const home = homesByGroup.get(member.groupId)
      this.homeNodes[index] = home && home.length > 0 ? home : allNodes

      const start = this.rng.pick(this.homeNodes[index] as number[])
      this.fromNode[index] = start
      this.toNode[index] = this.chooseNext(index, start)
      this.progress[index] = this.rng.next()
      this.lane[index] = this.rng.range(-1, 1) * (TILE * 0.26)
      this.speed[index] = this.rng.range(WALK_SPEED.min, WALK_SPEED.max)
      this.activity[index] = Activity.Walking
      this.writePosition(index)
      this.angle[index] = this.headingOf(index)
    })
  }

  indexOfMember(memberId: number): number | undefined {
    return this.indexByMember.get(memberId)
  }

  memberOfIndex(index: number): number {
    return this.memberIds[index] as number
  }

  groupOfIndex(index: number): string {
    return this.groupIds[index] ?? ''
  }

  /** Back to everyone walking, nothing exposed. Used when scrubbing backwards. */
  reset(): void {
    this.badges.clear()
    this.trails.length = 0
    this.hasBeenExposed.fill(0)
    for (let i = 0; i < this.count; i++) {
      this.activity[i] = Activity.Walking
      this.timer[i] = 0
    }
  }

  /**
   * Stage one cascade round.
   *
   * A villager exposed a second time by another neighbour is deliberately left
   * alone: the cascade counts each member once, so the town must not show the
   * reaction twice either.
   */
  applyRound(round: RoundEvent): void {
    for (const memberId of round.exposed) {
      const index = this.indexByMember.get(memberId)
      if (index === undefined || this.hasBeenExposed[index]) continue
      this.hasBeenExposed[index] = 1
      this.activity[index] = Activity.OnPhone
      this.timer[index] = DWELL.onPhone
    }

    const sharers = new Set(
      round.shares.flatMap((share) => {
        const from = this.indexByMember.get(share.from)
        return from === undefined ? [] : [from]
      }),
    )

    for (const act of round.acted) {
      const index = this.indexByMember.get(act.memberId)
      if (index === undefined) continue
      this.badges.set(index, { kinds: act.kinds })
      const sharing = sharers.has(index)
      this.activity[index] = sharing ? Activity.Sharing : Activity.Reacting
      // Reaction beats start after the phone comes up, so the order reads correctly.
      this.timer[index] = DWELL.onPhone + (sharing ? DWELL.sharing : DWELL.reacting)
    }

    for (const memberId of round.ignored) {
      const index = this.indexByMember.get(memberId)
      if (index === undefined) continue
      this.activity[index] = Activity.Dismissing
      this.timer[index] = DWELL.onPhone + DWELL.dismissing
    }

    for (const share of round.shares) {
      const from = this.indexByMember.get(share.from)
      if (from === undefined) continue
      for (const target of share.to) {
        const to = this.indexByMember.get(target)
        // Only draw a hop when both ends have a body in town.
        if (to !== undefined) this.trails.push({ from, to, progress: 0 })
      }
    }
  }

  /** Advance by `dt` seconds. */
  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const activity = this.activity[i] as Activity

      if (activity === Activity.Walking) {
        this.stepWalk(i, dt)
        continue
      }

      // Everything else is a villager standing still for a beat.
      this.timer[i] = (this.timer[i] as number) - dt
      if ((this.timer[i] as number) > 0) continue

      if (activity !== Activity.Resting) this.badges.delete(i)
      this.activity[i] = Activity.Walking
    }

    // Trails take DWELL.sharing to arrive, matching the sharer's animation.
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i] as Trail
      trail.progress += dt / DWELL.sharing
      if (trail.progress >= 1) this.trails.splice(i, 1)
    }
  }

  private stepWalk(index: number, dt: number): void {
    const from = this.fromNode[index] as number
    const to = this.toNode[index] as number
    const length =
      Math.hypot(
        (this.nodeX[to] as number) - (this.nodeX[from] as number),
        (this.nodeZ[to] as number) - (this.nodeZ[from] as number),
      ) || 1
    this.progress[index] = (this.progress[index] as number) + ((this.speed[index] as number) * dt) / length

    if ((this.progress[index] as number) >= 1) {
      // Arrived at a junction: either stop for a moment or carry on.
      const arrived = this.toNode[index] as number
      this.fromNode[index] = arrived
      this.toNode[index] = this.chooseNext(index, arrived)
      this.progress[index] = 0
      if (this.rng.chance(PAUSE_CHANCE)) {
        this.activity[index] = Activity.Resting
        this.timer[index] = this.rng.range(DWELL.restMin, DWELL.restMax)
      }
    }

    this.writePosition(index)
    this.faceTowards(index, this.headingOf(index), dt)
  }

  /** Places the villager along its current street segment, offset into its lane. */
  private writePosition(index: number): void {
    const from = this.fromNode[index] as number
    const to = this.toNode[index] as number
    const fx = this.nodeX[from] as number
    const fz = this.nodeZ[from] as number
    const dx = (this.nodeX[to] as number) - fx
    const dz = (this.nodeZ[to] as number) - fz
    const length = Math.hypot(dx, dz) || 1
    const t = this.progress[index] as number
    const lane = this.lane[index] as number

    // Perpendicular to the direction of travel, so lanes sit across the street.
    this.x[index] = fx + dx * t + (-dz / length) * lane
    this.z[index] = fz + dz * t + (dx / length) * lane
  }

  private headingOf(index: number): number {
    const from = this.fromNode[index] as number
    const to = this.toNode[index] as number
    return Math.atan2(
      (this.nodeX[to] as number) - (this.nodeX[from] as number),
      (this.nodeZ[to] as number) - (this.nodeZ[from] as number),
    )
  }

  /**
   * Picks the next junction.
   *
   * Villagers prefer links that keep them inside their group's quarter, which
   * is what makes an intra-group cascade visibly local, but will wander off
   * often enough that the town does not look partitioned.
   */
  private chooseNext(index: number, at: number): number {
    const links = this.links[at]
    if (!links || links.length === 0) return at

    if (!this.rng.chance(ROAM_CHANCE)) {
      const home = this.homeNodes[index]
      if (home) {
        const homeward = links.filter((link) => home.includes(link))
        if (homeward.length > 0) return this.rng.pick(homeward)
      }
    }
    return this.rng.pick(links)
  }

  /** Rotates smoothly towards `target`, taking the short way round. */
  private faceTowards(index: number, target: number, dt: number): void {
    const current = this.angle[index] as number
    let delta = target - current
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const maxStep = TURN_RATE * dt
    this.angle[index] = current + Math.max(-maxStep, Math.min(maxStep, delta))
  }
}

/**
 * The animation clip for an activity.
 *
 * `holding-both` is the Kenney clip where the character holds something in both
 * hands at chest height — read as looking at a phone, which is exactly what an
 * exposed villager is doing.
 */
export function clipForActivity(activity: Activity): string {
  switch (activity) {
    case Activity.Walking:
      return 'walk'
    case Activity.OnPhone:
    case Activity.Reacting:
    case Activity.Sharing:
      return 'holding-both'
    case Activity.Dismissing:
      return 'emote-no'
    case Activity.Resting:
    default:
      return 'idle'
  }
}
