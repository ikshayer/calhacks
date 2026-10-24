import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { cloneResident, disposeResidentSkeletons, prepareResidentTemplate, residentRenderStats } from '../src/island/residentRendering.ts'
import { ResidentPlayback } from '../src/island/residentPlayback.ts'
import { ResidentController } from '../src/island/ResidentController.ts'
import { SharedResource } from '../src/island/SharedResource.ts'
import { AnimationBudget } from '../src/island/AnimationBudget.ts'
import { residentAppearance, residentPhase, RESIDENT_IDS } from '../src/island/residentAppearance.ts'
import { surfaceBorders } from '../src/island/surfaceEdges.ts'
import { buildIsland, buildDistanceField, assignHomeTiles, tileToWorld, TILE, GRID, Tile, ISLAND_SPACING, BUILDING_SCALE } from '../src/island/scene/island.ts'
import { IslandSim, Activity } from '../src/island/scene/IslandSim.ts'
import { ISLAND_VIEW } from '../src/island/scene/islandView.ts'
import { hashSeed } from '../src/lib/rng.ts'
import { RESIDENT_HEIGHT, RESIDENT_ANCHORS } from '../src/island/residentAppearance.ts'
import spacingBaseline from './fixtures/island-spacing-baseline.json' with { type: 'json' }
import { readFileSync } from 'node:fs'
import { collectStaticParts, placedStaticMatrix, prepareBuilding, fitBuilding, remapBuildingY, BUILDING_PROFILES } from '../src/island/staticTown.ts'
import { planTown, architectureFor, islandTileAt } from '../src/island/townArchitecture.ts'
import { islandModelKeys } from '../src/island/scene/island.ts'

test('static town batches preserve visible nested transforms and material groups without owning raw resources', () => {
  const parent = new THREE.Group(); parent.position.x = 100
  const root = new THREE.Group(); root.position.set(1, 2, 3); parent.add(root)
  const nested = new THREE.Group(); nested.rotation.y = 0.7; nested.scale.set(2, 3, 4); root.add(nested)
  const geometry = new THREE.BoxGeometry()
  const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]
  const mesh = new THREE.Mesh(geometry, materials); mesh.position.set(3, 0, -2); nested.add(mesh)
  const hidden = new THREE.Group(); hidden.visible = false; root.add(hidden)
  hidden.add(new THREE.Mesh(geometry, materials[0]))
  const parts = collectStaticParts(root)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].geometry, geometry)
  assert.equal(parts[0].material, materials)
  assert.equal(parts[0].geometry.groups, geometry.groups)
  const expected = parent.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
  assert.ok(parts[0].matrix.equals(expected))
  const placement = { x: 7, z: -3, rotation: 0.4, scale: 2.6 }
  const actual = new THREE.Vector3(0.3, 0.8, -0.4).applyMatrix4(placedStaticMatrix(placement, parts[0].matrix))
  const expectedPoint = new THREE.Vector3(0.3, 0.8, -0.4).applyMatrix4(expected).multiplyScalar(2.6)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.4).add(new THREE.Vector3(7, 0, -3))
  assert.ok(actual.distanceTo(expectedPoint) < 1e-10)
  assert.equal(root.position.x, 1)
})

test('unsupported static morphs and mirrored authored parts fail explicitly', () => {
  const mirrored = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  mirrored.scale.x = -1
  assert.throws(() => collectStaticParts(mirrored), /Mirrored/)
  const morph = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  morph.geometry.morphAttributes.position = [morph.geometry.attributes.position.clone()]
  assert.throws(() => collectStaticParts(morph), /morph poses/)
})

test('building preparation preserves source data, low garden colors, shade UVs and inverse-course normals', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0.1,0, 0,0.6,0, 0,0.7,0], 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([1,1,0, 1,1,0, 1,1,0], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0.1,0.1, 0.1,0.2, 0.9,0.2], 2))
  geometry.setIndex([0,1,2]); geometry.addGroup(0,3,0)
  const map = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map })
  const source = new THREE.Mesh(geometry, material)
  const parts = collectStaticParts(source)
  const fit = { horizontal: 1.4, courseExtra: 0.65, profile: BUILDING_PROFILES['building-type-a'] }
  const beforePositions = [...geometry.attributes.position.array]
  const prepared = prepareBuilding(parts, fit, (u) => u < 0.5 ? [80,180,120] : [220,220,220])
  const copy = prepared.parts[0]
  assert.deepEqual([...geometry.attributes.position.array], beforePositions)
  assert.equal(material.vertexColors, false)
  assert.equal(copy.material.map, map)
  assert.notEqual(copy.material, material)
  assert.deepEqual([...copy.geometry.attributes.uv.array], [...geometry.attributes.uv.array])
  assert.deepEqual(copy.geometry.groups, geometry.groups)
  assert.deepEqual([...copy.geometry.attributes.color.array].slice(0,3), [1,1,1])
  assert.notDeepEqual([...copy.geometry.attributes.color.array].slice(3,6), [1,1,1])
  assert.deepEqual([...copy.geometry.attributes.color.array].slice(6,9), [1,1,1])
  const expectedNormal = new THREE.Vector3(1/1.4, 1/(1.4+0.65/0.3), 0).normalize()
  assert.ok(new THREE.Vector3().fromBufferAttribute(copy.geometry.attributes.normal,0).distanceTo(expectedNormal) < 1e-6)
  assert.ok(copy.geometry.boundingBox.max.y > geometry.attributes.position.getY(2))
  let rawDisposed = 0; let ownedDisposed = 0; let textureDisposed = 0
  geometry.addEventListener('dispose', () => rawDisposed++)
  material.addEventListener('dispose', () => rawDisposed++)
  map.addEventListener('dispose', () => textureDisposed++)
  copy.geometry.addEventListener('dispose', () => ownedDisposed++)
  copy.material.addEventListener('dispose', () => ownedDisposed++)
  prepared.dispose()
  assert.equal(rawDisposed, 0); assert.equal(textureDisposed,0); assert.equal(ownedDisposed,2)
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(12).fill(1),4))
  assert.throws(() => prepareBuilding(parts,fit,()=>[80,180,120]), /RGBA/)
})

function deliveredTownBounds() {
  return new Map(islandModelKeys().map((key) => {
    const data = readFileSync(new URL(`../public/models/${key}.glb`, import.meta.url))
    const json = JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString())
    const primitives = json.meshes.flatMap((mesh) => mesh.primitives)
    const root = new THREE.Group()
    for (const primitive of primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION]
      const box = new THREE.Box3(new THREE.Vector3(...accessor.min), new THREE.Vector3(...accessor.max))
      const size = box.getSize(new THREE.Vector3())
      const geometry = new THREE.BoxGeometry(size.x,size.y,size.z)
      geometry.translate(...box.getCenter(new THREE.Vector3()).toArray())
      root.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()))
    }
    return [key,collectStaticParts(root)]
  }))
}

test('actual building bounds fit complete entrances and move pier houses/blocked props onto clear land', () => {
  const assets = deliveredTownBounds()
  const before = JSON.stringify(expandedIsland.plots)
  const plan = planTown(expandedIsland.plots, expandedIsland, assets)
  assert.equal(JSON.stringify(expandedIsland.plots),before)
  assert.equal(plan.plots.length,expandedIsland.plots.length)
  const buildings = plan.plots.filter((plot)=>plot.style)
  assert.equal(buildings.length,17)
  assert.equal(buildings.filter((plot)=>plot.relocated).length,3)
  assert.equal(buildings.filter((plot)=>plot.theme!=='home').length,4)
  for (const plot of buildings) {
    const style=plan.styles.get(plot.style)
    const detail=architectureFor(plot,style)
    assert.equal(plot.model,expandedIsland.plots[plot.sourceIndex].model)
    assert.ok([Tile.Grass,Tile.Sand].includes(islandTileAt(expandedIsland,plot.x,plot.z)))
    assert.ok(detail.door.width>=1.25 && detail.door.height>=RESIDENT_HEIGHT)
    assert.ok(Math.abs(remapBuildingY(0.27,style.fit)*plot.scale-2.45)<0.16)
    const halfLot=style.scope==='land'?TILE:TILE/2
    const inverse=new THREE.Matrix4().makeRotationY(plot.rotation).setPosition(plot.x,0,plot.z).invert()
    for(const x of [detail.totalBounds.min.x,detail.totalBounds.max.x])for(const z of [detail.totalBounds.min.z,detail.totalBounds.max.z]){
      const local=new THREE.Vector3(x,0,z).applyMatrix4(inverse)
      assert.ok(Math.abs(local.x)<=halfLot+0.025,`side facade ${plot.model} ${local.x} > ${halfLot}`)
      assert.ok(Math.abs(local.z)<=halfLot+0.025,`front facade ${plot.model} ${local.z} > ${halfLot}`)
    }
    const approach=style.scope==='land'?TILE*1.5:TILE
    assert.ok([Tile.Road,Tile.Plaza,Tile.Dock].includes(islandTileAt(expandedIsland,
      plot.x+Math.sin(plot.rotation)*approach,plot.z+Math.cos(plot.rotation)*approach)))
  }
  const harbor=buildings.filter((plot)=>plot.relocated)
  for(let i=0;i<harbor.length;i++)for(let j=i+1;j<harbor.length;j++){
    assert.ok(Math.hypot(harbor[i].x-harbor[j].x,harbor[i].z-harbor[j].z)>=TILE)
  }
  assert.ok(plan.plots.some((plot)=>!plot.style&&plot.relocated))
})

const expandedIsland = buildIsland(hashSeed('giving-garden-island'))
const expandedHomes = assignHomeTiles(expandedIsland,
  spacingBaseline.groups.map((group) => group.id), spacingBaseline.groups.map((group) => group.share))

test('expanded island doubles usable land area while preserving exact coastline, routes and home slots', () => {
  assert.equal(TILE, 3.4)
  assert.equal(GRID, spacingBaseline.grid)
  assert.deepEqual([...expandedIsland.tiles], spacingBaseline.tiles)
  assert.deepEqual(expandedIsland.walkable, spacingBaseline.walkable)
  assert.deepEqual(expandedIsland.links, spacingBaseline.links)
  assert.deepEqual([...expandedHomes], spacingBaseline.homes)
  const area = expandedIsland.tiles.filter((kind) => kind !== Tile.Water).length * TILE * TILE
  assert.ok(Math.abs(area - 3572.04) < 1e-8)
  assert.ok(Math.abs(area / spacingBaseline.landArea - ISLAND_SPACING ** 2) < 1e-12)
  assert.equal(RESIDENT_HEIGHT, 2.4)
  assert.equal(BUILDING_SCALE, 2.6)
  assert.ok(TILE * 0.26 + RESIDENT_ANCHORS.pickRadius < TILE / 2,
    'even the outermost lane plus picking radius must fit inside the widened road')
})

test('spacing preserves plot/decor RNG decisions and physical sizes while widening their world positions', () => {
  assert.equal(expandedIsland.plots.length, spacingBaseline.plots.length)
  expandedIsland.plots.forEach((plot, index) => {
    const before = spacingBaseline.plots[index]
    assert.deepEqual({ ...plot, x: 0, z: 0 }, { ...before, x: 0, z: 0 })
    assert.ok(Math.abs(plot.x - before.x * ISLAND_SPACING) < 1e-10)
    assert.ok(Math.abs(plot.z - before.z * ISLAND_SPACING) < 1e-10)
  })
  expandedIsland.lamps.forEach((lamp, index) => {
    const before = spacingBaseline.lamps[index]
    assert.ok(Math.abs(lamp.x - before.x * ISLAND_SPACING) < 1e-10)
    assert.ok(Math.abs(lamp.z - before.z * ISLAND_SPACING) < 1e-10)
  })
})

test('rebuilt shoreline field covers the enlarged mask with physical sampling density and offshore padding', () => {
  const field = buildDistanceField(expandedIsland)
  const scale = field.size / (GRID + 32)
  assert.ok(Math.abs(field.extent - 103.7) < 1e-10)
  assert.ok(2 * field.extent / field.size <= 0.6)
  for (let index = 0; index < expandedIsland.tiles.length; index++) {
    const sx = (index % GRID + 16) * scale + Math.floor(scale / 2)
    const sz = (Math.floor(index / GRID) + 16) * scale + Math.floor(scale / 2)
    const distance = field.data[sz * field.size + sx]
    assert.ok(Number.isFinite(distance))
    assert.equal(distance === 0, expandedIsland.tiles[index] !== Tile.Water)
  }
  for (let i = 0; i < field.size; i++) {
    // All field boundaries are well beyond the shader's 26-unit shallow-water band.
    for (const offset of [i, (field.size - 1) * field.size + i, i * field.size, i * field.size + field.size - 1]) {
      assert.ok(field.data[offset] > 26)
    }
  }
})

test('overview camera fits all enlarged shore corners and retains close resident inspection', () => {
  const camera = new THREE.PerspectiveCamera(ISLAND_VIEW.fov, 1056 / 900, 1, 900)
  camera.position.fromArray(ISLAND_VIEW.position)
  camera.lookAt(...ISLAND_VIEW.target)
  camera.updateMatrixWorld(true)
  for (let index = 0; index < expandedIsland.tiles.length; index++) {
    if (expandedIsland.tiles[index] === Tile.Water) continue
    const { x, z } = tileToWorld(index)
    for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
      const projected = new THREE.Vector3(x + dx * TILE, 0.12, z + dz * TILE).project(camera)
      assert.ok(Math.abs(projected.x) < 0.97 && Math.abs(projected.y) < 0.97)
    }
  }
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...ISLAND_VIEW.target)) < ISLAND_VIEW.maxDistance)
  assert.equal(ISLAND_VIEW.minDistance, 18)
})

test('expanded simulation keeps stable member lookup, intended speed and cascade activity semantics', () => {
  const ids = [7, 51, 108, 207, 312]
  const members = ids.map((id, index) => ({ id, groupId: spacingBaseline.groups[index].id, onIsland: true }))
  members.push({ id: 499, groupId: 'students', onIsland: false })
  const sim = new IslandSim(members, expandedIsland, expandedHomes, 1234, { min: 0.5, max: 0.75 })
  assert.equal(sim.count, ids.length)
  ids.forEach((id, index) => { assert.equal(sim.memberOfIndex(index), id); assert.equal(sim.indexOfMember(id), index) })
  assert.equal(sim.indexOfMember(499), undefined)
  const positions = ids.map((_, index) => [sim.x[index], sim.z[index]])
  sim.applyRound({ exposed: [51, 499], acted: [], ignored: [], shares: [] })
  assert.equal(sim.activity[1], Activity.OnPhone)
  sim.update(0.02)
  ids.forEach((_, index) => {
    const distance = Math.hypot(sim.x[index] - positions[index][0], sim.z[index] - positions[index][1])
    if (index === 1) assert.equal(distance, 0)
    else assert.ok(Math.abs(distance - sim.locomotionSpeed(index) * 0.02) < 1e-5)
    assert.ok(sim.locomotionSpeed(index) >= 0.5 && sim.locomotionSpeed(index) <= 0.75)
  })
})

const surfaceKinds = { Water: 0, Grass: 1, Sand: 2, Road: 3, Plaza: 4, Dock: 5 }

test('coastline details cover exposed perimeter without internal tile borders or mutating the mask', () => {
  const tiles = new Uint8Array(9)
  tiles[4] = surfaceKinds.Grass
  tiles[5] = surfaceKinds.Grass
  const before = tiles.slice()
  const details = surfaceBorders(tiles, 3, 2.4, surfaceKinds)
  assert.deepEqual(tiles, before)
  assert.deepEqual(details, surfaceBorders(tiles, 3, 2.4, surfaceKinds))
  const wallSegments = details.filter((detail) => detail.kind === 'wall' && Math.max(detail.width, detail.depth) > 1)
  assert.equal(wallSegments.length, 6)
  assert.ok(!wallSegments.some((detail) => Math.abs(detail.x - 1.2) < 1e-9 && Math.abs(detail.z) < 1e-9))
  assert.equal(details.filter((detail) => detail.kind === 'curb').length, 0)
})

test('path curbs stay outside movement lanes and road-plaza connections stay flush', () => {
  const tiles = new Uint8Array(9)
  tiles[4] = surfaceKinds.Road
  tiles[5] = surfaceKinds.Grass
  tiles[3] = surfaceKinds.Plaza
  const details = surfaceBorders(tiles, 3, 2.4, surfaceKinds)
  const curbs = details.filter((detail) => detail.kind === 'curb')
  assert.equal(curbs.length, 2)
  assert.ok(curbs.every((detail) => detail.x - detail.width / 2 >= 1.2 - 0.02))
  assert.ok(!curbs.some((detail) => detail.x < 0))
  const paving = details.filter((detail) => detail.kind === 'paving')
  assert.ok(paving.every((detail) => detail.y + detail.height / 2 < 0.03))
})

test('dock railings protect exposed sides while keeping land approaches open and posts unique', () => {
  const tiles = new Uint8Array(9)
  tiles[4] = surfaceKinds.Dock
  tiles[1] = surfaceKinds.Road
  const details = surfaceBorders(tiles, 3, 2.4, surfaceKinds)
  const rails = details.filter((detail) => detail.kind === 'rail')
  assert.equal(rails.length, 3)
  assert.ok(!rails.some((detail) => detail.z === -1.2))
  const posts = details.filter((detail) => detail.kind === 'post')
  assert.equal(posts.length, 4)
  assert.equal(new Set(posts.map((detail) => `${detail.x},${detail.z}`)).size, posts.length)
})

test('production visual identities are stable under reorder, legacy values and UI changes', () => {
  const members = Array.from({ length: 500 }, (_, id) => ({ id, model: 'legacy-missing-model' }))
  const before = new Map(members.map((member) => [member.id, residentAppearance(member, 'profile:1')]))
  for (const member of [...members].reverse()) {
    assert.equal(residentAppearance(member, 'profile:1'), before.get(member.id))
    assert.equal(residentAppearance({ ...member, name: 'Changed name', groupId: 'changed', model: 'character-female-a' }, 'profile:1'), before.get(member.id))
  }
  for (const id of RESIDENT_IDS) {
    assert.equal(residentAppearance({ id: 99, model: `mii:${id}` }, 'profile:1'), id)
    assert.equal(residentAppearance({ id: 99, model: id }, 'other:9'), id)
  }
  assert.equal(new Set(before.values()).size, 20)
  assert.notEqual(residentPhase(1, 'profile:1'), residentPhase(2, 'profile:1'))
  assert.ok(members.some((member) => residentAppearance(member, 'other:1') !== before.get(member.id)))
})

function productionController(phase = 0.137) {
  const root = new THREE.Group()
  const hip = new THREE.Bone()
  hip.name = 'hip'
  root.add(hip)
  const clips = ['test_Idle', 'test_walk', 'test_wave'].map((name) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('hip.position', [0, 0.5, 1], [0,0,0, 0,0.1,0, 0,0,0]),
  ]))
  return new ResidentController(root, clips, 0.6, phase)
}

test('production budget debt preserves activity boundaries, walk cadence and idle real time', () => {
  const delayed = productionController()
  const immediate = productionController()
  for (const [dt, activity, speed] of [[0.1,0,0.6], [0.1,0,0.6], [0.07,1,0], [0.14,1,0]]) {
    delayed.sample(dt, activity, speed)
    immediate.sample(dt, activity, speed)
    immediate.advance()
  }
  delayed.advance()
  assert.deepEqual(delayed.snapshot(), immediate.snapshot())
  assert.equal(delayed.snapshot().clip, 'test_Idle')
  assert.ok(Math.abs(delayed.snapshot().totalWeight - 1) < 1e-12)
  const idleBefore = delayed.snapshot().idleTime
  delayed.sample(0.2, 2, 0)
  delayed.advance()
  assert.ok(Math.abs(delayed.snapshot().idleTime - idleBefore - 0.2) < 1e-12)
  const paused = delayed.snapshot()
  delayed.sample(0, 0, 10)
  delayed.advance()
  assert.deepEqual(delayed.snapshot(), paused)
})

test('rapid production reversals retain full weights and sharing waves restart once per entry', () => {
  const controller = productionController()
  for (let i = 0; i < 20; i++) {
    controller.sample(0.025, i % 2, 0.6)
    controller.advance()
    assert.ok(Math.abs(controller.snapshot().totalWeight - 1) < 1e-12)
  }
  controller.sample(0.25, 4, 0)
  controller.advance()
  assert.ok(Math.abs(controller.actions.get('test_wave').time - 0.25) < 1e-12)
  controller.sample(0.02, 1, 0)
  controller.advance()
  controller.sample(0.04, 4, 0)
  controller.advance()
  assert.ok(Math.abs(controller.actions.get('test_wave').time - 0.04) < 1e-12)
  controller.sample(1.2, 4, 0)
  controller.advance()
  assert.equal(controller.snapshot().clip, 'test_Idle')
  controller.sample(0.4, 4, 0)
  controller.advance()
  assert.equal(controller.snapshot().clip, 'test_Idle')
  assert.ok(Math.abs(controller.snapshot().totalWeight - 1) < 1e-12)
})

test('walk cadence changes independently of fade duration and resumes its phase', () => {
  const controller = productionController()
  controller.sample(0.2, 0, 1.2)
  controller.advance()
  assert.ok(Math.abs(controller.snapshot().walkTime - (0.137 + 0.4)) < 1e-12)
  controller.sample(0.2, 1, 0)
  controller.advance()
  controller.sample(0.02, 0, 0.6)
  controller.advance()
  assert.ok(Math.abs(controller.snapshot().walkTime - (0.137 + 0.42)) < 1e-12)
  assert.ok(Math.abs(controller.snapshot().totalWeight - 1) < 1e-12)
})

test('template leases survive StrictMode replay and dispose after abandoned async loads', async () => {
  let finish
  let created = 0
  let disposed = 0
  const pool = new SharedResource(() => { created++; return new Promise((resolve) => { finish = resolve }) }, () => { disposed++ })
  const first = pool.acquire()
  first.release()
  const replay = pool.acquire()
  await Promise.resolve()
  assert.equal(created, 1)
  finish({ prepared: true })
  await replay.ready
  assert.equal(disposed, 0)
  replay.release()
  replay.release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(disposed, 1)
  const abandoned = pool.acquire()
  abandoned.release()
  await Promise.resolve()
  finish({ prepared: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(created, 2)
  assert.equal(disposed, 2)
})

test('budget updates selected and transitioning residents, defers offscreen time and pauses cleanly', () => {
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 900)
  camera.position.set(0, 48, 60)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const budget = new AnimationBudget()
  const elapsed = [0, 0, 0]
  const rigs = elapsed.map((_, index) => ({ owed: 0, urgent: index === 1, advance(dt) { elapsed[index] += dt } }))
  const x = new Float32Array([1000,1000,1000])
  const z = new Float32Array([1000,1000,1000])
  for (let i = 0; i < 8; i++) budget.step(rigs, camera, 0.02, x, z, 0)
  assert.ok(Math.abs(elapsed[0] - 0.16) < 1e-12)
  assert.ok(Math.abs(elapsed[1] - 0.16) < 1e-12)
  assert.ok(elapsed[2] > 0 && elapsed[2] <= 0.16)
  assert.ok(Math.abs(elapsed[2] + rigs[2].owed - 0.16) < 1e-12)
  const before = [...elapsed]
  budget.step(rigs, camera, 0, x, z, 0)
  assert.deepEqual(elapsed, before)
})

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

test('failed template preparation releases cloned skeletons and preserves source resources', () => {
  const source = fixture()
  const mesh = source.children.find((node) => node.isSkinnedMesh)
  mesh.material.normalMap = new THREE.Texture()
  const dispose = THREE.Skeleton.prototype.dispose
  let disposed = 0
  let geometryDisposed = false
  mesh.geometry.addEventListener('dispose', () => { geometryDisposed = true })
  THREE.Skeleton.prototype.dispose = function () { disposed++; dispose.call(this) }
  try {
    assert.throws(() => prepareResidentTemplate(source), /material features/)
    // One redundant part skeleton is freed during clone sharing; the final
    // shared clone is freed by the failed preparation's cleanup.
    assert.equal(disposed, 2)
    assert.equal(geometryDisposed, false)
  } finally { THREE.Skeleton.prototype.dispose = dispose }
})

function playback(phase = 0) {
  const root = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'hip'
  root.add(bone)
  const clips = ['test_Idle', 'test_walk'].map((name) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('hip.position', [0, 0.5, 1], name === 'test_walk'
      ? [0,0,0, 0,0.1,0, 0,0,0] : [0,0,0, 0,0,0, 0,0,0]),
  ]))
  return new ResidentPlayback(root, clips, { strideLength: 0.44, cycleSeconds: 1 }, phase)
}

test('walk cadence and travel scale together, including independent phases and pause', () => {
  for (const speed of [0.5, 1, 1.5]) {
    const player = playback(0.137)
    player.select('test_walk')
    assert.ok(Math.abs(player.step(0.2, speed) - 0.44 * 0.2 * speed) < 1e-12)
    assert.ok(Math.abs(player.snapshot().time - (0.137 + 0.2 * speed)) < 1e-12)
    const paused = player.snapshot()
    assert.equal(player.step(0, speed), 0)
    assert.deepEqual(player.snapshot(), paused)
    player.dispose()
  }
})

test('Idle/Walk fades last 0.18 real seconds and rapid reversals keep a complete pose', () => {
  const player = playback()
  player.select('test_Idle')
  player.select('test_walk')
  const distance = player.step(0.09, 1.5)
  assert.ok(Math.abs(player.snapshot().walkWeight - 0.5) < 1e-12)
  assert.ok(Math.abs(distance - 0.44 * 0.09 * 1.5 * 0.25) < 1e-12)
  for (let i = 0; i < 24; i++) {
    player.select(i % 2 ? 'test_walk' : 'test_Idle')
    player.step(0.025, 0.5)
    assert.ok(Math.abs(player.snapshot().totalWeight - 1) < 1e-12)
  }
  player.select('test_Idle')
  player.step(0.18, 0.5)
  assert.equal(player.snapshot().walkWeight, 0)
  assert.equal(player.step(0.1, 1.5), 0)
  player.select('test_walk')
  player.step(0.18, 0.5)
  assert.equal(player.snapshot().walkWeight, 1)
  assert.equal(player.snapshot().totalWeight, 1)
  player.select('')
  assert.equal(player.snapshot().totalWeight, 0)
  assert.equal(player.step(0.1, 1), 0)
  player.dispose()
})

test('missing or inconsistent walk metadata fails instead of silently sliding', () => {
  const clip = new THREE.AnimationClip('test_walk', 1, [])
  for (const walk of [{ strideLength: 0, cycleSeconds: 1 }, { strideLength: 0.44, cycleSeconds: 2 }]) {
    assert.throws(() => new ResidentPlayback(new THREE.Group(), [clip], walk), /metadata must agree/)
  }
})
