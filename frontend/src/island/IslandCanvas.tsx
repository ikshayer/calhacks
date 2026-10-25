import { Suspense, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { AudienceMember } from '@/data/types'
import { CameraRig } from './CameraRig'
import { Terrain } from './Terrain'
import { Town } from './Town'
import { Villagers } from './Villagers'
import { AmbientChatter } from './fx/AmbientChatter'
import { GroupHighlight } from './fx/GroupHighlight'
import { VerdictRings } from './fx/VerdictRings'
import { VERDICT_STYLE, type IdeaVerdict } from '@/data/ideaVerdict'
import { ISLAND_SPACING, type Island } from './scene/island'
import type { IslandSim } from './scene/IslandSim'
import { residentAppearance, RESIDENT_IDS } from './residentAppearance'
import { ISLAND_VIEW } from './scene/islandView'

export interface IslandCanvasProps {
  sim: IslandSim
  island: Island
  members: AudienceMember[]
  appearanceContext: string
  selectedIndex: number | null
  /** Someone is selected who has no body on the island, so the camera holds. */
  selectionWithoutBody?: boolean
  onSelect(index: number | null): void
  /** Group to ring on the ground, or null. Driven by the sidebar. */
  highlightGroupId: string | null
  highlightColor: string
  /** Member ids to ring by idea verdict; the static verdict colours are used. */
  verdicts?: Record<IdeaVerdict, number[]>
  /** Dropped first when frames get expensive. */
  shadows: boolean
  paused: boolean
  /** The town degrades to an empty island rather than failing the scene; this reports that. */
  onTownError?(error: unknown): void
}

/**
 * Late-afternoon light.
 *
 * The whole scene is graded by a single low, strongly orange key light with a
 * cool blue fill opposite it. That contrast is what makes a toy town look
 * photographed rather than lit by a lamp: warm tops, cool shadow sides, and
 * long shadows raking across the streets. Fog in the same orange buries the
 * horizon so the island reads as sitting in haze rather than floating on a
 * flat plane.
 */
const SUN = {
  position: [-52 * ISLAND_SPACING, 44 * ISLAND_SPACING, 42 * ISLAND_SPACING] as const,
  color: '#ffa652',
  intensity: 3.2,
}
const SKY_TOP = '#f6a765'
/**
 * Fog is pulled in close on purpose.
 *
 * The sea reaches far past the island, so without near fog the horizon stays
 * dark blue and the warmth never arrives — the island looks lit, but the
 * picture does not. Fogging the water to the same orange as the sky puts a
 * glowing band behind the town and hides where the plane ends.
 */
/**
 * A narrow fog band, placed deliberately.
 *
 * `near` sits just beyond the far edge of the island so the town itself stays
 * crisp, and `far` is close enough behind it that open water burns out to the
 * sky colour within the visible frame. Widen the band and the horizon goes
 * dark green; narrow it and the island goes hazy. This is the gap between.
 */
// Exactly the background colour: any difference leaves the water plane's own
// edge faintly visible where it meets the sky.
const FOG = { color: SKY_TOP, near: 108 * ISLAND_SPACING, far: 164 * ISLAND_SPACING }

export function IslandCanvas({
  sim,
  island,
  members,
  appearanceContext,
  selectedIndex,
  selectionWithoutBody,
  onSelect,
  highlightGroupId,
  highlightColor,
  verdicts,
  shadows,
  paused,
  onTownError,
}: IslandCanvasProps) {
  // Model stems indexed by villager, not by member id — only the cohort has bodies.
  const legacyModels = useMemo(() => {
    const byId = new Map(members.map((member) => [member.id, member.model]))
    return Array.from(
      { length: sim.count },
      (_, index) => byId.get(sim.memberOfIndex(index)) ?? 'character-female-a',
    )
  }, [members, sim])

  const models = useMemo(() => {
    const byId = new Map(members.map((member) => [member.id, member]))
    const roster = import.meta.env.DEV && new URLSearchParams(location.search).get('residents') === 'roster'
    return Array.from({ length: sim.count }, (_, index) => {
      if (roster) return RESIDENT_IDS[index % RESIDENT_IDS.length]!
      const member = byId.get(sim.memberOfIndex(index))
      return member ? residentAppearance(member, appearanceContext) : 'resident'
    })
  }, [members, sim, appearanceContext])

  const controlsRef = useRef<OrbitControlsImpl>(null)

  return (
    <Canvas
      shadows={shadows}
      // Capped so a high-DPI laptop does not quietly render four times the pixels.
      dpr={[1, 1.6]}
      camera={{ position: [...ISLAND_VIEW.position], fov: ISLAND_VIEW.fov, near: 1, far: 900 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      // A click that hits no resident clears the selection, which releases the follow camera.
      onPointerMissed={() => onSelect(null)}
      onCreated={({ gl, scene }) => {
        // ACES filmic rolls the strong orange key off gracefully instead of
        // clipping every sunlit roof to white.
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.08
        scene.background = new THREE.Color(SKY_TOP)
        scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far)
      }}
    >
      {/* Warm sky above, light bounced off the sea below. */}
      <hemisphereLight args={['#ffd2a0', '#3f7f88', 0.95]} />
      <ambientLight intensity={0.42} color="#ffbe84" />

      <directionalLight
        position={[...SUN.position]}
        color={SUN.color}
        intensity={SUN.intensity}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-62 * ISLAND_SPACING}
        shadow-camera-right={62 * ISLAND_SPACING}
        shadow-camera-top={62 * ISLAND_SPACING}
        shadow-camera-bottom={-62 * ISLAND_SPACING}
        shadow-camera-near={1}
        shadow-camera-far={190 * ISLAND_SPACING}
        shadow-bias={-0.0013 / ISLAND_SPACING}
      />

      {/* Cool counter-light so shadow sides read blue rather than black. */}
      <directionalLight position={[48, 26, -40]} color="#79b2d6" intensity={0.8} />

      <Suspense fallback={null}>
        <Terrain island={island} shadows={shadows} />
        <Town placements={island.plots} island={island} shadows={shadows} onError={onTownError} />
        <Villagers
          sim={sim}
          models={models}
          legacyModels={legacyModels}
          appearanceContext={appearanceContext}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          shadows={shadows}
          paused={paused}
        />
        <AmbientChatter sim={sim} paused={paused} />
        {highlightGroupId && (
          <GroupHighlight sim={sim} groupId={highlightGroupId} color={highlightColor} />
        )}
        {verdicts && (
          <>
            <VerdictRings sim={sim} memberIds={verdicts.going} color={VERDICT_STYLE.going.color} />
            <VerdictRings sim={sim} memberIds={verdicts.maybe} color={VERDICT_STYLE.maybe.color} />
            <VerdictRings sim={sim} memberIds={verdicts.not} color={VERDICT_STYLE.not.color} />
          </>
        )}
      </Suspense>

      {/*
        Bloom is what turns warm lighting into a warm *photograph*: sunlit roofs
        and the water highlights spill a little light into the air around them.
        Threshold is high so only genuinely bright surfaces glow and the whole
        frame does not go milky. Vignette settles the eye on the town.
      */}
      <EffectComposer enableNormalPass={false}>
        <Bloom intensity={0.5} luminanceThreshold={0.78} luminanceSmoothing={0.28} mipmapBlur />
        <Vignette offset={0.26} darkness={0.42} />
      </EffectComposer>

      <CameraRig sim={sim} followIndex={selectedIndex} hold={selectionWithoutBody} controls={controlsRef} />

      <OrbitControls
        ref={controlsRef}
        target={[...ISLAND_VIEW.target]}
        minDistance={ISLAND_VIEW.minDistance}
        maxDistance={ISLAND_VIEW.maxDistance}
        // Stop short of the horizon so the camera cannot slide under the island.
        maxPolarAngle={Math.PI / 2.3}
        minPolarAngle={0.2}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  )
}
