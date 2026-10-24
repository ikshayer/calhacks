import { lazy, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { IslandSim } from './scene/IslandSim'
import { AnimationBudget } from './AnimationBudget'
import { createResident, residentTemplates, setResidentShadows, type ResidentTemplate } from './residentTemplates'
import { residentPhase, RESIDENT_ANCHORS, RESIDENT_HEIGHT } from './residentAppearance'
import { ReactionBadges } from './fx/ReactionBadges'
import { ShareTrails } from './fx/ShareTrails'
import { SelectionRing } from './fx/SelectionRing'

const KenneyVillagers = lazy(() => import('./KenneyVillagers').then((module) => ({ default: module.KenneyVillagers })))

interface VillagersProps {
  sim: IslandSim
  models: string[]
  legacyModels: string[]
  appearanceContext: string
  selectedIndex: number | null
  onSelect(index: number | null): void
  shadows: boolean
  paused: boolean
}

export function Villagers(props: VillagersProps) {
  const legacy = import.meta.env.DEV && new URLSearchParams(location.search).get('residents') === 'kenney'
  return legacy ? <KenneyVillagers {...props} models={props.legacyModels} /> : <Residents {...props} />
}

function Residents({ sim, models, legacyModels, appearanceContext, selectedIndex, onSelect, shadows, paused }: VillagersProps) {
  const containerRef = useRef<THREE.Group>(null)
  const pickRef = useRef<THREE.InstancedMesh>(null)
  const rigsRef = useRef<ReturnType<typeof createResident>[]>([])
  const shadowsRef = useRef(shadows)
  useEffect(() => { shadowsRef.current = shadows }, [shadows])
  const [templates, setTemplates] = useState<Map<string, ResidentTemplate> | null>(null)
  const budget = useMemo(() => new AnimationBudget(), [])
  const camera = useThree((state) => state.camera)
  const matrix = useMemo(() => new THREE.Matrix4(), [])

  useEffect(() => {
    const lease = residentTemplates.acquire()
    let mounted = true
    void lease.ready.then((value) => { if (mounted) setTemplates(value) }, (error: unknown) => {
      console.warn('Resident loading failed; using legacy renderer', error)
      if (mounted) setTemplates(new Map())
    })
    return () => { mounted = false; lease.release() }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !templates?.size) return
    const fallback = templates.get('resident') ?? templates.values().next().value!
    const rigs = Array.from({ length: sim.count }, (_, index) => {
      const template = templates.get(models[index]!) ?? fallback
      const rig = createResident(template, residentPhase(sim.memberOfIndex(index), appearanceContext))
      rig.root.position.set(sim.x[index]!, 0, sim.z[index]!)
      rig.root.rotation.y = sim.angle[index]!
      rig.controller.sample(0.001, sim.activity[index]!, sim.locomotionSpeed(index))
      rig.controller.advance()
      setResidentShadows(rig.root, shadowsRef.current)
      container.add(rig.root)
      return rig
    })
    rigsRef.current = rigs
    if (import.meta.env.DEV) {
      Object.assign(window, { __residentScene: { sim, camera, rigs, models, budget,
        inspect: () => rigs.map((rig, index) => ({ memberId: sim.memberOfIndex(index), model: models[index],
          uuid: rig.root.uuid, ...rig.controller.snapshot() })) } })
    }
    return () => {
      for (const rig of rigs) { container.remove(rig.root); rig.dispose() }
      rigsRef.current = []
      if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>).__residentScene
    }
  }, [sim, models, templates, appearanceContext, camera, budget])

  useEffect(() => { for (const rig of rigsRef.current) setResidentShadows(rig.root, shadows) }, [shadows])

  useFrame((_, delta) => {
    const dt = paused ? 0 : Math.min(delta, 0.1)
    const rigs = rigsRef.current
    // Sample the state that governed this interval, before simulation transitions.
    for (let i = 0; i < rigs.length; i++) rigs[i]!.controller.sample(dt, sim.activity[i]!, sim.locomotionSpeed(i))
    if (dt > 0 && rigs.length) sim.update(dt)
    for (let i = 0; i < rigs.length; i++) {
      rigs[i]!.root.position.set(sim.x[i]!, 0, sim.z[i]!)
      rigs[i]!.root.rotation.y = sim.angle[i]!
    }
    budget.step(rigs, camera, dt, sim.x, sim.z, selectedIndex)
    if (pickRef.current) {
      for (let i = 0; i < sim.count; i++) {
        matrix.makeTranslation(sim.x[i]!, RESIDENT_HEIGHT / 2, sim.z[i]!)
        pickRef.current.setMatrixAt(i, matrix)
      }
      pickRef.current.instanceMatrix.needsUpdate = true
      // Instance positions move; stale bounding spheres must never hide pick targets.
      pickRef.current.computeBoundingSphere()
    }
  })

  if (templates && !templates.size) return <KenneyVillagers sim={sim} models={legacyModels}
    selectedIndex={selectedIndex} onSelect={onSelect} shadows={shadows} paused={paused} />
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId !== undefined) onSelect(event.instanceId === selectedIndex ? null : event.instanceId)
  }
  return <group>
    <group ref={containerRef} />
    <instancedMesh ref={pickRef} args={[undefined, undefined, Math.max(sim.count, 1)]} onClick={handleClick}>
      <cylinderGeometry args={[RESIDENT_ANCHORS.pickRadius, RESIDENT_ANCHORS.pickRadius, RESIDENT_HEIGHT, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </instancedMesh>
    <ReactionBadges sim={sim} />
    <ShareTrails sim={sim} />
    {selectedIndex !== null && <SelectionRing sim={sim} index={selectedIndex} />}
  </group>
}
