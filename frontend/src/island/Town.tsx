import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { GLTF } from 'three-stdlib'
import { islandModelKeys, type Plot } from './scene/island'

export const TOWN_MODEL_PATHS = islandModelKeys().map((key) => `/models/${key}.glb`)

/**
 * Every building, tree and planter in town.
 *
 * Static geometry, so unlike the villagers these can genuinely be instanced:
 * one draw call per model however many copies stand around.
 */
export function Town({ placements, shadows }: { placements: Plot[]; shadows: boolean }) {
  const gltfs = useGLTF(TOWN_MODEL_PATHS) as unknown as GLTF[]
  const keys = useMemo(() => islandModelKeys(), [])

  const batches = useMemo(() => {
    const byModel = new Map<string, Plot[]>()
    for (const placement of placements) {
      const existing = byModel.get(placement.model)
      if (existing) existing.push(placement)
      else byModel.set(placement.model, [placement])
    }

    return keys.flatMap((key, index) => {
      const instances = byModel.get(key)
      const gltf = gltfs[index]
      if (!instances || instances.length === 0 || !gltf) return []

      let source: THREE.Mesh | undefined
      gltf.scene.traverse((node) => {
        if (!source && node instanceof THREE.Mesh) source = node
      })
      if (!source) return []

      return [{ key, instances, geometry: source.geometry, material: source.material }]
    })
  }, [placements, gltfs, keys])

  return (
    <group>
      {batches.map((batch) => (
        <Batch
          key={batch.key}
          instances={batch.instances}
          geometry={batch.geometry}
          material={batch.material}
          shadows={shadows}
        />
      ))}
    </group>
  )
}

function Batch({
  instances,
  geometry,
  material,
  shadows,
}: {
  instances: Plot[]
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  shadows: boolean
}) {
  const mesh = useMemo(
    () => new THREE.InstancedMesh(geometry, material, instances.length),
    [geometry, material, instances.length],
  )

  useEffect(() => {
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const axis = new THREE.Vector3(0, 1, 0)
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    const color = new THREE.Color()

    instances.forEach((placement, index) => {
      position.set(placement.x, 0, placement.z)
      quaternion.setFromAxisAngle(axis, placement.rotation)
      scale.setScalar(placement.scale)
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale))
      // White leaves the palette texture exactly as authored.
      mesh.setColorAt(index, color.set(placement.tint ?? '#ffffff'))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [mesh, instances])

  useEffect(() => {
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
  }, [mesh, shadows])

  // Geometry and material belong to the cached GLTF; only the wrapper is ours.
  useEffect(() => () => mesh.dispose(), [mesh])

  return <primitive object={mesh} />
}

useGLTF.preload(TOWN_MODEL_PATHS)
