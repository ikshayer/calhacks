import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import { Button, Textarea } from '@/components/ui'
import { useLoadingTransition } from '@/components/loading-transition-context'

const AB_VIDEOS = ['original.mp4', 'reworked.mp4'] as const

async function loadVideo(name: string) {
  const response = await fetch(`/demo/${name}`)
  if (!response.ok) throw new Error(`${name} could not be loaded (HTTP ${response.status}). Please try again.`)
  const blob = await response.blob()
  const file = new File([blob], name, { type: blob.type || 'video/mp4' })
  return { name, durationSec: await readDuration(file), file }
}

/**
 * Two videos, one goal, run side by side against the same audience.
 *
 * Both videos use the same audience and seed, with 10% starting exposure for Original
 * and 40% for Reworked. Results reflect both the video and its starting distribution.
 * The goal is shown beside the results; the simulation itself reads only the video content.
 */
export function AbTestCard() {
  const { beginLoading } = useLoadingTransition()
  const prepareAbTest = useAppStore((state) => state.prepareAbTest)
  const busy = useAppStore((state) => state.abPreparation?.status === 'preparing')
  const live = useAppStore((state) => state.source.kind === 'spacetime')
  const navigate = useNavigate()
  const [goal, setGoal] = useState('')
  const run = async () => {
    if (busy) return
    const transition = beginLoading()
    const preparing = prepareAbTest(async () => {
      const [a, b] = await Promise.all(AB_VIDEOS.map(loadVideo))
      return { goal, a, b }
    }).catch((cause: unknown) => {
      console.error('Could not start the A/B test', cause)
    })
    try {
      await transition.covered
      navigate('/workspace')
      await preparing
    } finally {
      transition.finish()
    }
  }

  return (
    <section className="rounded-xl bg-card p-6 ring-1 ring-black/10 shadow-[0_20px_48px_-28px_rgba(101,0,48,0.28)]">
      <h2 className="display text-[20px] leading-tight text-title">Compare two videos, side by side.</h2>
      <p className="mt-1 text-[12.5px] text-ui-muted">
        Say what you are trying to achieve. Original starts with 10% of the town; Reworked starts with 40%.
        Results reflect both the videos and their different starting distribution.
      </p>

      <div className="mt-4 space-y-3">
        <Textarea
          rows={2}
          value={goal}
          disabled={busy}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="I'm trying to attract volunteers to help with harvest and distribution at the farm."
          aria-label="What you are trying to achieve"
        />

        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void run()} disabled={busy}>
            Run comparison
          </Button>
          {busy && (
            <p className="text-[12.5px] text-ui-muted" aria-live="polite">
              {live ? 'Analysing both videos together… about 30–60 seconds' : 'Reading the files…'}
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-[11.5px] text-ui-faint">
        The goal is shown with the results; the simulation reacts to what is in the videos. Simulated residents of a
        fictional town — not consumer research, not a sales forecast.
      </p>
    </section>
  )
}
