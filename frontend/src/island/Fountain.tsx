import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { createFountainGeometry } from './fountainGeometry'

/** Limestone bowls, glazed rims, overflowing water and expanding splash rings. */
export function Fountain({ shadows }: { shadows: boolean }) {
  const rootRef = useRef<THREE.Group>(null)
  const animationRef = useRef<{ ripples: THREE.InstancedMesh; centers: THREE.Vector3[] } | null>(null)
  const shadowsRef = useRef(shadows)
  const time = useRef({ value: 0 })
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  useEffect(() => { shadowsRef.current = shadows }, [shadows])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const geometry = createFountainGeometry()
    const stone = new THREE.MeshStandardMaterial({ color: '#dfd2b7', roughness: 0.87 })
    const trim = new THREE.MeshLambertMaterial({ color: '#638e8c' })
    const pool = new THREE.MeshPhongMaterial({ color: '#63bdc9', specular: '#d6f3ef', shininess: 85 })
    const stream = new THREE.MeshBasicMaterial({ color: '#c6f0f0', transparent: true, opacity: 0.78, depthWrite: false })
    const ripple = new THREE.MeshBasicMaterial({ color: '#e3f5ee', transparent: true, opacity: 0.43, depthWrite: false })
    pool.onBeforeCompile = shader => {
      shader.uniforms.fountainTime = time.current
      shader.vertexShader = 'varying vec2 vPoolPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvPoolPosition = position.xz;')
      shader.fragmentShader = 'varying vec2 vPoolPosition; uniform float fountainTime;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float wave = sin(length(vPoolPosition) * 26.0 - fountainTime * 3.5);
        float crossing = sin(vPoolPosition.x * 19.0 + vPoolPosition.y * 13.0 + fountainTime * 2.0);
        diffuseColor.rgb *= 0.95 + 0.055 * wave + 0.025 * crossing;
      `)
    }
    pool.customProgramCacheKey = () => 'fountain-pool-v1'
    stream.onBeforeCompile = shader => {
      shader.uniforms.fountainTime = time.current
      shader.vertexShader = 'varying float vFlowHeight;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvFlowHeight = position.y;')
      shader.fragmentShader = 'varying float vFlowHeight; uniform float fountainTime;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float flow = 0.5 + 0.5 * sin(vFlowHeight * 24.0 + fountainTime * 9.0);
        diffuseColor.rgb *= 0.84 + 0.16 * flow;
        diffuseColor.a *= 0.65 + 0.35 * flow;
      `)
    }
    stream.customProgramCacheKey = () => 'fountain-overflow-v1'
    for (const [name, shape, material, solid] of [
      ['Carved limestone fountain', geometry.stone, stone, true],
      ['Glazed fountain rims', geometry.trim, trim, true],
      ['Fountain pools', geometry.pools, pool, false],
      ['Fountain jets and overflow', geometry.streams, stream, false],
    ] as const) {
      const mesh = new THREE.Mesh(shape, material)
      mesh.name = name
      mesh.userData.fountainSolid = solid
      mesh.castShadow = solid && shadowsRef.current
      mesh.receiveShadow = solid && shadowsRef.current
      root.add(mesh)
    }
    const ripples = new THREE.InstancedMesh(geometry.ripple, ripple, geometry.splashCenters.length * 2)
    ripples.name = 'Fountain splash ripples'
    ripples.frustumCulled = false
    root.add(ripples)
    animationRef.current = { ripples, centers: geometry.splashCenters }
    return () => {
      animationRef.current = null
      root.clear()
      ripples.dispose()
      geometry.dispose()
      for (const material of [stone, trim, pool, stream, ripple]) material.dispose()
    }
  }, [])

  useEffect(() => {
    rootRef.current?.traverse(node => {
      if (node instanceof THREE.Mesh && node.userData.fountainSolid) {
        node.castShadow = shadows; node.receiveShadow = shadows
      }
    })
  }, [shadows])

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime
    time.current.value = elapsed
    const animation = animationRef.current
    if (!animation) return
    for (let i = 0; i < animation.ripples.count; i++) {
      const center = animation.centers[Math.floor(i / 2)]!
      const phase = (elapsed * 0.65 + (i % 2) * 0.5 + Math.floor(i / 2) * 0.13) % 1
      const radius = 0.025 + 0.145 * phase
      matrix.makeScale(radius, 1, radius).setPosition(center.x, center.y, center.z)
      animation.ripples.setMatrixAt(i, matrix)
    }
    animation.ripples.instanceMatrix.needsUpdate = true
  })

  return <group ref={rootRef} name="Plaza fountain" />
}
