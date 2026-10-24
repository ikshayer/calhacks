import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { createRng } from '@/lib/rng'
import { Activity, type IslandSim } from '../scene/IslandSim'

/**
 * Small talk.
 *
 * Deliberately empty of meaning: greetings, weather, nothing about the campaign
 * and nothing that could be read as an opinion of it. A bubble saying "loved
 * that!" would look like simulation output and would be a lie, so the town
 * chatters about the weather instead. The only marks on screen that carry data
 * are the reaction emoji.
 */
const CHATTER = [
  'morning!', 'hey', 'haha', 'coffee?', 'not bad', 'later!',
  'one sec', 'sure', 'nice day', 'hmm', 'ok ok', 'see you',
  '🙂', '🎵', '👋', '…',
]

/** How many bubbles can be up at once. */
const MAX_BUBBLES = 10
/** Seconds between one bubble appearing and the next. */
const SPAWN_INTERVAL = { min: 0.35, max: 1.4 }
const BUBBLE_LIFETIME = { min: 2.2, max: 3.8 }

interface Bubble {
  villager: number
  texture: number
  remaining: number
}

/** Draws one speech bubble, with its tail, to a texture. */
function bubbleTexture(text: string): THREE.Texture {
  const width = 256
  const height = 128
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  ctx.font = '600 44px "Archivo", system-ui, sans-serif'
  const measured = Math.min(ctx.measureText(text).width + 44, width - 16)
  const boxWidth = Math.max(measured, 86)
  const boxHeight = 70
  const left = (width - boxWidth) / 2
  const top = 8

  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.strokeStyle = 'rgba(24,36,30,0.22)'
  ctx.lineWidth = 3

  ctx.beginPath()
  ctx.roundRect(left, top, boxWidth, boxHeight, 22)
  ctx.fill()
  ctx.stroke()

  // Tail, drawn as a filled triangle with its base hidden under the bubble.
  ctx.beginPath()
  ctx.moveTo(width / 2 - 13, top + boxHeight - 2)
  ctx.lineTo(width / 2, top + boxHeight + 26)
  ctx.lineTo(width / 2 + 13, top + boxHeight - 2)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.fill()

  ctx.fillStyle = '#1b2520'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, top + boxHeight / 2 + 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Ambient speech bubbles over the town.
 *
 * Without these a paused town is 120 people standing in the street saying
 * nothing, which reads as a screensaver rather than a place. Bubbles only
 * appear over villagers who are walking or idling — never over one holding a
 * phone — so small talk can never be confused with a reaction.
 */
export function AmbientChatter({ sim, paused }: { sim: IslandSim; paused: boolean }) {
  const groupRef = useRef<THREE.Group>(null)

  // One texture per phrase, but one material per *sprite*: fading a bubble
  // writes to its material's opacity, and sharing materials would make two
  // bubbles showing the same phrase fade in lockstep.
  const textures = useMemo(() => CHATTER.map(bubbleTexture), [])

  const sprites = useMemo(
    () =>
      Array.from({ length: MAX_BUBBLES }, () => {
        const material = new THREE.SpriteMaterial({
          map: textures[0],
          transparent: true,
          depthWrite: false,
        })
        const sprite = new THREE.Sprite(material)
        sprite.scale.set(2.6, 1.3, 1)
        sprite.center.set(0.5, 0)
        sprite.visible = false
        return sprite
      }),
    [textures],
  )

  useEffect(
    () => () => {
      for (const texture of textures) texture.dispose()
      for (const sprite of sprites) sprite.material.dispose()
    },
    [textures, sprites],
  )

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    for (const sprite of sprites) group.add(sprite)
    return () => {
      for (const sprite of sprites) group.remove(sprite)
    }
  }, [sprites])

  const bubbles = useRef<Bubble[]>([])
  const nextSpawn = useRef(0.8)
  const rng = useMemo(() => createRng(0x6ead5), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)

    if (!paused) {
      for (let i = bubbles.current.length - 1; i >= 0; i--) {
        const bubble = bubbles.current[i] as Bubble
        bubble.remaining -= dt
        // Drop a bubble the moment its owner is reached by the video, so the
        // reaction emoji is never competing with small talk.
        const busy = (sim.activity[bubble.villager] as Activity) >= Activity.OnPhone
        if (bubble.remaining <= 0 || busy) bubbles.current.splice(i, 1)
      }

      nextSpawn.current -= dt
      if (nextSpawn.current <= 0 && bubbles.current.length < MAX_BUBBLES && sim.count > 0) {
        nextSpawn.current = rng.range(SPAWN_INTERVAL.min, SPAWN_INTERVAL.max)
        const villager = rng.int(0, sim.count - 1)
        const activity = sim.activity[villager] as Activity
        const alreadyTalking = bubbles.current.some((b) => b.villager === villager)
        if (activity < Activity.OnPhone && !alreadyTalking) {
          bubbles.current.push({
            villager,
            texture: rng.int(0, textures.length - 1),
            remaining: rng.range(BUBBLE_LIFETIME.min, BUBBLE_LIFETIME.max),
          })
        }
      }
    }

    bubbles.current.forEach((bubble, index) => {
      const sprite = sprites[index]
      if (!sprite) return
      const texture = textures[bubble.texture]
      if (texture && sprite.material.map !== texture) {
        sprite.material.map = texture
        sprite.material.needsUpdate = true
      }
      sprite.position.set(
        sim.x[bubble.villager] as number,
        1.85,
        sim.z[bubble.villager] as number,
      )
      // Fade out over the last half second rather than vanishing mid-sentence.
      sprite.material.opacity = Math.min(1, bubble.remaining / 0.5)
      sprite.visible = true
    })

    for (let i = bubbles.current.length; i < MAX_BUBBLES; i++) {
      const sprite = sprites[i]
      if (sprite) sprite.visible = false
    }
  })

  return <group ref={groupRef} />
}
