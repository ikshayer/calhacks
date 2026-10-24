import * as THREE from 'three'
import { cloneResident, disposeResidentSkeletons } from './residentRendering'
import type { GLTF } from 'three-stdlib'
import { CHARACTER_MODELS } from '@/data/mock/personas'

export const CHARACTER_PATHS = CHARACTER_MODELS.map((name) => `/models/characters/${name}.glb`)
export const COLORMAP_PATH = '/models/characters/Textures/colormap.png'

/**
 * The only animation clips we bind.
 *
 * The Kenney rig ships 32, and an AnimationMixer costs per bound action, so we
 * take the four the island actually uses. `holding-both` is the clip where the
 * character holds something at chest height in both hands, which reads exactly
 * like looking at a phone.
 */
export const USED_CLIPS = ['idle', 'walk', 'holding-both', 'emote-no'] as const
export type ClipName = (typeof USED_CLIPS)[number]

export interface VillagerRig {
  root: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  /** The clip currently faded in. */
  playing: string
  /** Time owed to the mixer because the animation budget skipped it. */
  owed: number
  advance(dt: number): void
  /** The head bone, for parenting accessories. */
  head?: THREE.Object3D
}

/**
 * One material for every villager, taken from the loaded model rather than
 * rebuilt by hand.
 *
 * All 12 characters carry a byte-identical material: the same `colormap`
 * palette texture, the same sampler, the same `KHR_texture_transform`. Reusing
 * the one GLTFLoader already built means the texture transform and colour space
 * are whatever the file actually asked for, and sharing a single instance
 * across every clone means 120 villagers churn no GPU state between draws.
 *
 * Building a MeshLambertMaterial here instead looked equivalent and rendered
 * every villager as a black silhouette, which is the argument for not
 * second-guessing the loader.
 *
 * Villagers are not tinted by audience group. The 12 outfits already read as
 * distinct people, and group membership is legible from the district they live
 * in — tinting a character's face to match a chart series would look wrong.
 */
export function sharedCharacterMaterial(gltf: GLTF): THREE.Material {
  let found: THREE.Material | undefined
  gltf.scene.traverse((node) => {
    if (!found && node instanceof THREE.Mesh && !Array.isArray(node.material)) {
      found = node.material
    }
  })
  if (!found) throw new Error('sharedCharacterMaterial: model has no mesh to take a material from')
  return found
}

/**
 * Builds one villager from a loaded GLTF.
 *
 * `SkeletonUtils.clone` rather than `Object3D.clone`: the latter copies the
 * meshes but leaves them bound to the original skeleton, so every villager
 * would animate in lockstep with the first one.
 */
export function createRig(
  gltf: GLTF,
  material: THREE.Material,
  castShadow: boolean,
): VillagerRig {
  const root = cloneResident(gltf.scene) as THREE.Group

  let head: THREE.Object3D | undefined
  root.traverse((node) => {
    if (node.name === 'head') head = node
    if (node instanceof THREE.Mesh) {
      node.material = material
      node.castShadow = castShadow
      node.receiveShadow = false
      // Villagers are never culled individually: the animation budget already
      // decides what work they cost, and per-mesh culling of a skinned mesh
      // uses the un-posed bounding box, which pops them in and out at the edges.
      node.frustumCulled = false
    }
  })

  const mixer = new THREE.AnimationMixer(root)
  const actions = new Map<string, THREE.AnimationAction>()
  for (const name of USED_CLIPS) {
    const clip = gltf.animations.find((candidate) => candidate.name === name)
    if (!clip) continue
    const action = mixer.clipAction(clip)
    action.enabled = true
    action.setEffectiveWeight(0)
    action.play()
    actions.set(name, action)
  }

  const idle = actions.get('idle')
  if (idle) idle.setEffectiveWeight(1)

  return { root, mixer, actions, playing: 'idle', owed: 0, head, advance: (dt) => { mixer.update(dt) } }
}

/** Crossfades a rig to `next`, leaving it alone if it is already playing. */
export function playClip(rig: VillagerRig, next: string, fade = 0.18): void {
  if (rig.playing === next) return
  const incoming = rig.actions.get(next)
  if (!incoming) return

  const outgoing = rig.actions.get(rig.playing)
  if (outgoing) outgoing.fadeOut(fade)
  incoming.reset().fadeIn(fade).play()
  rig.playing = next
}

/** Frees the GPU resources held by a rig. */
export function disposeRig(rig: VillagerRig): void {
  rig.mixer.stopAllAction()
  rig.mixer.uncacheRoot(rig.root)
  disposeResidentSkeletons(rig.root)
}
