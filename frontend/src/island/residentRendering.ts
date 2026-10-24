import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'

function sameSkeleton(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  return a.bones.length === b.bones.length &&
    a.bones.every((bone, i) => bone === b.bones[i] && a.boneInverses[i]!.equals(b.boneInverses[i]!))
}

/** Share bone palettes within one clone, never between independent residents. */
export function cloneResident(source: THREE.Object3D): THREE.Object3D {
  const root = cloneSkeleton(source)
  const shared: THREE.Skeleton[] = []
  const redundant = new Set<THREE.Skeleton>()
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const skeleton = object.skeleton
    const existing = shared.find((candidate) => sameSkeleton(candidate, skeleton))
    if (existing) {
      if (existing !== skeleton) redundant.add(skeleton)
      object.skeleton = existing
    } else shared.push(skeleton)
  })
  for (const skeleton of redundant) skeleton.dispose()
  return root
}

/** Mesh geometry and materials belong to the cached template, not its clones. */
export function disposeResidentSkeletons(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>()
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton)
  })
  for (const skeleton of skeletons) skeleton.dispose()
}

export function residentRenderStats(root: THREE.Object3D) {
  let meshes = 0
  const skeletons = new Set<THREE.Skeleton>()
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes++
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton)
  })
  return { meshes, skeletons: skeletons.size }
}

type Part = THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
type AtlasRegion = { x: number; y: number; width: number; height: number }

/** This preparation targets the baked Mii exports: one skin, identity mesh
 * transforms, plain PBR colors and PNG facial sprites. Reject unsupported
 * inputs instead of silently discarding their material or skin behavior. */
export function prepareResidentTemplate(source: THREE.Object3D) {
  const root = cloneResident(source)
  root.updateMatrixWorld(true)
  const parts: Part[] = []
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) {
      if (Array.isArray(object.material) || !(object.material instanceof THREE.MeshStandardMaterial)) {
        throw new Error('Resident preparation requires one PBR material per primitive')
      }
      parts.push(object as Part)
    }
  })
  const reference = parts[0]
  if (!reference) throw new Error('Resident export contains no skinned meshes')
  const identity = new THREE.Matrix4()
  for (const part of parts) {
    const material = part.material
    if (!sameSkeleton(reference.skeleton, part.skeleton) || !part.bindMatrix.equals(reference.bindMatrix) ||
      !part.matrixWorld.equals(identity) || Object.keys(part.geometry.morphAttributes).length > 0) {
      throw new Error('Resident parts must share bind space and skeleton, without morph targets')
    }
    if (material.normalMap || material.roughnessMap || material.metalnessMap || material.alphaMap ||
      material.aoMap || material.emissiveMap || material.emissive.getHex() !== 0 || material.opacity !== 1 ||
      material.roughness !== reference.material.roughness || material.metalness !== reference.material.metalness) {
      throw new Error('Resident contains material features that cannot be combined losslessly')
    }
  }
  const opaque = parts.filter((part) => !part.material.transparent)
  const sprites = parts.filter((part) => part.material.transparent && !part.material.name.includes('glasses'))
  const glasses = parts.filter((part) => part.material.transparent && part.material.name.includes('glasses'))
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []

  const regions = new Map<THREE.Texture, AtlasRegion>()
  let atlas: THREE.CanvasTexture | null = null
  if (sprites.length > 0) {
    const maps = [...new Set(sprites.map((part) => part.material.map))]
    if (maps.some((map) => !map || map.flipY || map.channel !== 0 ||
      !map.matrix.equals(new THREE.Matrix3()) || map.colorSpace !== THREE.SRGBColorSpace)) {
      throw new Error('Facial sprites require untransformed glTF UVs and sRGB textures')
    }
    const padding = 4
    const tileWidth = Math.max(...maps.map((map) => (map!.image as { width: number }).width))
    const tileHeight = Math.max(...maps.map((map) => (map!.image as { height: number }).height))
    const columns = Math.ceil(Math.sqrt(maps.length))
    const rows = Math.ceil(maps.length / columns)
    const canvas = document.createElement('canvas')
    canvas.width = columns * (tileWidth + padding * 2)
    canvas.height = rows * (tileHeight + padding * 2)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create the resident face atlas')
    maps.forEach((map, i) => {
      const image = map!.image as CanvasImageSource & { width: number; height: number }
      const x = i % columns * (tileWidth + padding * 2) + padding
      const y = Math.floor(i / columns) * (tileHeight + padding * 2) + padding
      context.drawImage(image, x, y)
      regions.set(map!, { x: x / canvas.width, y: y / canvas.height,
        width: image.width / canvas.width, height: image.height / canvas.height })
    })
    atlas = new THREE.CanvasTexture(canvas)
    atlas.name = 'Resident facial atlas'
    atlas.flipY = false
    atlas.colorSpace = THREE.SRGBColorSpace
    textures.push(atlas)
  }

  function batch(batchParts: Part[], name: string, map: THREE.Texture | null) {
    if (batchParts.length === 0) return
    const pieces = batchParts.map((part) => {
      const geometry = part.geometry.clone()
      const count = geometry.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) part.material.color.toArray(colors, i * 3)
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      if (map) {
        const uv = geometry.getAttribute('uv')
        const region = regions.get(part.material.map!)!
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, region.x + uv.getX(i) * region.width, region.y + uv.getY(i) * region.height)
        }
      } else if (part.material.map) throw new Error('Opaque texture atlasing is not implemented')
      return geometry
    })
    const geometry = mergeGeometries(pieces, false)
    for (const piece of pieces) piece.dispose()
    if (!geometry) throw new Error('Resident vertex layouts are incompatible')
    geometries.push(geometry)
    const material = batchParts[0]!.material.clone()
    material.name = name
    material.color.set('#ffffff')
    material.vertexColors = true
    material.map = map
    material.forceSinglePass = true
    materials.push(material)
    const mesh = new THREE.SkinnedMesh(geometry, material)
    mesh.name = name
    mesh.bindMode = reference.bindMode
    mesh.bind(reference.skeleton, reference.bindMatrix)
    mesh.castShadow = !map
    // Keep the same conservative culling policy until whole-resident bounds
    // are added; an unposed skinned bounding box can hide an extended arm.
    mesh.frustumCulled = false
    root.add(mesh)
  }

  batch(opaque, 'Resident body', null)
  batch(sprites, 'Resident face', atlas)
  for (const part of glasses) {
    const material = part.material.clone()
    material.forceSinglePass = true
    materials.push(material)
    part.material = material
    part.castShadow = false
    // Lenses stay genuinely translucent and draw after the facial decals.
    part.renderOrder = 1
    part.frustumCulled = false
  }
  for (const part of [...opaque, ...sprites]) part.removeFromParent()
  const stats = residentRenderStats(root)
  return { root, stats, dispose() {
    disposeResidentSkeletons(root)
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    for (const texture of textures) texture.dispose()
  } }
}
