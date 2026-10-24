import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { cloneResident, disposeResidentSkeletons, residentRenderStats } from '../src/island/residentRendering.ts'

function fixture(differentInverses = false) {
  const root = new THREE.Group()
  const hip = new THREE.Bone()
  const head = new THREE.Bone()
  hip.name = 'hip'
  head.name = 'head'
  head.position.y = 1
  hip.add(head)
  root.add(hip)
  root.updateMatrixWorld(true)
  const first = new THREE.Skeleton([hip, head])
  const second = first.clone()
  if (differentInverses) {
    second.boneInverses = first.boneInverses.map((m) => m.clone())
    second.boneInverses[1].elements[12] = 0.25
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,1,0, 1,0,0], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0,0,0,0, 1,0,0,0, 0,0,0,0], 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0], 4))
  for (const skeleton of [first, second]) {
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
    mesh.bind(skeleton, new THREE.Matrix4())
    root.add(mesh)
  }
  return root
}

test('compatible parts share one skeleton without changing skin deformation', () => {
  const source = fixture()
  source.getObjectByName('head').rotation.z = 0.4
  source.updateMatrixWorld(true)
  const copy = cloneResident(source)
  copy.updateMatrixWorld(true)
  assert.deepEqual(residentRenderStats(copy), { meshes: 2, skeletons: 1 })
  const originalMeshes = source.children.filter((o) => o.isSkinnedMesh)
  const clonedMeshes = copy.children.filter((o) => o.isSkinnedMesh)
  for (let i = 0; i < clonedMeshes.length; i++) {
    for (let v = 0; v < 3; v++) {
      const a = originalMeshes[i].getVertexPosition(v, new THREE.Vector3())
      const b = clonedMeshes[i].getVertexPosition(v, new THREE.Vector3())
      assert.ok(a.distanceTo(b) < 1e-7)
    }
  }
})

test('separate residents retain independent bones and animation poses', () => {
  const source = fixture()
  const a = cloneResident(source)
  const b = cloneResident(source)
  a.getObjectByName('head').rotation.z = 0.75
  assert.ok(Math.abs(b.getObjectByName('head').rotation.z) < 1e-12)
  assert.ok(Math.abs(source.getObjectByName('head').rotation.z) < 1e-12)
  assert.notEqual(a.children.find((o) => o.isSkinnedMesh).skeleton,
    b.children.find((o) => o.isSkinnedMesh).skeleton)
})

test('parts with different inverse bind matrices keep separate skeletons', () => {
  const copy = cloneResident(fixture(true))
  assert.equal(residentRenderStats(copy).skeletons, 2)
})

test('cleanup disposes each owned skeleton once and preserves cached geometry', () => {
  const source = fixture()
  const copy = cloneResident(source)
  const meshes = copy.children.filter((o) => o.isSkinnedMesh)
  let disposedSkeletons = 0
  let disposedGeometry = 0
  meshes[0].skeleton.dispose = () => { disposedSkeletons++ }
  meshes[0].geometry.addEventListener('dispose', () => { disposedGeometry++ })
  disposeResidentSkeletons(copy)
  assert.equal(disposedSkeletons, 1)
  assert.equal(disposedGeometry, 0)
})
