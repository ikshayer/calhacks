import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import type { GLTF } from 'three-stdlib'
import { islandModelKeys, type Island, type Plot } from './scene/island'
import { collectStaticParts, placedStaticMatrix, prepareBuilding, type PixelSampler, type StaticPart } from './staticTown'
import { architectureFor, planTown } from './townArchitecture'
import { planLandscape } from './landscapePlanning'
import { createFoliageMaterial, type FoliageMode } from './foliageMaterial'
import { createLeafCardBatch, isFoliageColor, leafSurfaces, sampleLeafCards, type LeafCard } from './leafCards'

const TOWN_MODEL_PATHS = islandModelKeys().map((key) => `/models/${key}.glb`)

function paletteSampler(parts: StaticPart[]): PixelSampler {
  const all = parts.flatMap((part) => Array.isArray(part.material) ? part.material : [part.material])
  const maps = new Set(all.flatMap((material) => material instanceof THREE.MeshStandardMaterial && material.map ? [material.map] : []))
  if (maps.size > 1) throw new Error('Building roof preparation requires one shared palette map')
  const first = all
    .find((material) => material instanceof THREE.MeshStandardMaterial && material.map) as THREE.MeshStandardMaterial | undefined
  const texture = first?.map
  const image = texture?.image as CanvasImageSource & { width: number; height: number } | undefined
  if (!texture || !image) return () => [0, 0, 0]
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not inspect building palette')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height).data
  const matrix = new THREE.Matrix3().setUvTransform(texture.offset.x, texture.offset.y,
    texture.repeat.x, texture.repeat.y, texture.rotation, texture.center.x, texture.center.y)
  const uv = new THREE.Vector2()
  return (u, v) => {
    uv.set(u, v).applyMatrix3(matrix)
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.x * image.width)))
    const y = Math.min(image.height - 1, Math.max(0, Math.floor((texture.flipY ? 1 - uv.y : uv.y) * image.height)))
    const offset = (y * image.width + x) * 4
    return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]
  }
}

function signMaterial(label: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 96
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ead9b9'; context.fillRect(0, 0, 512, 96)
  context.strokeStyle = '#6a5541'; context.lineWidth = 7; context.strokeRect(4, 4, 504, 88)
  context.fillStyle = '#3c514e'; context.textAlign = 'center'; context.textBaseline = 'middle'
  context.font = 'bold 54px Georgia, serif'; context.fillText(label, 256, 50, 470)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, material: new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }) }
}

/** Static hierarchy batches and architectural resources belong to the mounted effect. */
export function Town({ placements, island, shadows, onError }: { placements: Plot[]; island: Island; shadows: boolean; onError?: (error: unknown) => void }) {
  const gltfs = useGLTF(TOWN_MODEL_PATHS) as unknown as GLTF[]
  const keys = useMemo(() => islandModelKeys(), [])
  const rootRef = useRef<THREE.Group>(null)
  const meshesRef = useRef<THREE.InstancedMesh[]>([])
  const shadowsRef = useRef(shadows)
  useEffect(() => { shadowsRef.current = shadows }, [shadows])
  // Held in a ref so a caller passing an inline handler cannot rebuild the town.
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const meshes: THREE.InstancedMesh[] = []
    const prepared: ReturnType<typeof prepareBuilding>[] = []
    const ownedGeometry: THREE.BufferGeometry[] = []
    const ownedMaterials: THREE.Material[] = []
    const ownedTextures: THREE.Texture[] = []
    const foliageCopies = new Map<THREE.Material, Map<FoliageMode, THREE.Material>>()
    const foliageMaterial = (source: THREE.Material, mode: FoliageMode) => {
      let copies = foliageCopies.get(source)
      if (!copies) { copies = new Map(); foliageCopies.set(source, copies) }
      let copy = copies.get(mode)
      if (!copy) {
        copy = createFoliageMaterial(source, mode)
        copies.set(mode, copy); ownedMaterials.push(copy)
      }
      return copy
    }
    const architecture = new THREE.Group()
    architecture.name = 'Town architecture'
    root.add(architecture)
    const dispose = () => {
      root.clear()
      meshes.forEach((mesh) => mesh.dispose())
      prepared.forEach((template) => template.dispose())
      ownedGeometry.forEach((geometry) => geometry.dispose())
      ownedMaterials.forEach((material) => material.dispose())
      ownedTextures.forEach((texture) => texture.dispose())
      meshesRef.current = []
      if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>).__townScene
    }
    try {
      const assets = new Map(keys.map((key, index) => [key, collectStaticParts(gltfs[index]!.scene)]))
      const plan = planTown(placements, island, assets)
      const landscape = planLandscape(island, plan, assets)
      const leafCards: LeafCard[] = []
      const gardenBlocked = [...landscape.corridors, ...landscape.approaches]
      const treeBlocked = [...gardenBlocked, ...landscape.buildingBounds]
      const partsByStyle = new Map<string, StaticPart[]>()
      for (const style of plan.styles.values()) {
        const parts = assets.get(style.model)!
        const template = prepareBuilding(parts, style.fit, paletteSampler(parts))
        prepared.push(template)
        partsByStyle.set(style.key, template.parts)
      }
      const grouped = new Map<string, typeof plan.plots>()
      for (const plot of landscape.plots) {
        const key = plot.style ?? plot.model
        const group = grouped.get(key) ?? []
        group.push(plot); grouped.set(key, group)
      }
      const color = new THREE.Color()
      for (const [key, instances] of grouped) {
        const parts = partsByStyle.get(key) ?? assets.get(key)!
        for (const part of parts) {
          const mode = key.includes('/tree-') ? 'canopy' : key.includes('/building') ? 'garden' : null
          const material = !mode ? part.material : Array.isArray(part.material)
            ? part.material.map(source => foliageMaterial(source, mode)) : foliageMaterial(part.material, mode)
          const mesh = new THREE.InstancedMesh(part.geometry, material, instances.length)
          mesh.name = `Town ${key} ${part.name}`
          instances.forEach((plot, index) => {
            mesh.setMatrixAt(index, placedStaticMatrix(plot, part.matrix))
            color.set(plot.tint ?? '#ffffff')
            if (plot.style) color.lerp(new THREE.Color(plot.x < 0 ? '#edf0d6' : '#dae8e5'), 0.34)
            mesh.setColorAt(index, color)
          })
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
          mesh.castShadow = shadowsRef.current; mesh.receiveShadow = shadowsRef.current
          mesh.computeBoundingSphere(); root.add(mesh); meshes.push(mesh)
          if (mode) {
            const sample = paletteSampler([part])
            for (const plot of instances) {
              const tint = new THREE.Color(plot.tint ?? '#ffffff')
              if (plot.style) tint.lerp(new THREE.Color(plot.x < 0 ? '#edf0d6' : '#dae8e5'), 0.34)
              const surfaces = leafSurfaces(part.geometry, placedStaticMatrix(plot, part.matrix), (u, v) => {
                const rgb = sample(u, v)
                const color = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace).multiply(tint)
                return isFoliageColor(color) ? color : null
              }, mode === 'garden' ? 1.5 : Infinity)
              leafCards.push(...sampleLeafCards(surfaces, `${plot.sourceIndex}:${part.name}`, mode === 'canopy' ? 'tree' : 'bush',
                mode === 'canopy' ? treeBlocked : gardenBlocked))
            }
          }
        }
      }
      const buildings = plan.plots.filter((plot) => plot.style).map((plot) => ({ plot,
        style: plan.styles.get(plot.style!)!, detail: architectureFor(plot, plan.styles.get(plot.style!)!) }))
      const boxes = [...buildings.flatMap((building) => building.detail.boxes),
        ...landscape.parts.filter(part => part.shape === 'box')]
      const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
      const boxMaterial = new THREE.MeshLambertMaterial()
      ownedGeometry.push(boxGeometry); ownedMaterials.push(boxMaterial)
      const trim = new THREE.InstancedMesh(boxGeometry, boxMaterial, boxes.length)
      trim.name = 'Foundations entrances and awnings'
      boxes.forEach((box, index) => { trim.setMatrixAt(index, box.matrix); trim.setColorAt(index, color.set(box.color)) })
      trim.instanceMatrix.needsUpdate = true
      if (trim.instanceColor) trim.instanceColor.needsUpdate = true
      trim.castShadow = shadowsRef.current; trim.receiveShadow = shadowsRef.current
      trim.computeBoundingSphere(); architecture.add(trim); meshes.push(trim)
      // Landscape boxes join the architectural batch; rounded planting and urns add two.
      for (const shape of ['round', 'cylinder'] as const) {
        const instances = landscape.parts.filter(part => part.shape === shape)
        if (!instances.length) continue
        const geometry = shape === 'round' ? new THREE.SphereGeometry(0.5, 10, 6)
            : new THREE.CylinderGeometry(0.5, 0.42, 1, 12)
        const baseMaterial = new THREE.MeshLambertMaterial()
        const material = shape === 'round' ? createFoliageMaterial(baseMaterial, 'canopy') : baseMaterial
        if (shape === 'round') baseMaterial.dispose()
        ownedGeometry.push(geometry); ownedMaterials.push(material)
        const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
        mesh.name = `Landscape ${shape}`
        instances.forEach((part, index) => { mesh.setMatrixAt(index, part.matrix); mesh.setColorAt(index, color.set(part.color)) })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        mesh.castShadow = shadowsRef.current; mesh.receiveShadow = shadowsRef.current
        mesh.computeBoundingSphere(); architecture.add(mesh); meshes.push(mesh)
        if (shape === 'round') for (const [index, part] of instances.entries()) {
          const color = new THREE.Color(part.color)
          if (!isFoliageColor(color)) continue
          const surfaces = leafSurfaces(geometry, part.matrix, () => color)
          leafCards.push(...sampleLeafCards(surfaces, `${part.feature}:${index}:${part.matrix.elements[12]}:${part.matrix.elements[14]}`,
            'bush', gardenBlocked))
        }
      }
      if (leafCards.length) {
        const cards = createLeafCardBatch(leafCards)
        ownedGeometry.push(cards.geometry); ownedMaterials.push(cards.material); ownedTextures.push(cards.texture)
        cards.mesh.receiveShadow = shadowsRef.current
        architecture.add(cards.mesh); meshes.push(cards.mesh)
      }
      for (const [theme, label] of [['cafe','CAFE'],['bakery','BAKERY'],['market','MARKET'],['harbour','HARBOUR']] as const) {
        const signs = buildings.flatMap((building) => building.detail.signs).filter((sign) => sign.theme === theme)
        if (!signs.length) continue
        const { texture, material } = signMaterial(label)
        const geometry = new THREE.PlaneGeometry(1, 1)
        ownedTextures.push(texture); ownedMaterials.push(material); ownedGeometry.push(geometry)
        const mesh = new THREE.InstancedMesh(geometry, material, signs.length)
        signs.forEach((sign, index) => mesh.setMatrixAt(index, sign.matrix))
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere()
        mesh.receiveShadow = shadowsRef.current; mesh.userData.noCastShadow = true
        architecture.add(mesh); meshes.push(mesh)
      }
      meshesRef.current = meshes
      if (import.meta.env.DEV) Object.assign(window, { __townScene: { root, architecture, plan, prepared, landscape,
        inspect: () => buildings.map(({ plot, style, detail }) => ({ sourceModel: plot.model, sourceIndex: plot.sourceIndex,
          position: [plot.x, plot.z], rotation: plot.rotation, relocated: plot.relocated, theme: plot.theme,
          height: detail.footprint.max.y, footprint: detail.totalBounds.getSize(new THREE.Vector3()).toArray(),
          footprintBounds: { min: detail.totalBounds.min.toArray(), max: detail.totalBounds.max.toArray() },
          door: detail.door, horizontal: style.fit.horizontal, courseExtra: style.fit.courseExtra })),
        batches: meshes.length, trimParts: boxes.length, leafCards: leafCards.length } })
      return dispose
    } catch (error) {
      // A1 requires a missing-asset fallback rather than a blank simulation. The
      // strict checks in staticTown are deliberate authoring guards and still
      // fire; what changes here is the blast radius. Losing the buildings costs
      // the town, where rethrowing out of an effect unmounts the entire React
      // root and takes the island, the residents and the sidebar with it.
      // Reported, never swallowed: the caller surfaces this in the UI.
      dispose()
      console.error('The town could not be built; the island is rendering without buildings.', error)
      onErrorRef.current?.(error)
      return
    }
  }, [placements, island, gltfs, keys])

  useEffect(() => {
    for (const mesh of meshesRef.current) {
      mesh.castShadow = shadows && !mesh.userData.noCastShadow
      mesh.receiveShadow = shadows
    }
  }, [shadows])
  return <group ref={rootRef} name="Town" />
}

useGLTF.preload(TOWN_MODEL_PATHS)
