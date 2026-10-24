import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { AudienceMember } from '@/data/types'
import { Terrain } from './Terrain'
import { Town } from './Town'
import { Villagers } from './Villagers'
import { AmbientChatter } from './fx/AmbientChatter'
import { GroupHighlight } from './fx/GroupHighlight'
import type { Island } from './scene/island'
import type { IslandSim } from './scene/IslandSim'

export interface IslandCanvasProps {
  sim: IslandSim
  island: Island
  members: AudienceMember[]
  selectedIndex: number | null
  onSelect(index: number | null): void
  /** Group to ring on the ground, or null. Driven by the sidebar. */
  highlightGroupId: string | null
  highlightColor: string
  /** Dropped first when frames get expensive. */
  shadows: boolean
  paused: boolean
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
  position: [-52, 44, 42] as const,
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
const FOG = { color: SKY_TOP, near: 96, far: 152 }

export function IslandCanvas({
  sim,
  island,
  members,
  selectedIndex,
  onSelect,
  highlightGroupId,
  highlightColor,
  shadows,
  paused,
}: IslandCanvasProps) {
  // Model stems indexed by villager, not by member id — only the cohort has bodies.
  const models = useMemo(() => {
    const byId = new Map(members.map((member) => [member.id, member.model]))
    return Array.from(
      { length: sim.count },
      (_, index) => byId.get(sim.memberOfIndex(index)) ?? 'character-female-a',
    )
  }, [members, sim])

  return (
    <Canvas
      shadows={shadows}
      // Capped so a high-DPI laptop does not quietly render four times the pixels.
      dpr={[1, 1.6]}
      camera={{ position: [0, 48, 60], fov: 38, near: 1, far: 900 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
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
        shadow-camera-left={-62}
        shadow-camera-right={62}
        shadow-camera-top={62}
        shadow-camera-bottom={-62}
        shadow-camera-near={1}
        shadow-camera-far={190}
        shadow-bias={-0.0013}
      />

      {/* Cool counter-light so shadow sides read blue rather than black. */}
      <directionalLight position={[48, 26, -40]} color="#79b2d6" intensity={0.8} />

      <Suspense fallback={null}>
        <Terrain island={island} shadows={shadows} />
        <Town placements={island.plots} shadows={shadows} />
        <Villagers
          sim={sim}
          models={models}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          shadows={shadows}
          paused={paused}
        />
        <AmbientChatter sim={sim} paused={paused} />
        {highlightGroupId && (
          <GroupHighlight sim={sim} groupId={highlightGroupId} color={highlightColor} />
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

      <OrbitControls
        target={[0, 0, 0]}
        minDistance={18}
        maxDistance={115}
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
