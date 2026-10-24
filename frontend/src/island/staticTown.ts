import * as THREE from 'three'

export interface StaticPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  matrix: THREE.Matrix4
  name: string
}

/** Include every visible primitive, retaining groups and transforms without owning cached resources. */
export function collectStaticParts(source: THREE.Object3D): StaticPart[] {
  source.updateWorldMatrix(true, true)
  const parentInverse = source.parent ? source.parent.matrixWorld.clone().invert() : new THREE.Matrix4()
  const parts: StaticPart[] = []
  source.traverseVisible((node) => {
    if (!(node instanceof THREE.Mesh)) return
    if (node instanceof THREE.SkinnedMesh || node instanceof THREE.InstancedMesh) {
      throw new Error('Town templates must contain ordinary static meshes')
    }
    if (Object.keys(node.geometry.morphAttributes).length || node.morphTargetInfluences?.some((weight) => weight !== 0)) {
      throw new Error('Town morph poses must be baked before static instancing')
    }
    const matrix = parentInverse.clone().multiply(node.matrixWorld)
    if (matrix.determinant() <= 0) throw new Error('Mirrored or degenerate town transforms need authored winding repair')
    parts.push({ geometry: node.geometry, material: node.material, matrix, name: node.name })
  })
  return parts
}

export function staticBounds(parts: readonly StaticPart[]): THREE.Box3 {
  const result = new THREE.Box3()
  for (const part of parts) {
    // Computing a bounding box on a temporary Box3 avoids mutating cached geometry.
    const position = part.geometry.getAttribute('position')
    result.union(new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute).applyMatrix4(part.matrix))
  }
  return result
}

export function placedStaticMatrix(placement: { x: number; z: number; rotation: number; scale: number }, source: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(placement.x, 0, placement.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotation),
    new THREE.Vector3().setScalar(placement.scale)).multiply(source)
}

export interface BuildingProfile {
  yaw: number
  doorX: number
  doorZ: number
  roofMin: number
  roofColor: string
}

/** Measured door leaf planes; R and P have side/back entrances that need facade alignment. */
export const BUILDING_PROFILES: Record<string, BuildingProfile> = {
  'building-type-a': { yaw: 0, doorX: 0, doorZ: 0.4559, roofMin: 0.36, roofColor: '#bd7255' },
  'building-type-b': { yaw: 0, doorX: -0.544, doorZ: 0.4, roofMin: 0.36, roofColor: '#687f99' },
  'building-type-c': { yaw: 0, doorX: -0.0068, doorZ: 0.4559, roofMin: 0.36, roofColor: '#a26b68' },
  'building-type-e': { yaw: 0, doorX: 0, doorZ: 0.456, roofMin: 0.30, roofColor: '#b98556' },
  'building-type-g': { yaw: 0, doorX: -0.475, doorZ: 0.531, roofMin: 0.36, roofColor: '#65837d' },
  'building-type-h': { yaw: 0, doorX: 0, doorZ: 0.4, roofMin: 0.36, roofColor: '#b87862' },
  'building-type-k': { yaw: 0, doorX: 0.2031, doorZ: 0.46, roofMin: 0.76, roofColor: '#6e7b94' },
  'building-type-m': { yaw: 0, doorX: 0.056, doorZ: 0.656, roofMin: 0.36, roofColor: '#617f88' },
  'building-type-p': { yaw: Math.PI, doorX: -0.4, doorZ: 0.325, roofMin: Infinity, roofColor: '#aa7758' },
  'building-type-r': { yaw: -Math.PI / 2, doorX: -0.14, doorZ: 0.456, roofMin: 0.76, roofColor: '#967965' },
  'building-type-t': { yaw: 0, doorX: 0, doorZ: 0.6668, roofMin: 0.36, roofColor: '#737caa' },
}

export interface BuildingFit { horizontal: number; courseExtra: number; profile: BuildingProfile }
export type PixelSampler = (u: number, v: number) => [number, number, number]

export function fitBuilding(parts: readonly StaticPart[], profile: BuildingProfile, maxScale: number, averageScale: number, width: number): BuildingFit {
  const orientation = new THREE.Matrix4().makeRotationY(profile.yaw)
  const bounds = staticBounds(parts.map((part) => ({ ...part, matrix: orientation.clone().multiply(part.matrix) })))
  const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z)
  // Reserve a border around each plot for fascia/entrance trim.
  const horizontal = Math.min(1.4, (width - 0.24) / (span * maxScale))
  // Stretch only the lower wall course; the upper roof retains its original pitch.
  const courseExtra = Math.max(0, (2.45 / averageScale - 0.27 * horizontal) / 0.9)
  return { horizontal, courseExtra, profile }
}

export function remapBuildingY(y: number, fit: BuildingFit): number {
  return y * fit.horizontal + Math.min(Math.max(y / 0.30, 0), 1) * fit.courseExtra
}

/** Own only cloned geometry/materials; palette textures remain borrowed from the GLTF cache. */
export function prepareBuilding(parts: readonly StaticPart[], fit: BuildingFit, sample: PixelSampler) {
  const geometries: THREE.BufferGeometry[] = []
  const materials = new Set<THREE.Material>()
  const materialCopies = new Map<THREE.Material, THREE.Material>()
  const roof = new THREE.Color(fit.profile.roofColor)
  const referenceGreen = new THREE.Color('#50b478')
  const multiplier = [roof.r / referenceGreen.r, roof.g / referenceGreen.g, roof.b / referenceGreen.b]
  try {
    const prepared = parts.map((part): StaticPart => {
      if (part.geometry.getAttribute('color')?.itemSize === 4) throw new Error('Building roof preparation does not replace RGBA vertex colors')
      const geometry = part.geometry.clone()
      geometries.push(geometry)
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(fit.profile.yaw).multiply(part.matrix))
      const positions = geometry.getAttribute('position')
      const normals = geometry.getAttribute('normal')
      const uv = geometry.getAttribute('uv')
      const oldColors = geometry.getAttribute('color')
      const colors = new Float32Array(positions.count * 3)
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i)
        const rgb = uv ? sample(uv.getX(i), uv.getY(i)) : [0, 0, 0]
        const greenRoof = y >= fit.profile.roofMin && rgb[1]! > rgb[0]! * 1.3 && rgb[1]! > rgb[2]! * 1.12
        for (let c = 0; c < 3; c++) colors[i * 3 + c] =
          (oldColors ? oldColors.getComponent(i, c) : 1) * (greenRoof ? multiplier[c]! : 1)
        positions.setXYZ(i, positions.getX(i) * fit.horizontal, remapBuildingY(y, fit), positions.getZ(i) * fit.horizontal)
        if (normals) {
          const sy = fit.horizontal + (y >= 0 && y < 0.30 ? fit.courseExtra / 0.30 : 0)
          const normal = new THREE.Vector3(normals.getX(i) / fit.horizontal, normals.getY(i) / sy, normals.getZ(i) / fit.horizontal).normalize()
          normals.setXYZ(i, normal.x, normal.y, normal.z)
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      const cloneMaterial = (source: THREE.Material) => {
        let material = materialCopies.get(source)
        if (!material) {
          material = source.clone()
          material.vertexColors = true
          materialCopies.set(source, material)
          materials.add(material)
        }
        return material
      }
      return { geometry, material: Array.isArray(part.material) ? part.material.map(cloneMaterial) : cloneMaterial(part.material),
        matrix: new THREE.Matrix4(), name: part.name }
    })
    return { parts: prepared, bounds: staticBounds(prepared), fit, dispose() {
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose())
    } }
  } catch (error) {
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose())
    throw error
  }
}
