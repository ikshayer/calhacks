import { useEffect, useMemo, useRef } from 'react'
import { selectActiveRun, useAppStore } from '@/store/useAppStore'
import { createRng } from '@/lib/rng'
import { Section } from '@/components/ui'

const WIDTH = 344
const HEIGHT = 196

interface Node {
  x: number
  y: number
  groupId: string
  color: string
}

/**
 * The cascade as a network, drawn on a 2D canvas.
 *
 * The island shows what the cascade feels like; this shows what it *is* — every
 * resident, the family and friendship links between them, and the edges that
 * actually carried a share.
 *
 * Plain Canvas 2D with a deterministic layout: a force-directed graph library
 * would cost more and say less at this size.
 */
export function MiniGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audience = useAppStore((state) => state.audience)
  const profile = useAppStore((state) => state.profile)
  const run = useAppStore(selectActiveRun)
  const round = useAppStore((state) => state.playback.round)

  /**
   * Members are clustered by group on a ring.
   *
   * The town deliberately has no visible group boundaries, but a node-link
   * diagram is unreadable without them — clustering here is what makes a
   * cascade that stays inside one group look different from one that crosses
   * between them. Its own layout, independent of where anybody lives.
   */
  const nodes = useMemo<Node[] | null>(() => {
    if (!audience || !profile) return null
    const groups = profile.groups
    const ringRadius = Math.min(WIDTH, HEIGHT * 1.7) * 0.29
    const clusterRadius = ringRadius * 0.62

    const centres = new Map(
      groups.map((group, index) => {
        const angle = (index / Math.max(groups.length, 1)) * Math.PI * 2 - Math.PI / 2
        return [
          group.id,
          { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius * 0.62, color: group.color },
        ]
      }),
    )
    const rng = createRng(audience.version * 7919 + 13)

    return audience.members.map((member) => {
      const centre = centres.get(member.groupId)
      // sqrt keeps the cluster evenly filled rather than piling up at its centre
      const radius = Math.sqrt(rng.next()) * clusterRadius
      const angle = rng.next() * Math.PI * 2
      return {
        x: WIDTH / 2 + (centre?.x ?? 0) + Math.cos(angle) * radius,
        y: HEIGHT / 2 + (centre?.y ?? 0) + Math.sin(angle) * radius * 0.62,
        groupId: member.groupId,
        color: centre?.color ?? '#93a09a',
      }
    })
  }, [audience, profile])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !nodes || !audience) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = WIDTH * dpr
    canvas.height = HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    const visible = (run && run.options.audienceKey === audience.key ? run.rounds : []).slice(0, round)
    const exposedAt = new Map<number, number>()
    const sharedEdges: [number, number][] = []
    for (const event of visible) {
      for (const id of event.exposed) exposedAt.set(id, event.round)
      for (const share of event.shares) {
        for (const target of share.to) sharedEdges.push([share.from, target])
      }
    }

    // Base graph: every link, kept faint so it reads as context.
    ctx.lineWidth = 0.4
    ctx.strokeStyle = 'rgba(147,160,154,0.13)'
    ctx.beginPath()
    for (const edge of audience.edges) {
      const a = nodes[edge.a]
      const b = nodes[edge.b]
      if (!a || !b) continue
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()

    // Edges that carried a share.
    ctx.lineWidth = 1.1
    ctx.strokeStyle = 'rgba(242,181,60,0.85)'
    ctx.beginPath()
    for (const [from, to] of sharedEdges) {
      const a = nodes[from]
      const b = nodes[to]
      if (!a || !b) continue
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()

    // Members: dim until reached, then their group's colour.
    nodes.forEach((node, id) => {
      const reached = exposedAt.has(id)
      ctx.beginPath()
      ctx.arc(node.x, node.y, reached ? 1.9 : 1.1, 0, Math.PI * 2)
      ctx.fillStyle = reached ? node.color : 'rgba(107,120,114,0.5)'
      ctx.fill()
    })
  }, [nodes, audience, run, round])

  if (!nodes) return null

  const sharesSoFar = (run && run.options.audienceKey === audience?.key ? run.rounds : [])
    .slice(0, round)
    .reduce((sum, event) => sum + event.shares.reduce((inner, s) => inner + s.to.length, 0), 0)

  return (
    <Section
      title="The network"
      aside={
        <span className="tnum text-[11.5px] text-faint">
          {audience?.edges.length ?? 0} links
        </span>
      }
    >
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: HEIGHT }}
        className="w-full rounded-lg border border-line bg-ink"
        role="img"
        aria-label={`Network of ${audience?.members.length ?? 0} audience members, with ${sharesSoFar} shares so far`}
      />
      <p className="mt-2.5 text-[11px] leading-relaxed text-faint">
        All {audience?.members.length ?? 0} members, grouped into clusters. Gold lines are shares
        that reached someone new. All {audience?.members.length ?? 0} residents walk around town.
      </p>
    </Section>
  )
}
