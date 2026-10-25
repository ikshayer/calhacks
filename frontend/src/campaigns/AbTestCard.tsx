import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import { DEMO_VIDEOS } from '@/data/spacetime/SpacetimeDataSource'
import { Button, Textarea } from '@/components/ui'

type Side = 'a' | 'b'

/**
 * Two videos, one goal, run side by side against the same audience.
 *
 * Both videos are analysed in parallel and each gets its own simulation run with the same
 * audience, seed and starting exposure, so a difference in the results comes from the videos.
 * The goal is shown beside the results; the simulation itself reads only the video content.
 */
export function AbTestCard() {
  const startAbTest = useAppStore((state) => state.startAbTest)
  const live = useAppStore((state) => state.source.kind === 'spacetime')
  const navigate = useNavigate()
  const [goal, setGoal] = useState('')
  const [files, setFiles] = useState<Record<Side, File | null>>({ a: null, b: null })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setFile = (side: Side, file: File | null) => setFiles((current) => ({ ...current, [side]: file }))

  const run = async () => {
    const { a, b } = files
    if (!a || !b) return
    setError(null)
    setBusy(true)
    try {
      const [durationA, durationB] = await Promise.all([readDuration(a), readDuration(b)])
      await startAbTest({
        goal,
        a: { name: a.name, durationSec: durationA, file: a },
        b: { name: b.name, durationSec: durationB, file: b },
      })
      navigate('/workspace')
    } catch (cause: unknown) {
      console.error('Could not start the A/B test', cause)
      setError(cause instanceof Error ? cause.message : 'The A/B test could not be started.')
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl bg-card p-6 ring-1 ring-black/10 shadow-[0_20px_48px_-28px_rgba(101,0,48,0.28)]">
      <h2 className="display text-[20px] leading-tight text-title">Compare two videos, side by side.</h2>
      <p className="mt-1 text-[12.5px] text-ui-muted">
        Pick two cuts and say what you are trying to achieve. Both run through the same town at the same time, and you
        see which one reaches more people and where.
      </p>

      <div className="mt-4 space-y-3">
        <Textarea
          rows={2}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="I'm trying to attract volunteers to help with harvest and distribution at the farm."
          aria-label="What you are trying to achieve"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Slot side="a" label="Video A" file={files.a} disabled={busy} onChange={(file) => setFile('a', file)} />
          <Slot side="b" label="Video B" file={files.b} disabled={busy} onChange={(file) => setFile('b', file)} />
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void run()} disabled={busy || !files.a || !files.b}>
            Run A/B test
          </Button>
          {busy && (
            <p className="text-[12.5px] text-ui-muted" aria-live="polite">
              {live ? 'Analysing both videos together… about 30–60 seconds' : 'Reading the files…'}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] leading-snug text-ui-danger">
            {error}
          </p>
        )}
      </div>

      <p className="mt-4 text-[11.5px] text-ui-faint">
        The goal is shown with the results; the simulation reacts to what is in the videos. Simulated residents of a
        fictional town — not consumer research, not a sales forecast.
      </p>
    </section>
  )
}

function Slot({
  side,
  label,
  file,
  disabled,
  onChange,
}: {
  side: Side
  label: string
  file: File | null
  disabled: boolean
  onChange(file: File | null): void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const accept = (picked: File) => {
    if (!picked.type.startsWith('video/')) {
      setError(`${picked.name} is not a video file.`)
      return
    }
    setError(null)
    onChange(picked)
  }

  // Demo videos become a File so they take the same upload path as a chosen one.
  const pickDemo = async (demoFile: string) => {
    setError(null)
    try {
      const response = await fetch(`/demo/${demoFile}`)
      if (!response.ok) throw new Error(`The demo video could not be loaded (HTTP ${response.status}).`)
      const blob = await response.blob()
      onChange(new File([blob], demoFile, { type: blob.type || 'video/mp4' }))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The demo video could not be loaded.')
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-ui-border bg-ui-well px-4 py-4">
      <p className="text-[13px] font-medium text-ui-text">{label}</p>
      <input
        ref={inputRef}
        id={`ab-file-${side}`}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) accept(picked)
          event.target.value = ''
        }}
      />
      <p className="mt-1 min-h-[1.25rem] truncate text-[12.5px] text-ui-muted">{file ? file.name : 'No video chosen yet'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
          Choose a file
        </Button>
        {DEMO_VIDEOS.map((demo) => (
          <Button key={demo.file} variant="secondary" type="button" disabled={disabled} onClick={() => void pickDemo(demo.file)}>
            {demo.label}
          </Button>
        ))}
        {file && (
          <Button variant="ghost" type="button" disabled={disabled} onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] leading-snug text-ui-danger">
          {error}
        </p>
      )}
    </div>
  )
}
