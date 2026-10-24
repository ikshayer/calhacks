import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { cloneResident, disposeResidentSkeletons, prepareResidentTemplate, residentRenderStats } from '../island/residentRendering'

type Result = { fps: number; p95FrameMs: number; frames: number; residents: number; clip: string; shadows: boolean; viewport: string; dpr: number; rendering: string; design: string; draws: number; skeletons: number }
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
const pauseInput = el<HTMLInputElement>('paused')
const warmInput = el<HTMLInputElement>('warm')
const shadowInput = el<HTMLInputElement>('shadows')
const benchmark = el<HTMLButtonElement>('benchmark')
const status = el('status')
const metrics = el('metrics')
const result = el('result')
const debug = { loaded: false, count: 1, rendering: '', designs: [] as string[], clips: [] as string[], bones: 0, skeletons: 0, meshes: 0, triangles: 0, draws: 0, errors: [] as string[], results: [] as Result[] }
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
scene.add(hemi, ambient, sun, fill)
const floorMaterial = new THREE.MeshLambertMaterial({ color: '#c3855a' })
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.position.y = -0.015
floor.receiveShadow = true
scene.add(floor)
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
let mixers: THREE.AnimationMixer[] = []
let playbacks: { mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[] }[] = []
let roots: THREE.Object3D[] = []
let labels: { node: HTMLSpanElement; anchor: THREE.Vector3 }[] = []
const projected = new THREE.Vector3()
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
  if (!pauseInput.checked) for (const mixer of mixers) mixer.update(Math.min(ms / 1000, 0.1))
  controls.update()
  renderer.render(scene, camera)
  for (const { node, anchor } of labels) {
    projected.copy(anchor).project(camera)
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
      }
      debug.results.push(entry)
      cancelMeasurement()
      result.textContent = `${entry.residents} residents: ${entry.fps.toFixed(1)} fps\n95th percentile frame: ${entry.p95FrameMs.toFixed(1)} ms\n${entry.frames} measured frames`
    }
  }
})

try {
  const specs = [
    { id: 'resident', name: 'Original' }, { id: 'nia', name: 'Nia' },
    { id: 'theo', name: 'Theo' }, { id: 'rowan', name: 'Rowan' },
  ]
  const loader = new GLTFLoader()
  const templates = await Promise.all(specs.map(async (spec) => {
    const gltf = await loader.loadAsync(`/models/mii-test/${spec.id}.glb`)
    const bounds = new THREE.Box3().setFromObject(gltf.scene)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    let bones = 0
    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.frustumCulled = false }
      if (obj instanceof THREE.Bone) bones++
    })
    const prepared = prepareResidentTemplate(gltf.scene)
    return { ...spec, gltf, prepared, center, floor: bounds.min.y, scale: 2.4 / size.y, bones }
  }))
  debug.designs = templates.map((t) => t.name)
  debug.clips = templates[0]!.gltf.animations.map((a) => a.name)
  clipInput.add(new Option('Rest pose', ''))
  for (const name of debug.clips) clipInput.add(new Option(name.replace(/^test_/, '').replaceAll('_', ' '), name))
  clipInput.value = debug.clips.find((name) => /idle/i.test(name)) ?? ''
  function play() {
    cancelMeasurement()
    for (let i = 0; i < playbacks.length; i++) {
      const { mixer, clips } = playbacks[i]!
      mixer.stopAllAction()
      const clip = clips.find((a) => a.name === clipInput.value)
      if (clip) { const action = mixer.clipAction(clip); action.play(); mixer.setTime(i * 0.137 % clip.duration) }
    }
  }
  function populate() {
    cancelMeasurement()
    for (const mixer of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()) }
    for (const root of roots) disposeResidentSkeletons(root)
    mixers = []
    playbacks = []
    roots = []
    labels = []
    labelLayer.replaceChildren()
    residents.clear()
    debug.count = Number(countInput.value)
    debug.rendering = renderingInput.value
    debug.skeletons = 0
    debug.meshes = 0
    const choices = designInput.value === 'all' ? templates : templates.filter((t) => t.id === designInput.value)
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
      else if (debug.count > 1) wrapper.position.set((i % 8 - 3.5) * 1.8, 0, (Math.floor(i / 8) - 2.5) * 2.2)
      residents.add(wrapper)
      const mixer = new THREE.AnimationMixer(model)
      mixers.push(mixer)
      playbacks.push({ mixer, clips: template.gltf.animations })
      if (debug.count <= 4) {
        const node = document.createElement('span')
        node.textContent = template.name
        labelLayer.append(node)
        labels.push({ node, anchor: wrapper.position.clone().add(new THREE.Vector3(0, -0.12, 0)) })
      }
    }
    controls.target.set(0, debug.count === 48 ? 0.5 : 1.25, 0)
    camera.position.set(0, debug.count === 1 ? 1.8 : debug.count === 4 ? 2.7 : 14, debug.count === 1 ? 5.5 : debug.count === 4 ? 12.5 : 24)
    controls.update()
    play()
  }
  clipInput.onchange = play
  countInput.onchange = populate
  renderingInput.onchange = populate
  designInput.onchange = () => {
    countInput.value = designInput.value === 'all' ? '4' : '1'
    populate()
  }
  shadowInput.onchange = () => { cancelMeasurement(); renderer.shadowMap.enabled = shadowInput.checked }
  pauseInput.onchange = cancelMeasurement
  warmInput.onchange = () => { cancelMeasurement(); light() }
  window.addEventListener('pagehide', () => {
    for (const root of roots) disposeResidentSkeletons(root)
    for (const template of templates) template.prepared.dispose()
  }, { once: true })
  debug.loaded = true
  benchmark.disabled = false
  populate()
  status.textContent = 'Four designs loaded. Compare the lineup or choose a resident to inspect closely.'
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  debug.errors.push(message)
  status.textContent = `Export could not load: ${message}`
  console.error(error)
}
