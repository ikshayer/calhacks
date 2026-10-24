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
import { planLandscape, walkCorridors, WALK_CLEARANCE } from '../src/island/landscapePlanning.ts'
import { createFountainGeometry, FOUNTAIN_RADIUS, FOUNTAIN_POOL_Y } from '../src/island/fountainGeometry.ts'
import { createLeafCardBatch, leafSurfaces, sampleLeafCards } from '../src/island/leafCards.ts'
import { planGrassLeaves } from '../src/island/grassLeaves.ts'
import { buildElevatedIsland, groundHeight, groundTile, surfaceHeight, continuousEdge, validateGroundGraph, TERRACE_HEIGHT } from '../src/island/scene/ground.ts'
import { createTerrainGeometry, createRetainingGeometry } from '../src/island/terrainGeometry.ts'
import { entrancePaving } from '../src/island/townArchitecture.ts'
import { createGroundRings, updateGroundRing } from '../src/island/fx/groundRings.ts'

test('inland terrace preserves source coast/plots and joins every harbor with real land approaches', () => {
  const seed = hashSeed('giving-garden-island'), flat = buildIsland(seed), elevated = buildElevatedIsland(seed)
  assert.deepEqual(elevated.tiles, flat.tiles)
  assert.deepEqual(elevated.plots.map(({ y: _y, ...plot }) => plot), flat.plots)
  assert.deepEqual(elevated.lamps.map(({ y: _y, ...lamp }) => lamp), flat.lamps)
  assert.deepEqual(buildDistanceField(elevated), buildDistanceField(flat))
  assert.equal(Math.max(...elevated.surfaces), Math.fround(TERRACE_HEIGHT))
  assert.equal(elevated.connectors.length, 6)
  assert.ok(flat.walkable.every(tile => elevated.walkable.includes(tile)))
  assert.equal(elevated.walkable.length, 122)
  assert.doesNotThrow(() => validateGroundGraph(elevated))
  const homes = assignHomeTiles(elevated, ['a','b','c'], [40,35,25])
  assert.deepEqual(homes, assignHomeTiles(buildElevatedIsland(seed), ['a','b','c'], [40,35,25]))
  assert.equal(new Set([...homes.values()].flat()).size, elevated.walkable.length)
  elevated.tiles.forEach((kind, tile) => {
    if ([Tile.Water, Tile.Sand, Tile.Dock, Tile.Plaza].includes(kind)) {
      assert.deepEqual([...elevated.surfaces.slice(tile * 4, tile * 4 + 4)], [0,0,0,0])
    }
  })
  for (const tile of elevated.connectors) assert.notEqual(elevated.tiles[tile], Tile.Water)
  elevated.walkable.forEach((tile, slot) => {
    for (const next of elevated.links[slot]) {
      const other = elevated.walkable[next]
      assert.ok(continuousEdge(elevated, tile, other))
      const a = tileToWorld(tile), b = tileToWorld(other)
      const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z)
      for (const lane of [-WALK_CLEARANCE, 0, WALK_CLEARANCE]) {
        const x = (a.x + b.x) / 2 - dz * lane, z = (a.z + b.z) / 2 + dx * lane
        assert.ok(Math.abs(surfaceHeight(elevated, tile, x, z) - surfaceHeight(elevated, other, x, z)) < 1e-6)
      }
    }
  })
  const broken = { ...elevated, links: elevated.links.map(links => [...links]) }
  broken.links[0] = []
  assert.throws(() => validateGroundGraph(broken), /Stranded|Invalid/)
  const tooSteep = { ...elevated, surfaces: elevated.surfaces.slice() }
  tooSteep.surfaces[elevated.walkable[0] * 4 + 1] += TILE
  assert.throws(() => validateGroundGraph(tooSteep), /grade limit/)
})

test('rendered top triangles match the height sampler across terrace ramps and retaining faces clear lanes', () => {
  const island = buildElevatedIsland(hashSeed('giving-garden-island'))
  const geometry = createTerrainGeometry(island), retaining = createRetainingGeometry(island)
  const position = geometry.attributes.position, color = geometry.attributes.color
  assert.equal(position.count, island.tiles.filter(kind => kind !== Tile.Water).length * 30)
  assert.equal(color.count, position.count)
  const tileIndices = Array.from(island.tiles).flatMap((kind, tile) => kind === Tile.Water ? [] : [tile])
  for (const [slot, tile] of tileIndices.entries()) for (const triangle of [0, 3]) {
    const vertices = [0,1,2].map(i => new THREE.Vector3().fromBufferAttribute(position, slot * 30 + triangle + i))
    for (const weights of [[0.2,0.3,0.5], [0.7,0.1,0.2]]) {
      const p = vertices.reduce((sum, vertex, i) => sum.addScaledVector(vertex, weights[i]), new THREE.Vector3())
      assert.ok(Math.abs(p.y - surfaceHeight(island, tile, p.x, p.z)) < 1e-5)
    }
  }
  const corridors = walkCorridors(island)
  const wallPosition = retaining.attributes.position
  assert.ok(wallPosition.count > 0)
  for (let i = 0; i < wallPosition.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(wallPosition, i)
    assert.ok(!corridors.some(bounds => bounds.containsPoint(point)), `retaining face clips a full lane at ${point.toArray()}`)
  }
  for (let at = 0; at < wallPosition.count; at += 12) {
    const a = new THREE.Vector3().fromBufferAttribute(wallPosition, at)
    const b = new THREE.Vector3().fromBufferAttribute(wallPosition, at + 1)
    const coordinate = Math.abs(a.x - b.x) < 1e-6 ? a.x : a.z
    const nearestSide = (Math.round(coordinate / TILE + GRID / 2) - GRID / 2) * TILE
    assert.ok(Math.abs(Math.abs(coordinate - nearestSide) - 0.012) < 2e-6, 'wall finish must not coincide with terrain sides')
  }
  geometry.dispose(); retaining.dispose()
})

test('elevated final town, approaches, landscape and dense grass meet ground and keep repaired routes clear', () => {
  const island = buildElevatedIsland(hashSeed('giving-garden-island')), assets = deliveredTownBounds()
  const town = planTown(island.plots, island, assets), landscape = planLandscape(island, town, assets)
  const corridors = walkCorridors(island)
  for (const plot of landscape.plots) {
    assert.ok(Math.abs((plot.y ?? 0) - groundHeight(island, plot.x, plot.z)) < 1e-6)
    const bounds = plot.style ? architectureFor(plot, town.styles.get(plot.style), island).totalBounds
      : new THREE.Box3().union(assets.get(plot.model).reduce((result, part) => result.union(
        new THREE.Box3().setFromBufferAttribute(part.geometry.attributes.position).applyMatrix4(placedStaticMatrix(plot, part.matrix))), new THREE.Box3()))
    assert.ok(!corridors.some(corridor => corridor.intersectsBox(bounds)), `${plot.model} overlaps a lane`)
    if (plot.style) {
      const detail = architectureFor(plot, town.styles.get(plot.style), island)
      const base = new THREE.Matrix4().makeRotationY(plot.rotation).setPosition(plot.x, plot.y, plot.z)
      const footprint = detail.footprint
      const stepsX = Math.ceil((footprint.max.x - footprint.min.x) / 0.25)
      const stepsZ = Math.ceil((footprint.max.z - footprint.min.z) / 0.25)
      for (let ix = 0; ix <= stepsX; ix++) for (let iz = 0; iz <= stepsZ; iz++) {
        const point = new THREE.Vector3(THREE.MathUtils.lerp(footprint.min.x, footprint.max.x, ix / stepsX), 0,
          THREE.MathUtils.lerp(footprint.min.z, footprint.max.z, iz / stepsZ)).applyMatrix4(base)
        assert.ok(Math.abs(groundHeight(island, point.x, point.z) - plot.y) < 1e-6, `${plot.model} footprint spans different ground heights`)
      }
      const paving = entrancePaving(plot, town.styles.get(plot.style), island)
      assert.ok(paving.length > 0)
      for (const part of paving) {
        const e = part.matrix.elements
        assert.ok(Math.abs(e[13] - groundHeight(island, e[12], e[14]) - 0.018) < 1e-6)
        for (const x of [-0.5, 0, 0.5]) for (const z of [-0.5, 0, 0.5]) {
          const point = new THREE.Vector3(x, 0, z).applyMatrix4(part.matrix)
          assert.ok(Math.abs(point.y - groundHeight(island, point.x, point.z) - 0.018) < 1e-5,
            `${plot.model} ${plot.sourceIndex} paving slab crosses a grade break: ${point.toArray()} ground=${groundHeight(island, point.x, point.z)}`)
        }
      }
    }
  }
  for (const obstacle of landscape.obstacles) assert.ok(!corridors.some(corridor => corridor.intersectsBox(obstacle.bounds)))
  const blocked = [...corridors, ...landscape.buildingBounds, ...landscape.approaches, ...landscape.obstacles.map(o => o.bounds)]
  const grass = planGrassLeaves(island, blocked)
  assert.ok(grass.patches.length >= 10)
  assert.ok(grass.cards.length > 10000)
  for (const card of grass.cards) {
    const e = card.matrix.elements
    assert.ok(Math.abs(e[13] - groundHeight(island, e[12], e[14]) - 0.004) < 1e-6)
  }
})

test('residents keep 3D walk speed on ramp grades and ground rings follow every sampled vertex', () => {
  const island = buildElevatedIsland(hashSeed('giving-garden-island'))
  const tile = groundTile(-5 * TILE, -8 * TILE), from = island.walkable.indexOf(tile)
  const to = island.walkable.indexOf(tile + 1)
  const sim = new IslandSim([{ id: 91, groupId: 'a', onIsland: true }], island,
    new Map([['a', [from, to]]]), 77, { min: 0.6, max: 0.6 })
  // A chosen segment exercises both lanes without waiting for a random walk.
  sim.fromNode[0] = from; sim.toNode[0] = to; sim.progress[0] = 0.2; sim.lane[0] = TILE * 0.26
  sim.measureSegment(0); sim.writePosition(0)
  const before = new THREE.Vector3(sim.x[0], sim.y[0], sim.z[0])
  sim.update(0.05)
  assert.ok(Math.abs(before.distanceTo(new THREE.Vector3(sim.x[0], sim.y[0], sim.z[0])) - 0.03) < 2e-6)
  assert.ok(Math.abs(sim.y[0] - sim.groundHeight(sim.x[0], sim.z[0])) < 1e-6)
  const { geometry, source } = createGroundRings(1, 1, 32)
  updateGroundRing(geometry, source, 0, sim, 0, 1.07, 0.06)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) assert.ok(Math.abs(p.getY(i) - sim.groundHeight(p.getX(i), p.getZ(i)) - 0.06) < 1e-6)
  for (let i = 0; i < p.count; i++) assert.ok(sim.continuousGroundSpan(sim.x[0], sim.z[0], p.getX(i), p.getZ(i)),
    'ring vertices must stay on a continuous surface rather than stretch through retaining walls')
  const maxRadius = Math.max(...Array.from({ length: p.count }, (_, i) => Math.hypot(p.getX(i) - sim.x[0], p.getZ(i) - sim.z[0])))
  assert.ok(maxRadius < 1.0, 'the outer-lane ring must shrink before its circle reaches the ramp side cliff')
  geometry.dispose()
  sim.applyRound({ exposed: [91], acted: [], ignored: [], shares: [] })
  const stopped = [sim.x[0], sim.y[0], sim.z[0]]; sim.update(0.1)
  assert.deepEqual([sim.x[0], sim.y[0], sim.z[0]], stopped)
  const crowd = new IslandSim(Array.from({ length: 48 }, (_, id) => ({ id, groupId: 'a', onIsland: true })),
    island, new Map(), 123, { min: 0.5, max: 0.75 })
  for (let frame = 0; frame < 2400; frame++) {
    crowd.update(0.05)
    for (let i = 0; i < crowd.count; i++) {
      const tile = groundTile(crowd.x[i], crowd.z[i])
      assert.ok(tile >= 0)
      assert.notEqual(island.tiles[tile], Tile.Water)
      assert.ok(Math.abs(crowd.y[i] - groundHeight(island, crowd.x[i], crowd.z[i])) < 1e-6)
    }
  }
})

test('grass beds span adjoining tiles, stay connected and keep paths, doors, buildings and furniture clear', () => {
  const island = buildIsland(hashSeed('giving-garden-island'))
  const town = planTown(island.plots, island, deliveredTownBounds())
  const landscape = planLandscape(island, town, deliveredTownBounds())
  const blocked = [...landscape.corridors, ...landscape.buildingBounds, ...landscape.approaches, ...landscape.obstacles.map(item => item.bounds)]
  const before = JSON.stringify(island)
  const grass = planGrassLeaves(island, blocked)
  assert.deepEqual(grass, planGrassLeaves(island, blocked))
  assert.equal(JSON.stringify(island), before)
  assert.ok(grass.patches.length >= 10 && grass.patches.length <= 18)
  const tufts = grass.patches.reduce((sum, patch) => sum + patch.tufts.length, 0)
  assert.ok(grass.cards.length >= tufts * 6 && grass.cards.length <= tufts * 8)
  for (const patch of grass.patches) {
    assert.ok(patch.tiles.length >= 2, 'a bed must extend across adjoining grass tiles')
    assert.ok(patch.tufts.length >= 28, 'a bed must read as a substantial planting')
    const connected = new Set([0])
    const queue = [0]
    for (const at of queue) {
      patch.tufts.forEach((tuft, index) => {
        if (connected.has(index) || Math.hypot(tuft.x - patch.tufts[at].x, tuft.z - patch.tufts[at].z) > 0.60) return
        connected.add(index)
        queue.push(index)
      })
    }
    assert.equal(connected.size, patch.tufts.length, 'no detached sprigs may escape a bed')
  }
  const unitLeaf = new THREE.Box3(new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.5, 1, 0))
  for (const card of grass.cards) {
    const bounds = unitLeaf.clone().applyMatrix4(card.matrix)
    assert.ok(bounds.min.y >= 0.003 && bounds.max.y < 0.48)
    assert.ok(!blocked.some(box => box.intersectsBox(bounds)))
    for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
      assert.equal(islandTileAt(island, x, z), Tile.Grass)
    }
  }
})

test('grass beds require shared grass edges and cannot bridge a blocked seam', () => {
  const tiles = new Uint8Array(GRID * GRID)
  const center = Math.floor(GRID / 2) * GRID + Math.floor(GRID / 2)
  const island = { tiles, plots: [], walkable: [], links: [], lamps: [] }
  tiles[center] = Tile.Grass
  tiles[center + GRID + 1] = Tile.Grass
  assert.equal(planGrassLeaves(island, []).cards.length, 0, 'diagonal grass tiles are separate lawns')
  tiles[center + GRID + 1] = Tile.Water
  tiles[center + 1] = Tile.Grass
  const grass = planGrassLeaves(island, [])
  assert.equal(grass.patches.length, 1)
  assert.deepEqual([...grass.patches[0].tiles].sort((a, b) => a - b), [center, center + 1])
  const barrier = new THREE.Box3(new THREE.Vector3(TILE / 2 - 0.2, -1, -TILE), new THREE.Vector3(TILE / 2 + 0.2, 1, TILE))
  assert.equal(planGrassLeaves(island, [barrier]).cards.length, 0, 'a blocked seam cannot connect the planting')
  tiles.fill(Tile.Water)
  assert.deepEqual(planGrassLeaves(island, []), { cards: [], patches: [] })
})

test('leaf cards attach reproducibly to transformed green surfaces and respect blocked routes', () => {
  const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
  const before = [...geometry.attributes.position.array]
  const matrix = new THREE.Matrix4().makeRotationY(0.6).scale(new THREE.Vector3(2, 1, 3)).setPosition(7, 2, -4)
  const green = new THREE.Color('#4d965d')
  const surfaces = leafSurfaces(geometry, matrix, () => green)
  assert.ok(Math.abs(surfaces.reduce((sum, surface) => sum + surface.area, 0) - 24) < 1e-6)
  const cards = sampleLeafCards(surfaces, 'test-tree', 'tree')
  const repeat = sampleLeafCards(surfaces, 'test-tree', 'tree')
  assert.ok(cards.length > 100)
  assert.deepEqual(cards, repeat)
  for (const card of cards) {
    assert.ok(card.matrix.determinant() > 0)
    assert.ok(card.matrix.elements.every(Number.isFinite))
    assert.ok(Math.abs(card.matrix.elements[13] - 1.994) < 1e-5, 'leaf stems must start at the sampled surface')
  }
  const blocked = new THREE.Box3(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100))
  assert.equal(sampleLeafCards(surfaces, 'test-tree', 'tree', [blocked]).length, 0)
  assert.equal(leafSurfaces(geometry, matrix, () => green, 1.5).length, 0)
  assert.equal(leafSurfaces(geometry, matrix, () => new THREE.Color('#a96d3e')).length, 0)
  assert.deepEqual([...geometry.attributes.position.array], before)
  geometry.dispose()
})

test('leaf cutouts are one opaque instanced batch with transparent margins and complete cleanup', () => {
  const geometry = new THREE.SphereGeometry(0.5, 8, 6).translate(0, 1, 0)
  const cards = sampleLeafCards(leafSurfaces(geometry, new THREE.Matrix4(), () => new THREE.Color('#548653')), 'test-bush', 'bush')
  const batch = createLeafCardBatch(cards)
  assert.equal(batch.mesh.count, cards.length)
  assert.equal(batch.material.transparent, false)
  assert.ok(batch.material.alphaTest > 0)
  assert.equal(batch.material.side, THREE.DoubleSide)
  assert.equal(batch.texture.image.data[3], 0)
  assert.ok(batch.texture.image.data.some((value, index) => index % 4 === 3 && value === 255))
  let released = 0
  for (const resource of [batch.mesh, batch.geometry, batch.material, batch.texture]) resource.addEventListener('dispose', () => released++)
  batch.dispose()
  assert.equal(released, 4)
  geometry.dispose()
})

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

test('fountain geometry stays inside its original footprint, lands water inside the basin and releases all owned geometry', () => {
  const fountain = createFountainGeometry()
  const geometries = [fountain.stone, fountain.trim, fountain.pools, fountain.streams, fountain.ripple]
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) {
      assert.ok([...attribute.array].every(Number.isFinite))
    }
  }
  for (const geometry of geometries.slice(0, 4)) {
    const bounds = geometry.boundingBox
    assert.ok(bounds.min.x >= -FOUNTAIN_RADIUS - 1e-5 && bounds.max.x <= FOUNTAIN_RADIUS + 1e-5)
    assert.ok(bounds.min.z >= -FOUNTAIN_RADIUS - 1e-5 && bounds.max.z <= FOUNTAIN_RADIUS + 1e-5)
    assert.ok(bounds.min.y >= -1e-5)
  }
  assert.equal(fountain.splashCenters.length, 6)
  for (const point of fountain.splashCenters) {
    assert.ok(Math.hypot(point.x, point.z) + 0.17 < 1.34, 'expanding splash rings must stay inside the pool')
    assert.ok(Math.abs(point.y - FOUNTAIN_POOL_Y - 0.012) < 1e-6)
  }
  let released = 0
  geometries.forEach(geometry => geometry.addEventListener('dispose', () => released++))
  fountain.dispose()
  assert.equal(released, 5)
})

test('landscape composition preserves seeded island data and keeps every new obstacle clear of lanes, doors and buildings', () => {
  const assets = deliveredTownBounds()
  const town = planTown(expandedIsland.plots, expandedIsland, assets)
  const sourceBefore = JSON.stringify({ island: expandedIsland, town: town.plots })
  const landscape = planLandscape(expandedIsland, town, assets)
  const repeat = planLandscape(expandedIsland, town, assets)
  assert.equal(JSON.stringify({ island: expandedIsland, town: town.plots }), sourceBefore)
  assert.deepEqual(landscape.summary, repeat.summary)
  assert.deepEqual(landscape.plots, repeat.plots)
  assert.deepEqual(landscape.parts.map(part => part.matrix.elements), repeat.parts.map(part => part.matrix.elements))
  assert.ok(landscape.summary.trees >= 12, JSON.stringify(landscape.summary))
  assert.ok(landscape.summary.coastBeds >= 5, JSON.stringify(landscape.summary))
  assert.ok(landscape.summary.coastalSeats >= 1, JSON.stringify(landscape.summary))
  assert.ok(landscape.summary.plazaSeats >= 2, JSON.stringify(landscape.summary))
  assert.equal(landscape.summary.urns, 4)
  for (const obstacle of landscape.obstacles) {
    assert.ok(!landscape.corridors.some(corridor => corridor.intersectsBox(obstacle.bounds)), `${obstacle.feature} intrudes into a lane`)
    assert.ok(!landscape.buildingBounds.some(bounds => bounds.intersectsBox(obstacle.bounds)), `${obstacle.feature} clips a building`)
    assert.ok(!landscape.approaches.some(bounds => bounds.intersectsBox(obstacle.bounds)), `${obstacle.feature} blocks a door`)
    for (const x of [obstacle.bounds.min.x, obstacle.bounds.max.x]) for (const z of [obstacle.bounds.min.z, obstacle.bounds.max.z]) {
      assert.notEqual(islandTileAt(expandedIsland, x, z), Tile.Water)
    }
  }
})

test('walking reservations cover both lane extremes and junction nodes without changing the graph', () => {
  const corridors = walkCorridors(expandedIsland)
  assert.ok(WALK_CLEARANCE > TILE * 0.26)
  for (const tile of expandedIsland.walkable) {
    const { x, z } = tileToWorld(tile)
    for (const [dx, dz] of [[WALK_CLEARANCE - 0.001, 0], [-WALK_CLEARANCE + 0.001, 0], [0, WALK_CLEARANCE - 0.001], [0, -WALK_CLEARANCE + 0.001]]) {
      assert.ok(corridors.some(bounds => bounds.containsPoint(new THREE.Vector3(x + dx, 0, z + dz))))
    }
  }
})

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
