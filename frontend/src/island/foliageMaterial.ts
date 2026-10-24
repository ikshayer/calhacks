import * as THREE from 'three'

export type FoliageMode = 'canopy' | 'garden'

const declarations = /* glsl */`
varying vec3 vFoliagePosition;
`

const pattern = /* glsl */`
float leafHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float leafNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(leafHash(cell), leafHash(cell + vec2(1.0, 0.0)), f.x),
    mix(leafHash(cell + vec2(0.0, 1.0)), leafHash(cell + 1.0), f.x), f.y);
}
float foliageTexture(vec3 p) {
  // A noisier undercoat supports the actual leaf cards and is cheaper than painted leaf projections.
  float clusters = leafNoise(p.xz * 1.45 + p.y * 0.53);
  float flecks = leafNoise(p.xy * 7.0 + p.z * 1.7);
  return (0.82 + 0.34 * clusters) * (0.95 + 0.10 * flecks);
}
`

/** Own this material copy; palette maps and the GLTF material remain borrowed. */
export function createFoliageMaterial<T extends THREE.Material>(source: T, mode: FoliageMode): T {
  const material = source.clone()
  const sourceCompile = source.onBeforeCompile
  const sourceKey = source.customProgramCacheKey()
  material.name = `Leaf texture (${mode}): ${source.name || source.type}`
  material.onBeforeCompile = (shader, renderer) => {
    sourceCompile.call(material, shader, renderer)
    shader.vertexShader = declarations + shader.vertexShader
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vec4 foliagePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          foliagePosition = instanceMatrix * foliagePosition;
        #endif
        vFoliagePosition = (modelMatrix * foliagePosition).xyz;
      `)
    shader.fragmentShader = declarations + pattern + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      float greenRatio = diffuseColor.g / (max(diffuseColor.r, diffuseColor.b) + 0.001);
      float foliageMask = smoothstep(1.02, 1.16, greenRatio);
      ${mode === 'garden' ? 'foliageMask *= 1.0 - smoothstep(1.1, 1.6, vFoliagePosition.y);' : ''}
      if (foliageMask > 0.001) {
        diffuseColor.rgb *= mix(1.0, foliageTexture(vFoliagePosition), foliageMask);
      }
    `)
  }
  material.customProgramCacheKey = () => `${sourceKey}:island-leaf-undercoat-v2:${mode}`
  return material
}
