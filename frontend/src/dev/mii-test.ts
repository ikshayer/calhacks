import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { cloneResident, disposeResidentSkeletons, prepareResidentTemplate, residentRenderStats } from '../island/residentRendering'
import { ResidentPlayback } from '../island/residentPlayback'
import residentCatalog from './residentCatalog.json'

type Result = { fps: number; p95FrameMs: number; frames: number; residents: number; clip: string; shadows: boolean; viewport: string; dpr: number; rendering: string; design: string; draws: number; skeletons: number; motion: string; speed: number }
const el = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}
const viewport = el('viewport')
const countInput = el<HTMLSelectElement>('count')
const designInput = el<HTMLSelectElement>('design')
const renderingInput = el<HTMLSelectElement>('rendering')
const labelLayer = el('labels')
const clipInput = el<HTMLSelectElement>('clip')
const motionInput = el<HTMLSelectElement>('motion')
const speedInput = el<HTMLInputElement>('speed')
const speedValue = el<HTMLOutputElement>('speed-value')
const pauseInput = el<HTMLInputElement>('paused')
const warmInput = el<HTMLInputElement>('warm')
const shadowInput = el<HTMLInputElement>('shadows')
const benchmark = el<HTMLButtonElement>('benchmark')
const status = el('status')
const metrics = el('metrics')
const result = el('result')
const debug = { loaded: false, count: 1, rendering: '', designs: [] as string[], clips: [] as string[], bones: 0, skeletons: 0, meshes: 0, triangles: 0, draws: 0, errors: [] as string[], results: [] as Result[],
  inspectMotion: () => playbacks.map(({ playback, wrapper, distance, scale }) => ({ ...playback.snapshot(), position: wrapper.position.toArray(), distance, scale })) }
declare global { interface Window { __miiTest: typeof debug } }
window.__miiTest = debug
const scene = new THREE.Scene()
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.08
viewport.append(renderer.domElement)
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 300)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2.05
const hemi = new THREE.HemisphereLight('#ffd2a0', '#3f7f88', 0.95)
const ambient = new THREE.AmbientLight('#ffbe84', 0.42)
const sun = new THREE.DirectionalLight('#ffa652', 3.2)
sun.position.set(-52, 44, 42)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 190 })
sun.shadow.bias = -0.0013
const fill = new THREE.DirectionalLight('#79b2d6', 0.8)
fill.position.set(48, 26, -40)
scene.add(hemi, ambient, sun, fill, sun.target, fill.target)
const floorMaterial = new THREE.MeshLambertMaterial({ color: '#c3855a' })
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.position.y = -0.015
floor.receiveShadow = true
scene.add(floor)
const markers = new THREE.GridHelper(160, 160, '#75826d', '#75826d')
markers.position.y = -0.012
markers.material.transparent = true
markers.material.opacity = 0.35
scene.add(markers)
const residents = new THREE.Group()
scene.add(residents)
const resize = () => {
  const { width, height } = viewport.getBoundingClientRect()
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(viewport)
resize()
function light() {
  const warm = warmInput.checked
  scene.background = new THREE.Color(warm ? '#f6a765' : '#d9e5eb')
  sun.color.set(warm ? '#ffa652' : '#ffffff')
  sun.intensity = warm ? 3.2 : 2
  ambient.color.set(warm ? '#ffbe84' : '#ffffff')
  hemi.color.set(warm ? '#ffd2a0' : '#ffffff')
  floorMaterial.color.set(warm ? '#c3855a' : '#93a59a')
}
warmInput.onchange = light
light()
let playbacks: { playback: ResidentPlayback; wrapper: THREE.Group; baseZ: number; distance: number; scale: number }[] = []
let roots: THREE.Object3D[] = []
let labels: { node: HTMLSpanElement; wrapper: THREE.Group }[] = []
let travelOrigin = 0
let followOffset = 0
function follow(offset: number) {
  const delta = offset - followOffset
  camera.position.z += delta
  controls.target.z += delta
  sun.position.z += delta
  sun.target.position.z += delta
  fill.position.z += delta
  fill.target.position.z += delta
  floor.position.z = offset
  followOffset = offset
}
function resetTravel() {
  for (const entry of playbacks) { entry.distance = 0; entry.wrapper.position.z = entry.baseZ }
  travelOrigin = 0
  follow(0)
}
const projected = new THREE.Vector3()
function setView(side = false) {
  cancelMeasurement()
  const count = Number(countInput.value)
  const lineupGrid = count === 6 || count === 10 || count === 20
  const distance = count === 1 ? 5.5 : count === 4 ? 12.5 : count === 20 ? 20 : lineupGrid ? 14 : 24
  camera.position.set(side ? distance : 0, count === 1 ? 1.8 : count === 4 ? 2.7 : count === 20 ? 14 : lineupGrid ? 10 : 14,
    followOffset + (side ? 0 : distance))
  controls.update()
}
el('front').onclick = () => setView()
el('side').onclick = () => setView(true)
let recent: number[] = []
let measuring: { starts: number; samples: number[] } | null = null
let lastTime = performance.now()
let nextUi = lastTime
function cancelMeasurement() {
  measuring = null
  benchmark.disabled = !debug.loaded
  benchmark.textContent = 'Measure for 10 seconds'
  result.textContent = ''
  recent = []
}
benchmark.onclick = () => {
  measuring = { starts: performance.now() + 2000, samples: [] }
  benchmark.disabled = true
  result.textContent = 'Warming up for 2 seconds…'
}
document.addEventListener('visibilitychange', () => {
  lastTime = performance.now()
  if (document.hidden && measuring) {
    cancelMeasurement()
    result.textContent = 'Measurement cancelled: keep this tab visible.'
  }
})
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const ms = now - lastTime
  lastTime = now
  if (document.hidden) return
  if (debug.loaded && ms > 0) {
    recent.push(ms)
    if (recent.length > 120) recent.shift()
  }
  if (!pauseInput.checked) {
    const travel = motionInput.value === 'travel'
    for (const entry of playbacks) {
      const distance = entry.playback.step(Math.min(ms / 1000, 0.1), Number(speedInput.value)) * entry.scale
      if (travel) entry.distance += distance
    }
    const average = travel && playbacks.length
      ? playbacks.reduce((sum, entry) => sum + entry.distance, 0) / playbacks.length : 0
    // Rebase by a whole number of floor tiles to keep long previews near origin.
    travelOrigin = Math.floor(average / 24) * 24
    for (const entry of playbacks) entry.wrapper.position.z = entry.baseZ + (travel ? entry.distance - travelOrigin : 0)
    follow(average - travelOrigin)
  }
  controls.update()
  renderer.render(scene, camera)
  for (const { node, wrapper } of labels) {
    projected.copy(wrapper.position)
    projected.y -= 0.12
    projected.project(camera)
    node.style.left = `${(projected.x + 1) * viewport.clientWidth / 2}px`
    node.style.top = `${(1 - projected.y) * viewport.clientHeight / 2}px`
    node.hidden = projected.z > 1
  }
  debug.draws = renderer.info.render.calls
  debug.triangles = renderer.info.render.triangles
  if (now > nextUi) {
    const avg = recent.reduce((sum, v) => sum + v, 0) / recent.length
    metrics.textContent = `${Number.isFinite(avg) ? (1000 / avg).toFixed(1) : '…'} fps (rolling)\n${debug.draws} draws · ${debug.triangles.toLocaleString()} triangles\n${debug.skeletons} skeletons · ${debug.meshes} meshes\n${debug.bones} bones / resident\n${renderer.domElement.width} × ${renderer.domElement.height} render pixels`
    nextUi = now + 500
  }
  if (measuring && now >= measuring.starts) {
    measuring.samples.push(ms)
    result.textContent = `Measuring… ${Math.min(10, (now - measuring.starts) / 1000).toFixed(1)} / 10 seconds`
    if (now - measuring.starts >= 10000) {
      const samples = measuring.samples
      const sorted = [...samples].sort((a, b) => a - b)
      const entry: Result = {
        fps: 1000 * samples.length / samples.reduce((sum, v) => sum + v, 0),
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        frames: samples.length, residents: debug.count, clip: clipInput.value,
        shadows: shadowInput.checked, viewport: `${viewport.clientWidth}x${viewport.clientHeight}`,
        dpr: renderer.getPixelRatio(),
        rendering: renderingInput.value, design: designInput.value,
        draws: debug.draws, skeletons: debug.skeletons,
        motion: motionInput.value, speed: Number(speedInput.value),
      }
      debug.results.push(entry)
      cancelMeasurement()
      result.textContent = `${entry.residents} residents: ${entry.fps.toFixed(1)} fps\n95th percentile frame: ${entry.p95FrameMs.toFixed(1)} ms\n${entry.frames} measured frames`
    }
  }
})

try {
  const specs = residentCatalog
  const latestBatch = Math.max(...specs.map((spec) => spec.batch))
  for (const spec of specs) designInput.add(new Option(`${spec.name} — ${spec.description}`, spec.id))
  const loader = new GLTFLoader()
  const templates = await Promise.all(specs.map(async (spec) => {
    const gltf = await loader.loadAsync(`/models/mii-test/${spec.id}.glb`)
    const rig = gltf.scene.getObjectByName('MiiTest')
    const walk = { strideLength: Number(rig?.userData.walkStrideLength), cycleSeconds: Number(rig?.userData.walkCycleSeconds) }
    const bounds = new THREE.Box3().setFromObject(gltf.scene)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    let bones = 0
    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.frustumCulled = false }
      if (obj instanceof THREE.Bone) bones++
    })
    const prepared = prepareResidentTemplate(gltf.scene)
    return { ...spec, gltf, prepared, center, floor: bounds.min.y, scale: 2.4 / size.y, bones, walk }
  }))
  debug.designs = templates.map((t) => t.name)
  const groups = new Map([
    ['all', templates], ['new', templates.filter((t) => t.batch === latestBatch)],
    ['previous', templates.filter((t) => t.batch === 1)], ['first', templates.filter((t) => t.batch === 0)],
  ])
  debug.clips = templates[0]!.gltf.animations.map((a) => a.name)
  clipInput.add(new Option('Rest pose', ''))
  for (const name of debug.clips) {
    const label = name.replace(/^test_/, '').replaceAll('_', ' ')
    clipInput.add(new Option(label[0]!.toUpperCase() + label.slice(1), name))
  }
  clipInput.value = 'test_walk'
  function play() {
    cancelMeasurement()
    for (const { playback } of playbacks) playback.select(clipInput.value)
  }
  function populate() {
    cancelMeasurement()
    resetTravel()
    for (const { playback } of playbacks) playback.dispose()
    for (const root of roots) disposeResidentSkeletons(root)
    playbacks = []
    roots = []
    labels = []
    labelLayer.replaceChildren()
    residents.clear()
    debug.count = Number(countInput.value)
    debug.rendering = renderingInput.value
    debug.skeletons = 0
    debug.meshes = 0
    const choices = groups.get(designInput.value) ?? templates.filter((t) => t.id === designInput.value)
    debug.bones = choices[0]!.bones
    for (let i = 0; i < debug.count; i++) {
      const template = choices[i % choices.length]!
      const model = renderingInput.value === 'original'
        ? clone(template.gltf.scene) : cloneResident(template.prepared.root)
      roots.push(model)
      const stats = residentRenderStats(model)
      debug.skeletons += stats.skeletons
      debug.meshes += stats.meshes
      const wrapper = new THREE.Group()
      wrapper.scale.setScalar(template.scale)
      model.position.set(-template.center.x, -template.floor, -template.center.z)
      wrapper.add(model)
      if (debug.count === 4) wrapper.position.set((i - 1.5) * 2.1, 0, 0)
      else if (debug.count > 4 && debug.count <= 20) {
        const columns = debug.count <= 10 ? debug.count / 2 : 7
        const rows = Math.ceil(debug.count / columns)
        const row = Math.floor(i / columns)
        const rowCount = Math.min(columns, debug.count - row * columns)
        wrapper.position.set((i % columns - (rowCount - 1) / 2) * 2.1, 0, (row - (rows - 1) / 2) * 4.8)
      }
      else if (debug.count > 1) wrapper.position.set((i % 8 - 3.5) * 1.8, 0, (Math.floor(i / 8) - 2.5) * 2.2)
      residents.add(wrapper)
      const playback = new ResidentPlayback(model, template.gltf.animations, template.walk, i * 0.137)
      playbacks.push({ playback, wrapper, baseZ: wrapper.position.z, distance: 0, scale: template.scale })
      if (debug.count <= 20) {
        const node = document.createElement('span')
        node.textContent = template.name
        labelLayer.append(node)
        labels.push({ node, wrapper })
      }
    }
    controls.target.set(0, debug.count === 48 ? 0.5 : 1.25, 0)
    setView()
    play()
  }
  clipInput.onchange = play
  motionInput.onchange = () => { cancelMeasurement(); resetTravel() }
  speedInput.oninput = () => { cancelMeasurement(); speedValue.value = `${Number(speedInput.value).toFixed(2)}×` }
  countInput.onchange = populate
  renderingInput.onchange = populate
  designInput.onchange = () => {
    countInput.value = String(groups.get(designInput.value)?.length ?? 1)
    populate()
  }
  shadowInput.onchange = () => { cancelMeasurement(); renderer.shadowMap.enabled = shadowInput.checked }
  pauseInput.onchange = cancelMeasurement
  warmInput.onchange = () => { cancelMeasurement(); light() }
  window.addEventListener('pagehide', () => {
    for (const { playback } of playbacks) playback.dispose()
    for (const root of roots) disposeResidentSkeletons(root)
    for (const template of templates) template.prepared.dispose()
  }, { once: true })
  debug.loaded = true
  benchmark.disabled = false
  populate()
  status.textContent = `${specs.length} resident designs. Choose a group to compare, or a resident for a close view.`
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  debug.errors.push(message)
  status.textContent = `Export could not load: ${message}`
  console.error(error)
}
