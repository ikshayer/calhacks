import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { ReactionKind } from '@/data/types'
import { Activity, type IslandSim } from '../scene/IslandSim'

/** Only so many badges can be legible at once; beyond this they are dropped. */
const POOL_SIZE = 64

const GLYPHS: Record<ReactionKind | 'phone' | 'dismiss', string> = {
  watch: '👀',
  like: '❤️',
  comment: '💬',
  share: '🔁',
  phone: '📱',
  dismiss: '💤',
}

const ORDER: (ReactionKind | 'phone' | 'dismiss')[] = [
  'share',
  'comment',
  'like',
  'watch',
  'phone',
  'dismiss',
]

/** Renders one emoji to a texture. Six textures, built once. */
function glyphTexture(glyph: string): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = `${Math.round(size * 0.72)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, size / 2, size / 2 + size * 0.04)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Floating reaction icons above villagers.
 *
 * This is the layer that turns a cute island into a readable view of the data:
 * a phone means exposed, a heart means liked, a loop means shared on. Sprites
 * from a small pool, repositioned each frame — only a handful of villagers are
 * reacting at any moment, so nothing is allocated while the cascade plays.
 */
export function ReactionBadges({ sim }: { sim: IslandSim }) {
  const groupRef = useRef<THREE.Group>(null)

  const materials = useMemo(() => {
    const entries = ORDER.map((key) => {
      const texture = glyphTexture(GLYPHS[key])
      return [
        key,
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
      ] as const
    })
    return new Map(entries)
  }, [])

  useEffect(
    () => () => {
      for (const material of materials.values()) {
        material.map?.dispose()
        material.dispose()
      }
    },
    [materials],
  )

  const sprites = useMemo(() => {
    const fallback = materials.get('like')
    return Array.from({ length: POOL_SIZE }, () => {
      const sprite = new THREE.Sprite(fallback)
      // Sized to stay readable at the default camera distance: these icons are
      // how the cascade is read across a room, not a decorative flourish.
      sprite.scale.setScalar(1.9)
      sprite.visible = false
      return sprite
    })
  }, [materials])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    for (const sprite of sprites) group.add(sprite)
    return () => {
      for (const sprite of sprites) group.remove(sprite)
    }
  }, [sprites])

  const clock = useRef(0)

  useFrame((_, delta) => {
    clock.current += delta
    let used = 0

    for (let i = 0; i < sim.count && used < POOL_SIZE; i++) {
      const activity = sim.activity[i] as Activity
      let key: ReactionKind | 'phone' | 'dismiss' | null = null

      if (activity === Activity.OnPhone) {
        key = 'phone'
      } else if (activity === Activity.Dismissing) {
        key = 'dismiss'
      } else if (activity === Activity.Reacting || activity === Activity.Sharing) {
        const kinds = sim.badges.get(i)?.kinds
        // Show the strongest action a member took, not all of them at once.
        key = kinds ? (ORDER.find((candidate) => kinds.includes(candidate as ReactionKind)) ?? 'watch') : 'watch'
      }

      if (!key) continue

      const sprite = sprites[used] as THREE.Sprite
      const material = materials.get(key)
      if (material) sprite.material = material
      // A slow bob, offset per villager so a crowd does not pulse in unison.
      const bob = Math.sin(clock.current * 2.4 + i) * 0.07
      sprite.position.set(sim.x[i] as number, 2.6 + bob, sim.z[i] as number)
      sprite.visible = true
      used++
    }

    for (let i = used; i < POOL_SIZE; i++) {
      ;(sprites[i] as THREE.Sprite).visible = false
    }
  })

  return <group ref={groupRef} />
}
