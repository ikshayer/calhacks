import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { cloneResident, prepareResidentTemplate, disposeResidentSkeletons } from '../src/island/residentRendering.ts'
import residentCatalog from '../src/island/residentCatalog.json'

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
  for (const { id: resident } of residentCatalog) {
    const gltf = await new GLTFLoader().loadAsync(`/models/mii-test/${resident}.glb`)
    const prepared = prepareResidentTemplate(gltf.scene)
    const original = cloneResident(gltf.scene)
    const optimized = cloneResident(prepared.root)
    const a = new THREE.AnimationMixer(original)
    const b = new THREE.AnimationMixer(optimized)
    let poseChecks = 0
    try {
      const walk = gltf.animations.find((clip) => clip.name === 'test_walk')
      const metadata = original.getObjectByName('MiiTest')?.userData
      if (!walk || walk.duration !== 1 || metadata?.walkCycleSeconds !== 1 || !(metadata?.walkStrideLength > 0)) {
        throw new Error(`Invalid walk clip/metadata: ${resident}`)
      }
      let seamError = 0
      let rootDrift = 0
      for (const track of walk.tracks) {
        const size = track.getValueSize()
        for (let i = 0; i < size; i++) {
          seamError = Math.max(seamError, Math.abs(track.values[i] - track.values[track.values.length - size + i]))
          if (/^(MiiTest|root)\.(position|quaternion|scale)$/.test(track.name)) {
            for (let frame = 0; frame < track.times.length; frame++) {
              rootDrift = Math.max(rootDrift, Math.abs(track.values[i] - track.values[frame * size + i]))
            }
          }
        }
      }
      if (seamError > 1e-5 || rootDrift > 1e-6) throw new Error(`Walk seam/root mismatch: ${resident}`)
      a.clipAction(walk).play()
      let plantedDrift = 0
      for (const [side, offset] of [['L', 0], ['R', 0.5]]) {
        let previousFrame = -2
        let anchor
        const foot = original.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`foot.${side}`))
        if (!foot) throw new Error(`Missing foot: ${resident}, ${side}`)
        for (let frame = 0; frame <= 24; frame++) {
          const phase = (frame / 24 + offset) % 1
          if (phase > 0.6) continue
          a.setTime(frame / 24)
          original.updateMatrixWorld(true)
          const point = foot.getWorldPosition(new THREE.Vector3())
          point.z += metadata.walkStrideLength * frame / 24
          if (frame !== previousFrame + 1) anchor = point.clone()
          plantedDrift = Math.max(plantedDrift, point.distanceTo(anchor))
          previousFrame = frame
        }
      }
      if (plantedDrift > 2e-4) throw new Error(`Sliding walk contact: ${resident}, ${plantedDrift}`)
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
      results.push({ resident, poseChecks, seamError, rootDrift, plantedDrift, result: 'matching surface at 1e-5 world units' })
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
