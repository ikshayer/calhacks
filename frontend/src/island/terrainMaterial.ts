import * as THREE from 'three'

const vertexDeclarations = /* glsl */`
attribute float surfaceKind;
varying vec3 vGroundPosition;
varying float vGroundKind;
varying float vGroundTop;
`

const surfaceFunctions = /* glsl */`
varying vec3 vGroundPosition;
varying float vGroundKind;
varying float vGroundTop;

float groundHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float groundNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(groundHash(cell), groundHash(cell + vec2(1.0, 0.0)), f.x),
    mix(groundHash(cell + vec2(0.0, 1.0)), groundHash(cell + 1.0), f.x), f.y);
}
vec3 groundPattern(vec2 p, float kind) {
  float broad = groundNoise(p * 0.65);
  float grain = groundNoise(p * 24.0);
  if (kind < 1.5) {
    // Irregular mossy/sun-dried patches, with small tufts rather than a grass grid.
    vec2 cell = floor(p * 5.0), f = fract(p * 5.0);
    float seed = groundHash(cell);
    vec2 center = vec2(0.25 + 0.5 * seed, 0.25 + 0.5 * groundHash(cell + 8.0));
    vec2 blade = f - center;
    blade.x += blade.y * (seed - 0.5);
    float tuft = (1.0 - smoothstep(0.035, 0.10, abs(blade.x))) *
      (1.0 - smoothstep(0.08, 0.25, abs(blade.y))) * step(0.45, seed);
    float fade = 1.0 - smoothstep(0.25, 0.65, max(fwidth(p.x * 5.0), fwidth(p.y * 5.0)));
    return mix(vec3(0.78, 0.88, 0.72), vec3(1.12, 1.08, 0.91), broad)
      * (0.96 + 0.08 * grain - 0.16 * tuft * fade);
  }
  if (kind < 2.5) {
    float ripple = sin(p.x * 8.0 + p.y * 3.0 + groundNoise(p * 1.5) * 3.0);
    return vec3(0.96 + 0.07 * broad + ripple * 0.025 + (grain - 0.5) * 0.10);
  }
  if (kind < 4.5) {
    // Running-bond stone on streets; larger, square-cut paving in the plaza.
    vec2 grid = p * (kind < 3.5 ? vec2(1.35, 1.85) : vec2(1.0));
    float row = floor(grid.y);
    if (kind < 3.5) grid.x += mod(row, 2.0) * 0.5;
    vec2 cell = floor(grid), f = fract(grid);
    float aa = max(fwidth(grid.x), fwidth(grid.y));
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float joint = 1.0 - smoothstep(0.016, 0.016 + aa, edge);
    float stone = 0.92 + groundHash(cell) * 0.15 + (grain - 0.5) * 0.045;
    return mix(vec3(stone), vec3(0.70, 0.72, 0.71), joint * 0.58);
  }
  // A little grain supports the physical dock boards without replacing them.
  return vec3(0.97 + 0.035 * sin(p.x * 35.0 + groundNoise(p) * 3.0));
}
`

/** World-space patterns stay continuous across tile joins and keep one terrain draw. */
export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial()
  material.name = 'Grass, sand and cut-stone ground'
  material.onBeforeCompile = shader => {
    shader.vertexShader = vertexDeclarations + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      vec4 groundPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        groundPosition = instanceMatrix * groundPosition;
      #endif
      vGroundPosition = (modelMatrix * groundPosition).xyz;
      vGroundKind = surfaceKind;
      vGroundTop = step(0.5, normal.y);
    `)
    shader.fragmentShader = surfaceFunctions + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      diffuseColor.rgb *= mix(vec3(1.0), groundPattern(vGroundPosition.xz, vGroundKind), vGroundTop);
    `)
  }
  material.customProgramCacheKey = () => 'island-ground-surfaces-v1'
  return material
}
