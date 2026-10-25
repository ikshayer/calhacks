import type { AudienceMember, ReactionKind, RoundEvent } from '@/data/types'
import { createRng, type Rng } from '../../lib/rng.ts'
import { TILE, WALK_CLEARANCE, tileToWorld, type Island, type Obstruction } from './island.ts'
import { continuousGroundSpan, groundHeight, MAX_WALK_GRADE } from './ground.ts'
import {
  blockedSlots,
  buildRoutes,
  DESTINATION_WEIGHTS,
  townDestinations,
  type DestinationKind,
  type Destinations,
  type TownRoutes,
} from './townRoutes.ts'

/**
 * What a villager is doing. Drives both the animation clip and the floating
 * emote, so the town reads as a direct view of the cascade data.
 *
 * The numbering is a contract. `ResidentController` and the renderers key off
 * these values, so new states are appended rather than inserted, and anything
 * asking "is this villager busy with the video" calls `isCascadeActivity`
 * rather than comparing against `OnPhone`.
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
  /** Arrived somewhere and taking it in. Ambient only, never cascade. */
  LookingAround: 6,
} as const

export type Activity = (typeof Activity)[keyof typeof Activity]

/**
 * Whether this activity is the villager responding to the video.
 *
 * Everything that reads the town as data — the badges, the chatter — has to
 * tell "busy with the campaign" from "going about their day". An ordering
 * comparison got that wrong the moment an ambient state was appended after the
 * cascade ones, so the question is asked by name.
 */
export function isCascadeActivity(activity: Activity): boolean {
  return activity >= Activity.OnPhone && activity <= Activity.Dismissing
}

/** How long each beat lasts, in seconds. */
const DWELL = {
  onPhone: 1.1,
  reacting: 1.6,
  sharing: 1.3,
  dismissing: 0.9,
  /** Time spent at a destination before the next one is chosen. */
  arriveMin: 3,
  arriveMax: 6,
}

const WALK_SPEED = { min: 1.3, max: 2.1 }
/** Radians per second a villager turns to face its heading. */
const TURN_RATE = 2
/**
 * Floor on the speed multiplier while turning.
 *
 * Speed falls off with how far the nose is from where the villager wants to
 * go, which is what makes a corner read as a turn rather than a slide: they
 * slow, come round, and pick the pace back up. Without a floor a villager
 * needing to turn more than ninety degrees would stop dead.
 */
const TURN_FLOOR = 0.2
const ACCEL = 1.4
const BRAKE = 2.2
/** Below this, a villager counts as standing rather than walking. */
const STOPPED_SPEED = 0.06

/**
 * How far off the street centreline a villager walks.
 *
 * The offset is applied along the left-hand normal of the direction of travel,
 * which flips when the direction does — so a *positive* lane automatically
 * puts opposing traffic on opposite sides of the street. A signed lane throws
 * that away and lets two villagers share a line head-on.
 *
 * The ceiling is the one `WALK_CLEARANCE` was sized from, so a laned villager
 * still clears the props and curbs along the kerb.
 */
const LANE_MAX = TILE * 0.26
/**
 * A resident is 1.47 units across the shoulders and a street is 3.4 wide, so
 * two of them abreast is all that fits. Lanes therefore sit in the outer part
 * of each half rather than spread across it: that keeps the two directions
 * clear of each other, and villagers travelling the same way queue up behind
 * one another instead of trying to walk through each other side by side.
 */
const LANE_RANGE = { min: 0.7, max: 1 }

/** How close counts as reaching a junction. */
const ARRIVE_RADIUS = 0.35
/** Chance of walking straight through a destination instead of stopping. */
const PASS_THROUGH_CHANCE = 0.2
/** Trips shorter than this are not worth watching, so another goal is drawn. */
const MIN_TRIP_HOPS = 3
/** Chance that the next destination is inside the villager's own quarter. */
const HOME_TRIP_CHANCE = 0.7
/** Share of dwells spent looking about rather than simply standing. */
const LOOK_AROUND_CHANCE = 0.65

/** Distance ahead the ground is sampled, for grade-corrected speed and lean. */
const GRADE_PROBE = 0.32
/** Seconds for the body's lean to catch up with the slope under it. */
const PITCH_TAU = 0.17

/** Shoulder to shoulder. Measured from the exports, not guessed at. */
const BODY_WIDTH = 1.47
/** Nobody closer than this, if a step aside can help it. */
const SEPARATION_RADIUS = BODY_WIDTH * 0.92
/**
 * How far a crowd may steer somebody off their line, as a fraction of the
 * direction of travel. Under one by construction, so the route always wins and
 * avoidance can never become the heading.
 */
const AVOID_BIAS = 0.7
/**
 * Fastest the body is moved directly apart from a neighbour, in units/second.
 *
 * Steering alone cannot keep bodies from overlapping: a villager meeting
 * someone head-on, or crossing them at a junction, cannot turn out of the way
 * inside `TURN_RATE`. So contact is also resolved positionally. It is capped
 * low enough to read as stepping aside rather than as being shoved, and
 * `confine` keeps the correction from ever pushing anyone off the street.
 */
const SEPARATION_SPEED = 0.4
/** Someone this far ahead in the same lane is followed, not walked through. */
const FOLLOW_RADIUS = 3
const FOLLOW_LANE_WIDTH = BODY_WIDTH * 0.6
/**
 * How long a villager held at a standstill keeps trying before it gives up and
 * waits.
 *
 * A street is two bodies wide, so people going the same way have to queue, and
 * the one behind genuinely does come to a halt. Left as "walking" at nil speed
 * its walk cycle would freeze mid-stride, so it is moved onto a standing beat
 * and reads as somebody waiting for the person in front.
 */
const BLOCKED_DELAY = 0.4
const BLOCKED_WAIT = { min: 0.6, max: 1.3 }
/**
 * How far away a passer-by is worth turning your head for.
 *
 * Kept short on purpose. On a street this busy a wider reach nearly always
 * finds somebody, so every resident walks around with its head turned and the
 * glance stops reading as a glance.
 */
const GAZE_RADIUS = 2.2
/** Past this the head would be straining; a real person turns their body. */
const GAZE_LIMIT = 0.7
const GAZE_TAU = 0.22

/** Slack kept inside the walking envelope, to absorb float rounding. */
const CONFINE_MARGIN = 0.002

/**
 * How far the neighbour scan looks, which is the widest any single rule needs.
 *
 * Each rule then applies its own reach inside that. Deriving the scan from one
 * particular rule's radius means tuning that rule silently narrows the others:
 * shortening the gaze once cut the follow rule's reach from 3 to 2.2 and would
 * have stopped villagers queueing behind each other.
 */
const NEIGHBOUR_RADIUS = Math.max(GAZE_RADIUS, FOLLOW_RADIUS, SEPARATION_RADIUS)

/** Side of one spatial-hash cell. At or above the neighbour scan. */
const HASH_CELL = NEIGHBOUR_RADIUS
const HASH_SIDE = 64
/** Sentinel in `pending`: this villager has no staged follow-up beat. */
const NO_PENDING = 255

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
 * Villagers are given somewhere to be. Each holds a destination — a front
 * door, a junction, the plaza, the end of a pier — and walks the shortest
 * route to it, which is what keeps a street flowing rather than filling with
 * people reversing on the spot. Position is integrated from a heading instead
 * of interpolated along the tile graph, so rounding a corner is continuous:
 * the earlier model snapped the lane offset onto the new axis at every
 * junction and jumped the body sideways by most of a body width.
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
  readonly y: Float32Array
  readonly z: Float32Array
  readonly angle: Float32Array
  /** Body lean, radians, following the grade under the feet. */
  readonly pitch: Float32Array
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

  private readonly island: Island
  private readonly obstructions: readonly Obstruction[]
  private readonly routes: TownRoutes
  private readonly destinations: Destinations
  private readonly destinationKinds: DestinationKind[]

  /** The junction the villager is at, the one it is walking to, and why. */
  private readonly node: Int32Array
  private readonly nextNode: Int32Array
  private readonly goal: Int32Array
  /** Whether this leg ends in a stop, so the brake can start in time. */
  private readonly willStop: Uint8Array
  /** Where on the next junction it is aiming, lane offset included. */
  private readonly waypointX: Float32Array
  private readonly waypointZ: Float32Array

  /** Offset from the street centreline, positive, so lanes split by direction. */
  private readonly lane: Float32Array
  /** Speed this villager walks at when nothing is in the way. */
  private readonly cruise: Float32Array
  private readonly velocity: Float32Array
  private readonly grade: Float32Array
  private readonly timer: Float32Array
  /** How long this villager has been held at a standstill while walking. */
  private readonly blocked: Float32Array

  /** Head yaw relative to the body, and where it is heading. */
  private readonly gaze: Float32Array
  private readonly gazeTarget: Float32Array
  /** Speed scaling from the neighbours, per frame. */
  private readonly crowd: Float32Array
  /** Direction, in world units, that contact with neighbours resolves along. */
  private readonly separateX: Float32Array
  private readonly separateZ: Float32Array
  private readonly cellHead: Int32Array
  private readonly cellNext: Int32Array

  private readonly indexByMember = new Map<number, number>()
  private readonly homeSets: Set<number>[]
  private readonly rng: Rng
  /** Exposed at least once, so a second exposure cannot restage the reaction. */
  private readonly hasBeenExposed: Uint8Array
  /** The beat each villager adopts when its phone beat ends. */
  private readonly pending: Uint8Array
  private readonly pendingBadges = new Map<number, VillagerBadge>()
  private readonly pendingTrails = new Map<number, Trail[]>()

  constructor(
    members: AudienceMember[],
    island: Island,
    homesByGroup: Map<string, number[]>,
    seed: number,
    walkSpeed = WALK_SPEED,
  ) {
    const cohort = members.filter((m) => m.onIsland)
    this.count = cohort.length
    this.island = island
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
    // Tiles with something solid standing on them are paved and joined to
    // their neighbours like any other, so navigation has to be told.
    const blocked = blockedSlots(island)
    this.obstructions = island.obstructions ?? []
    this.routes = buildRoutes(island, blocked)
    this.destinations = townDestinations(island, blocked)
    this.destinationKinds = (Object.keys(DESTINATION_WEIGHTS) as DestinationKind[])
      .filter((kind) => (this.destinations[kind]?.length ?? 0) > 0)
    if (this.destinationKinds.length === 0) throw new Error('The town has nowhere to walk to')

    this.memberIds = new Int32Array(this.count)
    this.groupIds = new Array<string>(this.count)
    this.x = new Float32Array(this.count)
    this.y = new Float32Array(this.count)
    this.z = new Float32Array(this.count)
    this.angle = new Float32Array(this.count)
    this.pitch = new Float32Array(this.count)
    this.activity = new Uint8Array(this.count)
    this.node = new Int32Array(this.count)
    this.nextNode = new Int32Array(this.count)
    this.goal = new Int32Array(this.count)
    this.willStop = new Uint8Array(this.count)
    this.waypointX = new Float32Array(this.count)
    this.waypointZ = new Float32Array(this.count)
    this.lane = new Float32Array(this.count)
    this.cruise = new Float32Array(this.count)
    this.velocity = new Float32Array(this.count)
    this.grade = new Float32Array(this.count)
    this.timer = new Float32Array(this.count)
    this.blocked = new Float32Array(this.count)
    this.gaze = new Float32Array(this.count)
    this.gazeTarget = new Float32Array(this.count)
    this.crowd = new Float32Array(this.count)
    this.separateX = new Float32Array(this.count)
    this.separateZ = new Float32Array(this.count)
    this.cellHead = new Int32Array(HASH_SIDE * HASH_SIDE)
    this.cellNext = new Int32Array(this.count)
    this.hasBeenExposed = new Uint8Array(this.count)
    this.pending = new Uint8Array(this.count).fill(NO_PENDING)
    this.homeSets = new Array<Set<number>>(this.count)

    const allNodes = Array.from({ length: this.nodeCount }, (_, index) => index)
    // One set per quarter, shared by every villager who lives in it.
    const setByQuarter = new Map<number[], Set<number>>()

    cohort.forEach((member, index) => {
      this.memberIds[index] = member.id
      this.groupIds[index] = member.groupId
      this.indexByMember.set(member.id, index)

      const home = homesByGroup.get(member.groupId)
      const quarter = home && home.length > 0 ? home : allNodes
      let set = setByQuarter.get(quarter)
      if (!set) {
        set = new Set(quarter)
        setByQuarter.set(quarter, set)
      }
      this.homeSets[index] = set

      // Never start anybody inside the fountain.
      const open = quarter.filter((slot) => !blocked.has(slot))
      const start = this.rng.pick(open.length > 0 ? open : quarter)
      this.node[index] = start
      this.goal[index] = -1
      this.lane[index] = this.rng.range(LANE_RANGE.min, LANE_RANGE.max) * LANE_MAX
      this.cruise[index] = this.rng.range(walkSpeed.min, walkSpeed.max)
      this.velocity[index] = this.cruise[index] as number
      this.activity[index] = Activity.Walking
      this.advanceStep(index)

      // Spread the cohort along their first leg rather than stacking everyone
      // on tile centres, which reads as a grid the moment the town loads.
      const along = this.rng.next()
      const originX = this.nodeX[start] as number
      const originZ = this.nodeZ[start] as number
      this.x[index] = originX + ((this.waypointX[index] as number) - originX) * along
      this.z[index] = originZ + ((this.waypointZ[index] as number) - originZ) * along
      this.angle[index] = Math.atan2(
        (this.waypointX[index] as number) - (this.x[index] as number),
        (this.waypointZ[index] as number) - (this.z[index] as number),
      )
      this.writeGround(index, 1)
      this.pitch[index] = -Math.atan(this.grade[index] as number)
    })
  }

  /** Live speed, so the walk cycle's cadence matches the ground actually covered. */
  locomotionSpeed(index: number): number { return this.velocity[index] ?? 0 }

  /** Head yaw relative to the body, radians. Read by the pose overlay. */
  gazeOf(index: number): number { return this.gaze[index] ?? 0 }

  /** Shared by terrain-following FX; bodies stay upright while their feet follow grade. */
  groundHeight(x: number, z: number): number { return groundHeight(this.island, x, z) }
  continuousGroundSpan(x: number, z: number, toX: number, toZ: number): boolean {
    return continuousGroundSpan(this.island, x, z, toX, toZ)
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
    this.pendingBadges.clear()
    this.pendingTrails.clear()
    this.trails.length = 0
    this.hasBeenExposed.fill(0)
    this.pending.fill(NO_PENDING)
    for (let i = 0; i < this.count; i++) {
      this.activity[i] = Activity.Walking
      this.timer[i] = 0
      // The leg underway is deliberately left alone. Re-routing a villager
      // standing midway between two junctions would move its confinement
      // rectangle out from under it, and the clamp would snap the body across
      // the street. A fresh destination is chosen when it next arrives.
      this.goal[i] = -1
      this.willStop[i] = 0
    }
  }

  /**
   * Stage one cascade round.
   *
   * The round is staged as two beats, not one: the phone comes up, and only
   * then does the villager react, share, or shrug it off. Collapsing those
   * into a single state — which is what this did before — meant the phone was
   * never seen on anyone who went on to react, so liking and ignoring looked
   * identical apart from the emoji.
   *
   * A villager exposed a second time by another neighbour is deliberately left
   * alone: the cascade counts each member once, so the town must not show the
   * reaction twice either.
   */
  applyRound(round: RoundEvent): void {
    const sharers = new Set<number>()
    for (const share of round.shares) {
      const from = this.indexByMember.get(share.from)
      if (from !== undefined) sharers.add(from)
    }

    const outcome = new Map<number, Activity>()
    const badges = new Map<number, VillagerBadge>()
    for (const act of round.acted) {
      const index = this.indexByMember.get(act.memberId)
      if (index === undefined) continue
      outcome.set(index, sharers.has(index) ? Activity.Sharing : Activity.Reacting)
      badges.set(index, { kinds: act.kinds })
    }
    for (const memberId of round.ignored) {
      const index = this.indexByMember.get(memberId)
      if (index === undefined) continue
      outcome.set(index, Activity.Dismissing)
    }

    const staged = new Set<number>()
    for (const memberId of round.exposed) {
      const index = this.indexByMember.get(memberId)
      if (index === undefined || this.hasBeenExposed[index]) continue
      this.hasBeenExposed[index] = 1
      this.stagePhone(index, outcome.get(index), badges.get(index))
      staged.add(index)
    }

    // A member who acted without being listed as newly exposed still has to be
    // shown, rather than silently dropping a reaction the data does contain.
    for (const [index, next] of outcome) {
      if (staged.has(index)) continue
      this.hasBeenExposed[index] = 1
      this.stagePhone(index, next, badges.get(index))
    }

    for (const share of round.shares) {
      const from = this.indexByMember.get(share.from)
      if (from === undefined) continue
      for (const target of share.to) {
        const to = this.indexByMember.get(target)
        // Only draw a hop when both ends have a body in town.
        if (to === undefined) continue
        // Held back until the sharing beat begins, so the dot leaves on the
        // wave rather than while the phone is still coming up.
        const held = this.pendingTrails.get(from) ?? []
        held.push({ from, to, progress: 0 })
        this.pendingTrails.set(from, held)
      }
    }
  }

  private stagePhone(index: number, next: Activity | undefined, badge: VillagerBadge | undefined): void {
    this.activity[index] = Activity.OnPhone
    this.timer[index] = DWELL.onPhone
    this.pending[index] = next ?? NO_PENDING
    if (badge) this.pendingBadges.set(index, badge)
  }

  /** Advance by `dt` seconds. */
  update(dt: number): void {
    this.observeNeighbours(dt)

    for (let i = 0; i < this.count; i++) {
      const activity = this.activity[i] as Activity

      if (activity === Activity.Walking) {
        this.stepWalk(i, dt)
        continue
      }

      // Standing beats come to a halt rather than stopping on a single frame.
      if ((this.velocity[i] as number) > 0) {
        this.velocity[i] = Math.max(0, (this.velocity[i] as number) - BRAKE * dt)
        this.travel(i, dt)
      }

      this.timer[i] = (this.timer[i] as number) - dt
      if ((this.timer[i] as number) > 0) continue

      if (activity === Activity.OnPhone && this.promote(i)) continue

      if (isCascadeActivity(activity)) this.badges.delete(i)
      this.activity[i] = Activity.Walking
      // A villager that stopped at a destination holds no goal and is standing
      // on the junction, so it is safe to route afresh. One that stopped mid
      // leg — exposed by the cascade, or waiting behind somebody — still holds
      // its goal, and asking again returns the same next junction, so its
      // confinement rectangle cannot move out from under it.
      this.advanceStep(i)
    }

    // Trails take DWELL.sharing to arrive, matching the sharer's animation.
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i] as Trail
      trail.progress += dt / DWELL.sharing
      if (trail.progress >= 1) this.trails.splice(i, 1)
    }
  }

  /** The phone beat ending hands over to the reaction it was staged with. */
  private promote(index: number): boolean {
    const next = this.pending[index] as number
    this.pending[index] = NO_PENDING
    if (next === NO_PENDING) return false

    this.activity[index] = next
    this.timer[index] =
      next === Activity.Sharing ? DWELL.sharing
        : next === Activity.Dismissing ? DWELL.dismissing
          : DWELL.reacting

    const badge = this.pendingBadges.get(index)
    if (badge) {
      this.badges.set(index, badge)
      this.pendingBadges.delete(index)
    }
    const held = this.pendingTrails.get(index)
    if (held) {
      for (const trail of held) this.trails.push(trail)
      this.pendingTrails.delete(index)
    }
    return true
  }

  // -------------------------------------------------------------------------
  // Walking
  // -------------------------------------------------------------------------

  private stepWalk(index: number, dt: number): void {
    const toX = (this.waypointX[index] as number) - (this.x[index] as number)
    const toZ = (this.waypointZ[index] as number) - (this.z[index] as number)
    const reach = Math.max(Math.hypot(toX, toZ), 1e-6)

    const facing = this.angle[index] as number
    // Avoidance steers along a world direction, never one derived from the
    // villager's own heading.
    //
    // Biasing along the body's own left-hand normal spins it: the target sits
    // ninety degrees off the nose, the body turns towards it, the normal turns
    // with the body, and the target stays ninety degrees ahead. A crowded
    // plaza had villagers rotating on the spot indefinitely.
    //
    // The bias is also kept under one so the direction of travel always
    // outweighs it, which caps how far off course a crowd can push anybody.
    const sepX = this.separateX[index] as number
    const sepZ = this.separateZ[index] as number
    const crowding = Math.hypot(sepX, sepZ)
    const bias = crowding > 1e-6 ? (Math.min(crowding, 1) / crowding) * AVOID_BIAS : 0
    const desired = Math.atan2(toX / reach + sepX * bias, toZ / reach + sepZ * bias)

    this.faceTowards(index, desired, dt)
    const error = wrapAngle(desired - (this.angle[index] as number))
    const turnFactor = Math.max(TURN_FLOOR, Math.cos(error))

    let target = (this.cruise[index] as number) * turnFactor * (this.crowd[index] as number)
    if (this.willStop[index] && reach <= this.brakingDistance(index) + ARRIVE_RADIUS) target = 0
    const rate = target < (this.velocity[index] as number) ? BRAKE : ACCEL
    this.velocity[index] = approach(this.velocity[index] as number, target, rate * dt)

    this.travel(index, dt, true)

    if ((this.velocity[index] as number) <= STOPPED_SPEED) {
      this.blocked[index] = (this.blocked[index] as number) + dt
      if ((this.blocked[index] as number) >= BLOCKED_DELAY && !this.willStop[index]) {
        this.blocked[index] = 0
        this.activity[index] = Activity.Resting
        this.timer[index] = this.rng.range(BLOCKED_WAIT.min, BLOCKED_WAIT.max)
        return
      }
    } else this.blocked[index] = 0

    // Arriving is gated on already standing in the tile being arrived at.
    //
    // That is what keeps `confine` from ever moving the body: taking the next
    // leg swings the confinement rectangle onto the following tile, so a
    // villager that counted as arrived while still short of the junction got
    // clamped across the street. Inside the tile, the new rectangle already
    // contains it and the clamp is a no-op.
    if (!this.insideTile(index, this.nextNode[index] as number)) return

    const halted = (this.velocity[index] as number) <= STOPPED_SPEED
    const past = toX * Math.sin(facing) + toZ * Math.cos(facing) < 0
    if (reach <= ARRIVE_RADIUS || past || (halted && reach <= ARRIVE_RADIUS * 2)) this.arrive(index)
  }

  /** Whether the villager stands within the square of a walking tile. */
  private insideTile(index: number, slot: number): boolean {
    const half = TILE / 2
    return Math.abs((this.x[index] as number) - (this.nodeX[slot] as number)) <= half &&
      Math.abs((this.z[index] as number) - (this.nodeZ[slot] as number)) <= half
  }

  /** Distance needed to come to rest from the current speed. */
  private brakingDistance(index: number): number {
    const speed = this.velocity[index] as number
    return (speed * speed) / (2 * BRAKE)
  }

  /**
   * Moves the body, keeps it on the street, and reads the slope under it.
   *
   * The step is shortened on a grade so the distance covered along the actual
   * surface is the speed the walk cycle is playing at — a flat step up a ramp
   * would cover more ground than the feet do, and slide.
   */
  private travel(index: number, dt: number, separate = false): void {
    const grade = this.grade[index] as number
    const step = ((this.velocity[index] as number) * dt) / Math.sqrt(1 + grade * grade)
    let moved = step > 0
    if (moved) {
      const facing = this.angle[index] as number
      this.x[index] = (this.x[index] as number) + Math.sin(facing) * step
      this.z[index] = (this.z[index] as number) + Math.cos(facing) * step
    }

    // Standing villagers are obstacles rather than participants: nudging one
    // that is mid-gesture would slide it across the ground with its feet
    // planted, which is the very thing live cadence exists to avoid.
    if (separate) {
      const sx = this.separateX[index] as number
      const sz = this.separateZ[index] as number
      const weight = Math.hypot(sx, sz)
      if (weight > 0) {
        const scale = (Math.min(weight, 1) / weight) * SEPARATION_SPEED * dt
        this.x[index] = (this.x[index] as number) + sx * scale
        this.z[index] = (this.z[index] as number) + sz * scale
        moved = true
      }
    }

    if (moved) this.confine(index)
    this.writeGround(index, dt)
  }

  /**
   * Holds the villager inside the two tiles of its current leg.
   *
   * Both are walkable by construction and they share an edge, so the box
   * around them is a rectangle. Clamping to it is what lets the steering and
   * the separation step be as strong as they need to be without anyone ever
   * walking off the street, over a retaining wall, or into the sea.
   *
   * It is drawn at `WALK_CLEARANCE` rather than the tile edge, which is the
   * same envelope landscaping keeps its planters and curbs out of — so a
   * villager shoved aside by a crowd still cannot be pushed into one.
   */
  private confine(index: number): void {
    const from = this.node[index] as number
    const to = this.nextNode[index] as number
    const ax = this.nodeX[from] as number, az = this.nodeZ[from] as number
    const bx = this.nodeX[to] as number, bz = this.nodeZ[to] as number
    // Held a hair inside the envelope: the clamp is computed in double
    // precision and stored as a float, and the rounding can land just outside
    // a boundary it was clamped exactly onto.
    const reach = WALK_CLEARANCE - CONFINE_MARGIN
    this.x[index] = clamp(this.x[index] as number, Math.min(ax, bx) - reach, Math.max(ax, bx) + reach)
    this.z[index] = clamp(this.z[index] as number, Math.min(az, bz) - reach, Math.max(az, bz) + reach)
    this.clearObstructions(index)
  }

  /**
   * Keeps bodies out of whatever is standing on the pavement.
   *
   * Dropping the tile underneath an obstruction out of the walking graph stops
   * anybody routing through it, but a villager passing on the next tile along
   * can still swing its lane into the stonework. Pushing the body back out to
   * the rim is what actually keeps it clear, and it is done after the corridor
   * clamp so the two cannot argue.
   */
  private clearObstructions(index: number): void {
    for (const stone of this.obstructions) {
      const dx = (this.x[index] as number) - stone.x
      const dz = (this.z[index] as number) - stone.z
      const clear = stone.radius + BODY_WIDTH / 2
      const span = Math.hypot(dx, dz)
      if (span >= clear) continue
      // Dead centre has no direction to leave by; the lane basis picks one.
      const scale = span > 1e-4 ? clear / span : 0
      this.x[index] = span > 1e-4 ? stone.x + dx * scale : stone.x + clear
      this.z[index] = span > 1e-4 ? stone.z + dz * scale : stone.z
    }
  }

  /**
   * Height under the feet, the grade ahead, and the lean that follows it.
   *
   * The grade is clamped to the limit the walking graph is validated against:
   * a steeper reading means the probe landed past a retaining wall rather than
   * on the ramp the villager is actually walking up.
   */
  private writeGround(index: number, dt: number): void {
    const x = this.x[index] as number
    const z = this.z[index] as number
    const here = this.groundHeight(x, z)
    this.y[index] = here

    const facing = this.angle[index] as number
    const ahead = this.groundHeight(
      x + Math.sin(facing) * GRADE_PROBE,
      z + Math.cos(facing) * GRADE_PROBE,
    )
    const grade = clamp((ahead - here) / GRADE_PROBE, -MAX_WALK_GRADE, MAX_WALK_GRADE)
    this.grade[index] = grade

    const lean = -Math.atan(grade)
    this.pitch[index] = (this.pitch[index] as number) +
      (lean - (this.pitch[index] as number)) * Math.min(1, dt / PITCH_TAU)
  }

  /** Reached the junction: stop and take it in, or carry on through. */
  private arrive(index: number): void {
    this.node[index] = this.nextNode[index] as number

    // Two villagers dwelling on the same spot would stand inside each other,
    // and neither is moving for the separation step to resolve it.
    if (this.willStop[index] && !this.standingNeighbour(index)) {
      this.willStop[index] = 0
      this.goal[index] = -1
      this.timer[index] = this.rng.range(DWELL.arriveMin, DWELL.arriveMax)
      this.activity[index] = this.rng.chance(LOOK_AROUND_CHANCE)
        ? Activity.LookingAround
        : Activity.Resting
      return
    }
    this.willStop[index] = 0
    this.advanceStep(index)
  }

  /** Whether somebody is already standing where this villager means to stop. */
  private standingNeighbour(index: number): boolean {
    const xi = this.x[index] as number
    const zi = this.z[index] as number
    const cx = cellAxis(xi), cz = cellAxis(zi)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const gx = cx + ox, gz = cz + oz
        if (gx < 0 || gz < 0 || gx >= HASH_SIDE || gz >= HASH_SIDE) continue
        for (let j = this.cellHead[gx * HASH_SIDE + gz] as number; j >= 0; j = this.cellNext[j] as number) {
          if (j === index || this.activity[j] === Activity.Walking) continue
          if (Math.hypot((this.x[j] as number) - xi, (this.z[j] as number) - zi) < SEPARATION_RADIUS) return true
        }
      }
    }
    return false
  }

  /**
   * Chooses the next junction on the way to the destination.
   *
   * There is no wandering left in this: the next step is the first hop of a
   * shortest route. That is what removed the dithering — on a street tile the
   * old uniform choice between two neighbours reversed the villager half the
   * time, and most of the town's tiles are street tiles.
   */
  private advanceStep(index: number): void {
    const at = this.node[index] as number
    if ((this.goal[index] as number) < 0 || this.goal[index] === at) {
      this.goal[index] = this.chooseGoal(index, at)
    }
    let next = this.routes.step(at, this.goal[index] as number)
    if (next < 0) {
      this.goal[index] = this.chooseGoal(index, at)
      next = this.routes.step(at, this.goal[index] as number)
    }
    // A goal that cannot be routed to must not strand the villager in place.
    if (next < 0) next = this.rng.pick(this.links[at] ?? [at])

    this.nextNode[index] = next
    this.willStop[index] = next === this.goal[index] && !this.rng.chance(PASS_THROUGH_CHANCE) ? 1 : 0
    this.writeWaypoint(index)
  }

  /** Where on `nextNode` to aim: its centre, offset into the villager's lane. */
  private writeWaypoint(index: number): void {
    const from = this.node[index] as number
    const to = this.nextNode[index] as number
    const targetX = this.nodeX[to] as number
    const targetZ = this.nodeZ[to] as number
    const dx = targetX - (this.nodeX[from] as number)
    const dz = targetZ - (this.nodeZ[from] as number)
    const length = Math.hypot(dx, dz) || 1
    const lane = this.lane[index] as number
    this.waypointX[index] = targetX + (-dz / length) * lane
    this.waypointZ[index] = targetZ + (dx / length) * lane
  }

  /**
   * Picks somewhere to go.
   *
   * Most trips stay inside the villager's own quarter, which is what keeps an
   * intra-group cascade visibly local while the town itself stays unlabelled;
   * the rest cross town, so the place does not look partitioned. Short hops
   * are rejected because a destination two tiles away is not a journey anyone
   * can watch being made.
   */
  private chooseGoal(index: number, at: number): number {
    const home = this.homeSets[index] as Set<number>

    for (let attempt = 0; attempt < 8; attempt++) {
      const pool = this.destinations[this.pickKind()]
      if (!pool || pool.length === 0) continue
      const local = this.rng.chance(HOME_TRIP_CHANCE) ? pool.filter((slot) => home.has(slot)) : null
      const from = local && local.length > 0 ? local : pool
      const goal = this.rng.pick(from)
      if (goal !== at && this.routes.hops(at, goal) >= MIN_TRIP_HOPS) return goal
    }

    // Anything reachable and not underfoot beats standing still.
    for (const kind of this.destinationKinds) {
      for (const goal of this.destinations[kind] ?? []) {
        if (goal !== at && this.routes.hops(at, goal) > 0) return goal
      }
    }
    return this.rng.pick(this.links[at] ?? [at])
  }

  private pickKind(): DestinationKind {
    let total = 0
    for (const kind of this.destinationKinds) total += DESTINATION_WEIGHTS[kind]
    let roll = this.rng.next() * total
    for (const kind of this.destinationKinds) {
      roll -= DESTINATION_WEIGHTS[kind]
      if (roll <= 0) return kind
    }
    return this.destinationKinds[this.destinationKinds.length - 1] as DestinationKind
  }

  /**
   * Rotates smoothly towards `target`, taking the short way round.
   *
   * The result is wrapped rather than left to run on. Turning the same way
   * repeatedly otherwise walks the stored heading off to thousands of degrees,
   * where a float carries far less precision per radian and anything
   * comparing two headings has to remember to wrap first.
   */
  private faceTowards(index: number, target: number, dt: number): void {
    const current = this.angle[index] as number
    const delta = wrapAngle(target - current)
    const maxStep = TURN_RATE * dt
    this.angle[index] = wrapAngle(current + clamp(delta, -maxStep, maxStep))
  }

  // -------------------------------------------------------------------------
  // Neighbours
  // -------------------------------------------------------------------------

  /**
   * Who is near whom, and what each villager does about it.
   *
   * One pass over a spatial hash produces three things: a sideways nudge so
   * bodies stop overlapping, a speed cap so a villager follows the person in
   * front instead of walking through them, and something to look at. All three
   * are written before anybody moves, so a villager responds to where its
   * neighbours were this frame rather than to whichever of them happened to be
   * updated first.
   */
  private observeNeighbours(dt: number): void {
    this.cellHead.fill(-1)
    for (let i = 0; i < this.count; i++) {
      const cell = cellAxis(this.x[i] as number) * HASH_SIDE + cellAxis(this.z[i] as number)
      this.cellNext[i] = this.cellHead[cell] as number
      this.cellHead[cell] = i
    }

    for (let i = 0; i < this.count; i++) {
      this.crowd[i] = 1
      this.separateX[i] = 0
      this.separateZ[i] = 0

      const xi = this.x[i] as number
      const zi = this.z[i] as number
      const facing = this.angle[i] as number
      const fwdX = Math.sin(facing), fwdZ = Math.cos(facing)
      const sideX = -fwdZ, sideZ = fwdX

      let nearest = Infinity
      let gaze = 0
      const cx = cellAxis(xi), cz = cellAxis(zi)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const gx = cx + ox, gz = cz + oz
          if (gx < 0 || gz < 0 || gx >= HASH_SIDE || gz >= HASH_SIDE) continue
          for (let j = this.cellHead[gx * HASH_SIDE + gz] as number; j >= 0; j = this.cellNext[j] as number) {
            if (j === i) continue
            const rx = (this.x[j] as number) - xi
            const rz = (this.z[j] as number) - zi
            const reach = Math.hypot(rx, rz)
            if (reach > NEIGHBOUR_RADIUS) continue

            const along = rx * fwdX + rz * fwdZ
            const lateral = rx * sideX + rz * sideZ

            if (reach < SEPARATION_RADIUS) {
              const closeness = (SEPARATION_RADIUS - reach) / SEPARATION_RADIUS
              const span = Math.max(reach, 1e-4)
              this.separateX[i] = (this.separateX[i] as number) - (rx / span) * closeness
              this.separateZ[i] = (this.separateZ[i] as number) - (rz / span) * closeness
            }
            // Giving way is one-sided on purpose. Two villagers meeting at a
            // junction each have the other dead ahead, and if both slow for
            // the other the whole town locks up — which is exactly what it did
            // before this rule: at full density nearly everyone stood still
            // waiting for somebody who was waiting for them. Index order is
            // arbitrary but it is a strict order, so it cannot form a cycle:
            // one of any blocked pair always has priority and keeps going.
            // Anyone already standing is given way to regardless.
            const yielding = j < i || this.activity[j] !== Activity.Walking
            if (yielding && along > 0 && along < FOLLOW_RADIUS && Math.abs(lateral) < FOLLOW_LANE_WIDTH) {
              // Shoulder to shoulder is a dead stop; the gap opens up from there.
              const gap = (along - BODY_WIDTH) / (FOLLOW_RADIUS - BODY_WIDTH)
              this.crowd[i] = Math.min(this.crowd[i] as number, clamp(gap, 0, 1))
            }
            if (reach < nearest) {
              nearest = reach
              gaze = wrapAngle(Math.atan2(rx, rz) - facing)
            }
          }
        }
      }

      this.gazeTarget[i] = nearest < GAZE_RADIUS && Math.abs(gaze) <= GAZE_LIMIT ? gaze : 0
      this.gaze[i] = (this.gaze[i] as number) +
        ((this.gazeTarget[i] as number) - (this.gaze[i] as number)) * Math.min(1, dt / GAZE_TAU)
    }
  }
}

/** Half the hash grid's span, so the island sits inside it without wrapping. */
const HASH_ORIGIN = (HASH_SIDE * HASH_CELL) / 2
const cellAxis = (value: number) =>
  clamp(Math.floor((value + HASH_ORIGIN) / HASH_CELL), 0, HASH_SIDE - 1)

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The equivalent angle in (-pi, pi], so turns take the short way round. */
function wrapAngle(angle: number): number {
  let wrapped = angle
  while (wrapped > Math.PI) wrapped -= Math.PI * 2
  while (wrapped < -Math.PI) wrapped += Math.PI * 2
  return wrapped
}

const approach = (value: number, target: number, step: number) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step)

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
    case Activity.LookingAround:
    default:
      return 'idle'
  }
}
