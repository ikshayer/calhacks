import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { cloneResident, prepareResidentTemplate, disposeResidentSkeletons } from '../src/island/residentRendering.ts'

function surface(root) {
  root.updateMatrixWorld(true)
  const points = new Set()
  let triangles = 0
  const point = new THREE.Vector3()
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return
    const index = mesh.geometry.index
    const count = mesh.geometry.attributes.position.count
    triangles += (index ? index.count : count) / 3
    const used = index ? new Set(index.array) : new Set(Array.from({ length: count }, (_, i) => i))
    for (const i of used) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
      points.add(point.toArray().map((v) => Math.round(v * 100000)).join(','))
    }
  })
  return { points, triangles }
}

/** Run from the dev preview console. Compare actual GLB deformation before and
 * after preparation, rather than relying on the batching implementation. */
export async function checkResidentExports() {
  const results = []
  for (const resident of ['resident', 'nia', 'theo', 'rowan']) {
    const gltf = await new GLTFLoader().loadAsync(`/models/mii-test/${resident}.glb`)
    const prepared = prepareResidentTemplate(gltf.scene)
    const original = cloneResident(gltf.scene)
    const optimized = cloneResident(prepared.root)
    const a = new THREE.AnimationMixer(original)
    const b = new THREE.AnimationMixer(optimized)
    let poseChecks = 0
    try {
      for (const clip of gltf.animations) {
        a.stopAllAction()
        b.stopAllAction()
        a.clipAction(clip).play()
        b.clipAction(clip).play()
        for (const time of [0, 0.37, clip.duration * 0.8]) {
          a.setTime(time)
          b.setTime(time)
          const before = surface(original)
          const after = surface(optimized)
          if (before.triangles !== after.triangles || before.points.size !== after.points.size ||
            [...before.points].some((point) => !after.points.has(point))) {
            throw new Error(`Deformation mismatch: ${resident}, ${clip.name}, ${time}s`)
          }
          poseChecks++
        }
      }
      results.push({ resident, poseChecks, result: 'matching surface at 1e-5 world units' })
    } finally {
      a.stopAllAction()
      b.stopAllAction()
      a.uncacheRoot(original)
      b.uncacheRoot(optimized)
      disposeResidentSkeletons(original)
      disposeResidentSkeletons(optimized)
      prepared.dispose()
    }
  }
  return results
}
