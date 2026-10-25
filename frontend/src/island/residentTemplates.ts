import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { cloneResident, disposeResidentSkeletons, prepareResidentTemplate } from './residentRendering.ts'
import { SharedResource } from './SharedResource.ts'
import { ResidentController } from './ResidentController.ts'
import { createPoseOverlay } from './residentPose.ts'
import { RESIDENT_HEIGHT, RESIDENT_IDS } from './residentAppearance.ts'

export interface ResidentTemplate {
  id: string
  gltf: GLTF
  prepared: ReturnType<typeof prepareResidentTemplate>
  center: THREE.Vector3
  floor: number
  scale: number
  baseSpeed: number
}

/** Raw resources are owned by this loader, never by instances or the useGLTF cache. */
function disposeSource(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  disposeResidentSkeletons(root)
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => {
    texture.dispose()
    const image = texture.image as { close?: () => void } | null
    if (typeof image?.close === 'function') image.close()
  })
}

export const residentTemplates = new SharedResource(async () => {
  const loader = new GLTFLoader()
  const results = await Promise.allSettled(RESIDENT_IDS.map(async (id): Promise<ResidentTemplate> => {
    const gltf = await loader.loadAsync(`/models/mii-test/${id}.glb`)
    try {
      const rig = gltf.scene.getObjectByName('MiiTest')
      const stride = Number(rig?.userData.walkStrideLength)
      const cycle = Number(rig?.userData.walkCycleSeconds)
      const walk = gltf.animations.find((clip) => clip.name === 'test_walk')
      const bounds = new THREE.Box3().setFromObject(gltf.scene)
      const height = bounds.max.y - bounds.min.y
      if (!(stride > 0) || !(cycle > 0) || !(height > 0) || !walk || Math.abs(walk.duration - cycle) > 1e-4) {
        throw new Error(`Invalid resident stride metadata: ${id}`)
      }
      const scale = RESIDENT_HEIGHT / height
      // Prepare in authored bind space; only clones receive normalization wrappers.
      const prepared = prepareResidentTemplate(gltf.scene)
      return { id, gltf, prepared, center: bounds.getCenter(new THREE.Vector3()), floor: bounds.min.y,
        scale, baseSpeed: stride * scale / cycle }
    } catch (error) { disposeSource(gltf.scene); throw error }
  }))
  const templates = new Map<string, ResidentTemplate>()
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') templates.set(result.value.id, result.value)
    else console.warn(`Resident ${RESIDENT_IDS[index]} unavailable; using an available design`, result.reason)
  })
  return templates
}, (templates) => {
  for (const template of templates.values()) { template.prepared.dispose(); disposeSource(template.gltf.scene) }
})

export function createResident(template: ResidentTemplate, phase: number) {
  const model = cloneResident(template.prepared.root)
  const normalized = new THREE.Group()
  normalized.scale.setScalar(template.scale)
  model.position.set(-template.center.x, -template.floor, -template.center.z)
  normalized.add(model)
  const root = new THREE.Group()
  root.add(normalized)
  // Phone, nods and gaze are rotated onto the clips rather than authored as
  // extra actions; a design missing the bones simply plays the clips plain.
  const controller = new ResidentController(model, template.gltf.animations, template.baseSpeed, phase,
    { pose: createPoseOverlay(model, phase) })
  return { root, model, controller, owed: 0,
    get urgent() { return controller.urgent },
    advance() { controller.advance() },
    dispose() { controller.dispose(); disposeResidentSkeletons(model) } }
}

export function setResidentShadows(root: THREE.Object3D, shadows: boolean): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    node.castShadow = shadows && materials.every((material) => !material.transparent)
    node.receiveShadow = false
  })
}
