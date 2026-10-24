import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { buildDistanceField, type Island } from './scene/island'

/**
 * The sea.
 *
 * A flat colour reads as a tabletop, so the water is a shader: swell rolling in
 * towards the land, foam breaking along the shore, and sun glitter that the
 * bloom pass picks up into a glare.
 *
 * The foam is the part that matters, and it is driven by two things:
 *
 *  - A distance field built from the island's own tiles, so foam hugs the real
 *    coastline — into the bay, around the piers, along every step of the grid —
 *    rather than being a ring drawn at a fixed radius.
 *  - A flow map, so the foam churns in a direction instead of sliding across
 *    the surface as one rigid sheet.
 *
 * All three maps are optional. Without them the shader falls back to a
 * procedural break-up, which is worse but not broken.
 */

const TEXTURES = {
  primary: '/textures/foam_primary.png',
  detail: '/textures/foam_detail.png',
  flow: '/textures/foam_flow.png',
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uDistance;
  uniform float uExtent;
  uniform float uFieldMax;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uGlint;

  uniform sampler2D uFoamPrimary;
  uniform sampler2D uFoamDetail;
  uniform sampler2D uFoamFlow;
  uniform float uHasFoam;
  uniform float uFoamScale;
  uniform float uFlowStrength;
  uniform float uFlowSpeed;
  uniform float uSheenStrength;

  varying vec3 vWorld;
  #include <fog_pars_fragment>

  /**
   * Samples a tiling map advected along the flow field.
   *
   * Two phases half a cycle apart, cross-faded by a triangle wave: each one
   * drifts, resets, and is hidden by the other while it does. This is what
   * makes foam look carried somewhere rather than scrolling.
   */
  float flowSample(sampler2D tex, vec2 uv, vec2 flow, float phase, float blend, float strength) {
    float a = texture2D(tex, uv - flow * phase * strength).r;
    float b = texture2D(tex, uv - flow * fract(phase + 0.5) * strength).r;
    return mix(a, b, blend);
  }

  void main() {
    // The distance field only covers the island's own grid; past its edge the
    // clamped sampler would hold the border value forever, so fall back to a
    // large distance and let the deep-water colour take over.
    vec2 uv = vWorld.xz / (2.0 * uExtent) + 0.5;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float dist = mix(uFieldMax, texture2D(uDistance, clamp(uv, 0.0, 1.0)).r, inside);

    // Swell: concentric bands travelling shoreward, broken up by a second
    // slower wave so the rings never look like a target.
    float swell = sin(dist * 0.9 - uTime * 1.25);
    float crossWave = sin(vWorld.x * 0.1 + vWorld.z * 0.08 + uTime * 0.5);
    float waves = swell * 0.5 + crossWave * 0.5;

    vec3 color = mix(uShallow, uDeep, smoothstep(1.5, 26.0, dist));
    color += waves * 0.028;

    float offshore = smoothstep(2.5, 9.0, dist);
    float crest = smoothstep(-0.1, 0.6, waves);

    // --- shoreline foam ----------------------------------------------------
    // Shaped procedurally, not from the foam maps. The Voronoi maps give
    // wispy streaks radiating off the coast; a travelling ripple gives a
    // denser, cleaner band that sits better against the stepped tiles. The
    // maps still earn their keep out on the open water below.
    float ripple = sin(vWorld.x * 1.9 + uTime * 1.7) * sin(vWorld.z * 1.7 - uTime * 1.3);
    float mask = clamp(ripple * 0.5 + 0.5, 0.0, 1.0);

    float band = 1.0 - smoothstep(0.0, 2.3, dist);
    float surf = smoothstep(0.55, 1.0, band + (mask * 2.0 - 1.0) * 0.16);
    // A tighter line right against the sand, where water always breaks.
    float edge = 1.0 - smoothstep(0.0, 0.9, dist);
    color = mix(color, uFoam, clamp(surf * 0.6 + edge * 0.55, 0.0, 1.0));

    // --- open water --------------------------------------------------------
    // The foam maps, tiled coarsely and advected along the flow field, so the
    // swell carries long streaks of light. This replaced a procedural sparkle
    // whose three sine waves scattered points across the sea like snow.
    float sheen;
    if (uHasFoam > 0.5) {
      vec2 ouv = vWorld.xz * uFoamScale * 0.3;
      vec2 oflow = texture2D(uFoamFlow, ouv * 0.3).rg * 2.0 - 1.0;
      float ophase = fract(uTime * uFlowSpeed * 0.45);
      float oblend = abs(1.0 - 2.0 * ophase);
      float coarse = flowSample(uFoamPrimary, ouv, oflow, ophase, oblend, uFlowStrength * 0.7);
      float fine = flowSample(uFoamDetail, ouv * 2.1, oflow, ophase, oblend, uFlowStrength);
      sheen = (coarse * 0.7 + fine * 0.3) * 0.55;
    } else {
      // No maps installed: points of light from three waves at deliberately
      // non-orthogonal frequencies. Multiplying two axis-aligned sines is the
      // obvious way to get sparkle and gives a perfect polka-dot lattice.
      float a = sin(vWorld.x * 2.31 + vWorld.z * 0.77 + uTime * 0.9);
      float b = sin(vWorld.x * -0.83 + vWorld.z * 2.17 - uTime * 0.73);
      float c = sin(vWorld.x * 1.27 - vWorld.z * 1.61 + uTime * 0.41);
      sheen = pow(max(a * b * c, 0.0), 24.0) * 4.0;
    }

    // Sunlight caught on the open water, on the crests only.
    color += sheen * uGlint * uSheenStrength * offshore * crest;

    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
  }
`

interface FoamMaps {
  primary: THREE.Texture
  detail: THREE.Texture
  flow: THREE.Texture
}

/**
 * Loads the foam maps, tolerating their absence.
 *
 * The sea has to look right with nothing in `public/textures/`, so a missing
 * file is a normal outcome rather than an error and the shader keeps its
 * procedural path. Resolves only once all three are in hand, because the flow
 * map is useless without something to advect.
 */
function useFoamMaps(): FoamMaps | null {
  const [maps, setMaps] = useState<FoamMaps | null>(null)

  useEffect(() => {
    let live = true
    const loader = new THREE.TextureLoader()

    const load = (url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
          url,
          (texture) => {
            texture.wrapS = THREE.RepeatWrapping
            texture.wrapT = THREE.RepeatWrapping
            // Masks and flow vectors are data, not colour: an sRGB decode here
            // would bend the flow directions.
            texture.colorSpace = THREE.NoColorSpace
            resolve(texture)
          },
          undefined,
          () => reject(new Error(`missing ${url}`)),
        )
      })

    Promise.all([load(TEXTURES.primary), load(TEXTURES.detail), load(TEXTURES.flow)])
      .then(([primary, detail, flow]) => {
        if (!live) {
          primary.dispose()
          detail.dispose()
          flow.dispose()
          return
        }
        setMaps({ primary, detail, flow })
      })
      .catch(() => {
        // No foam maps installed. Expected; the procedural path handles it.
      })

    return () => {
      live = false
    }
  }, [])

  useEffect(
    () => () => {
      maps?.primary.dispose()
      maps?.detail.dispose()
      maps?.flow.dispose()
    },
    [maps],
  )

  return maps
}

export function Water({ island }: { island: Island }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const maps = useFoamMaps()

  const field = useMemo(() => buildDistanceField(island), [island])

  const distanceTexture = useMemo(() => {
    const map = new THREE.DataTexture(
      field.data,
      field.size,
      field.size,
      THREE.RedFormat,
      THREE.FloatType,
    )
    map.minFilter = THREE.LinearFilter
    map.magFilter = THREE.LinearFilter
    map.wrapS = THREE.ClampToEdgeWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.needsUpdate = true
    return map
  }, [field])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDistance: { value: distanceTexture },
      uExtent: { value: field.extent },
      uFieldMax: { value: 140 },
      uDeep: { value: new THREE.Color('#0f6b7a') },
      uShallow: { value: new THREE.Color('#4fc2bd') },
      uFoam: { value: new THREE.Color('#dff6f2') },
      uGlint: { value: new THREE.Color('#ffd9a0') },
      uFoamPrimary: { value: null as THREE.Texture | null },
      uFoamDetail: { value: null as THREE.Texture | null },
      uFoamFlow: { value: null as THREE.Texture | null },
      uHasFoam: { value: 0 },
      /** World units to texture repeats. Smaller tiles the foam more coarsely. */
      uFoamScale: { value: 0.07 },
      /** How far the flow map displaces a sample over one cycle. */
      uFlowStrength: { value: 0.22 },
      uFlowSpeed: { value: 0.11 },
      /** How brightly the open water catches the sun. */
      uSheenStrength: { value: 0.22 },
      ...THREE.UniformsLib.fog,
    }),
    [distanceTexture, field.extent],
  )

  useEffect(() => () => distanceTexture.dispose(), [distanceTexture])

  useEffect(() => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uFoamPrimary!.value = maps?.primary ?? null
    material.uniforms.uFoamDetail!.value = maps?.detail ?? null
    material.uniforms.uFoamFlow!.value = maps?.flow ?? null
    material.uniforms.uHasFoam!.value = maps ? 1 : 0
  }, [maps])

  useFrame(({ clock, scene }) => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uTime!.value = clock.elapsedTime

    // Drive the fog uniforms from the scene by hand.
    //
    // Spreading UniformsLib.fog only supplies three's *defaults* (black, 1 to
    // 1000), and a raw ShaderMaterial does not reliably get them refreshed
    // from the scene. Without this the sea ignores the fog entirely: distant
    // water stays bright teal and the edge of the plane shows against the sky.
    const fog = scene.fog
    if (fog instanceof THREE.Fog) {
      ;(material.uniforms.fogColor!.value as THREE.Color).copy(fog.color)
      material.uniforms.fogNear!.value = fog.near
      material.uniforms.fogFar!.value = fog.far
    }
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]} frustumCulled={false}>
      {/*
        Sized against the camera's far plane, not just "big". The corners of a
        plane this wide sit further from the camera than its centre by a factor
        of root two, and a plane large enough to overshoot `far` gets sliced by
        it — which showed up as two hard diagonal cuts across the horizon that
        looked for all the world like a fog bug.
      */}
      <planeGeometry args={[field.extent * 15, field.extent * 15, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        fog
      />
    </mesh>
  )
}
