import * as THREE from 'three'
import { createRng, hashSeed } from '../lib/rng.ts'

export interface LeafSurface {
  a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3
  na: THREE.Vector3; nb: THREE.Vector3; nc: THREE.Vector3
  color: THREE.Color
  area: number
}
export interface LeafCard { matrix: THREE.Matrix4; color: THREE.Color; detail: number }

export function isFoliageColor(color: THREE.Color): boolean {
  return color.g > color.r * 1.13 && color.g > color.b * 1.05
}

/** Sample real transformed triangles, so cards attach to the foliage rather than its bounding box. */
export function leafSurfaces(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4,
  colorAt: (u: number, v: number) => THREE.Color | null, maxHeight = Infinity): LeafSurface[] {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const index = geometry.index
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
  const surfaces: LeafSurface[] = []
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const ids = [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset)
    const points = ids.map(id => new THREE.Vector3().fromBufferAttribute(positions, id).applyMatrix4(matrix))
    const [a, b, c] = points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
    if (Math.max(a.y, b.y, c.y) > maxHeight || Math.max(a.y, b.y, c.y) < 0.20) continue
    const color = colorAt(uv ? ids.reduce((sum, id) => sum + uv.getX(id), 0) / 3 : 0,
      uv ? ids.reduce((sum, id) => sum + uv.getY(id), 0) / 3 : 0)
    if (!color || !isFoliageColor(color)) continue
    const cross = b.clone().sub(a).cross(c.clone().sub(a))
    const area = cross.length() / 2
    if (area < 1e-7) continue
    const ns = ids.map(id => normals ? new THREE.Vector3().fromBufferAttribute(normals, id).applyNormalMatrix(normalMatrix) : cross.clone().normalize())
    surfaces.push({ a, b, c, na: ns[0]!, nb: ns[1]!, nc: ns[2]!, color, area })
  }
  return surfaces
}

/** Separate deterministic visual RNG; no audience or movement random numbers are consumed. */
export function sampleLeafCards(surfaces: readonly LeafSurface[], seed: string, kind: 'tree' | 'bush',
  blocked: readonly THREE.Box3[] = []): LeafCard[] {
  if (!surfaces.length) return []
  const rng = createRng(hashSeed(`leaf-cards:${seed}`))
  let total = 0
  const cumulative = surfaces.map(surface => (total += surface.area))
  const count = Math.min(kind === 'tree' ? 500 : 220, Math.ceil(total * (kind === 'tree' ? 24 : 36)))
  const cards: LeafCard[] = []
  const leafBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.5, 1, 0))
  for (let i = 0; i < count; i++) {
    const at = rng.next() * total
    let low = 0, high = cumulative.length - 1
    while (low < high) { const mid = (low + high) >>> 1; if (at > cumulative[mid]!) low = mid + 1; else high = mid }
    const surface = surfaces[low]!
    let u = rng.next(), v = rng.next()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const w = 1 - u - v
    const point = surface.a.clone().multiplyScalar(w).addScaledVector(surface.b, u).addScaledVector(surface.c, v)
    if (point.y < 0.20) continue
    const normal = surface.na.clone().multiplyScalar(w).addScaledVector(surface.nb, u).addScaledVector(surface.nc, v).normalize()
    const reference = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const tangent = reference.cross(normal).normalize()
    const bitangent = normal.clone().cross(tangent)
    const angle = rng.range(0, Math.PI * 2)
    // The stem is embedded in the core; the leaf grows partly out and partly along it.
    const growth = tangent.multiplyScalar(Math.cos(angle)).addScaledVector(bitangent, Math.sin(angle))
      .addScaledVector(normal, rng.range(0.35, 0.75)).normalize()
    const face = normal.clone().addScaledVector(growth, -normal.dot(growth)).normalize()
    const right = growth.clone().cross(face).normalize()
    const detail = rng.next() > 0.64 ? 1 : 0
    const length = rng.range(kind === 'tree' ? 0.28 : 0.20, kind === 'tree' ? 0.52 : 0.36) * (detail ? 0.72 : 1)
    const width = length * rng.range(0.43, 0.68)
    const matrix = new THREE.Matrix4().makeBasis(right, growth, face)
      .scale(new THREE.Vector3(width, length, 1)).setPosition(point.addScaledVector(normal, -0.006))
    const bounds = leafBox.clone().applyMatrix4(matrix)
    if (bounds.min.y < 0.10 || blocked.some(box => box.intersectsBox(bounds))) continue
    cards.push({ matrix, detail, color: surface.color.clone().multiplyScalar(rng.range(0.88, 1.28)) })
  }
  return cards
}

/** A small RGBA cutout with a pointed blade, central vein, branching veins and fine pigment. */
export function createLeafTexture(): THREE.DataTexture {
  const width = 128, height = 256
  const pixels = new Uint8Array(width * height * 4)
  const rng = createRng(hashSeed('coastal-leaf-texture'))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = (y / (height - 1) - 0.025) / 0.95
    if (t <= 0 || t >= 1) continue
    const px = x / (width - 1) - 0.5
    const center = 0.035 * Math.sin(t * Math.PI)
    const halfWidth = 0.43 * Math.sin(t * Math.PI) ** 0.78 * (0.9 + 0.1 * t)
    const edge = halfWidth - Math.abs(px - center)
    const alpha = THREE.MathUtils.clamp(edge * width, 0, 1)
    const centralVein = Math.max(0, 1 - Math.abs(px - center) / 0.013)
    const ribs = Math.abs(((t * 8 + Math.abs(px - center) * 2.4) % 1) - 0.5)
    const rib = Math.max(0, 1 - ribs / 0.055) * Math.min(1, Math.abs(px - center) * 18)
    const shade = THREE.MathUtils.clamp(0.94 + 0.05 * (1 - Math.abs(px - center) / halfWidth)
      + rng.range(-0.025, 0.025) - centralVein * 0.075 - rib * 0.055, 0, 1)
    const offset = (y * width + x) * 4
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = Math.round(shade * 255)
    pixels[offset + 3] = Math.round(alpha * 255)
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat)
  texture.name = 'Pointed leaf cutout'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/** One opaque alpha-tested instance batch; tiny detail leaves recede at overview distance. */
export function createLeafCardBatch(cards: readonly LeafCard[]) {
  const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
  geometry.setAttribute('leafDetail', new THREE.InstancedBufferAttribute(Float32Array.from(cards, card => card.detail), 1))
  const texture = createLeafTexture()
  const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.38,
    side: THREE.DoubleSide, alphaToCoverage: true, forceSinglePass: true })
  material.name = 'Individual cutout leaves'
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float leafDetail; varying float vLeafVisibility;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec3 leafWorldPosition = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vLeafVisibility = mix(1.0, 1.0 - smoothstep(45.0, 100.0, distance(cameraPosition, leafWorldPosition)), leafDetail);
    `)
    shader.fragmentShader = 'varying float vLeafVisibility;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      diffuseColor.a *= vLeafVisibility;
    `)
  }
  material.customProgramCacheKey = () => 'individual-leaf-cards-v1'
  const mesh = new THREE.InstancedMesh(geometry, material, cards.length)
  mesh.name = 'Individual leaf cards'
  mesh.userData.noCastShadow = true
  cards.forEach((card, index) => { mesh.setMatrixAt(index, card.matrix); mesh.setColorAt(index, card.color) })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return { mesh, geometry, material, texture,
    dispose() { mesh.dispose(); geometry.dispose(); material.dispose(); texture.dispose() } }
}
