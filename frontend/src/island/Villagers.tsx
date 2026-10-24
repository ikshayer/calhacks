import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { GLTF } from 'three-stdlib'
import { Activity, clipForActivity, type IslandSim } from './scene/IslandSim'
import { AnimationBudget } from './AnimationBudget'
import {
  CHARACTER_PATHS,
  createRig,
  disposeRig,
  playClip,
  sharedCharacterMaterial,
  type VillagerRig,
} from './villagerModels'
import { ReactionBadges } from './fx/ReactionBadges'
import { ShareTrails } from './fx/ShareTrails'
import { SelectionRing } from './fx/SelectionRing'

/** Kenney Mini Characters are authored about 1.8 units tall; this sizes them to the island. */
const VILLAGER_SCALE = 2.1

interface VillagersProps {
  sim: IslandSim
  /** Model file stem per villager index, e.g. `character-female-a`. */
  models: string[]
  selectedIndex: number | null
  onSelect(index: number | null): void
  /** Shadows are the first thing to drop when frames get expensive. */
  shadows: boolean
  paused: boolean
}

export function Villagers({
  sim,
  models,
  selectedIndex,
  onSelect,
  shadows,
  paused,
}: VillagersProps) {
  const containerRef = useRef<THREE.Group>(null)
  const pickRef = useRef<THREE.InstancedMesh>(null)
  const budget = useMemo(() => new AnimationBudget(), [])
  const rigsRef = useRef<VillagerRig[]>([])
  const camera = useThree((state) => state.camera)

  const gltfs = useGLTF(CHARACTER_PATHS) as unknown as GLTF[]
  const material = useMemo(() => sharedCharacterMaterial(gltfs[0] as GLTF), [gltfs])

  // One rig per villager. Rebuilt only when the cohort itself changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const byPath = new Map(CHARACTER_PATHS.map((path, index) => [path, gltfs[index] as GLTF]))
    const rigs: VillagerRig[] = []

    for (let i = 0; i < sim.count; i++) {
      const stem = models[i] ?? 'character-female-a'
      const gltf = byPath.get(`/models/characters/${stem}.glb`) ?? (gltfs[0] as GLTF)
      const rig = createRig(gltf, material, shadows)
      rig.root.scale.setScalar(VILLAGER_SCALE)
      rig.root.position.set(sim.x[i] as number, 0, sim.z[i] as number)
      container.add(rig.root)
      rigs.push(rig)
    }

    rigsRef.current = rigs
    return () => {
      for (const rig of rigs) {
        container.remove(rig.root)
        disposeRig(rig)
      }
      rigsRef.current = []
    }
  }, [sim, models, gltfs, material, shadows])

  // Shadow casting is toggled on the live meshes rather than by rebuilding every rig.
  useEffect(() => {
    for (const rig of rigsRef.current) {
      rig.root.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = shadows
      })
    }
  }, [shadows])

  const pickGeometry = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1.9, 6), [])
  // Invisible but still raycast: `visible = false` would be skipped by the raycaster.
  const pickMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => {
    const geometry = pickGeometry
    const mat = pickMaterial
    return () => {
      geometry.dispose()
      mat.dispose()
    }
  }, [pickGeometry, pickMaterial])

  const matrix = useMemo(() => new THREE.Matrix4(), [])

  useFrame((_, delta) => {
    // Long frames (a tab regaining focus) must not teleport everyone.
    const dt = Math.min(delta, 0.1)
    if (!paused) sim.update(dt)

    const rigs = rigsRef.current
    for (let i = 0; i < rigs.length; i++) {
      const rig = rigs[i] as VillagerRig
      rig.root.position.set(sim.x[i] as number, 0, sim.z[i] as number)
      rig.root.rotation.y = sim.angle[i] as number
      playClip(rig, clipForActivity(sim.activity[i] as Activity))
    }

    budget.step(rigs, camera, paused ? 0 : dt, sim.x, sim.z)

    const pick = pickRef.current
    if (pick) {
      for (let i = 0; i < sim.count; i++) {
        matrix.makeTranslation(sim.x[i] as number, 0.95, sim.z[i] as number)
        pick.setMatrixAt(i, matrix)
      }
      pick.instanceMatrix.needsUpdate = true
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const index = event.instanceId
    if (index === undefined) return
    onSelect(index === selectedIndex ? null : index)
  }

  return (
    <group>
      <group ref={containerRef} />
      <instancedMesh
        ref={pickRef}
        args={[pickGeometry, pickMaterial, Math.max(sim.count, 1)]}
        onClick={handleClick}
      />
      <ReactionBadges sim={sim} />
      <ShareTrails sim={sim} />
      {selectedIndex !== null && <SelectionRing sim={sim} index={selectedIndex} />}
    </group>
  )
}

useGLTF.preload(CHARACTER_PATHS)
