import { useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import type { CampaignId } from '@/data/types'
import { Button } from '@/components/ui'
import { DEMO_VIDEOS } from '@/data/spacetime/SpacetimeDataSource'

/** "Harvest day cut 2.mp4" becomes "Harvest day cut 2"; the user can rename later. */
function titleFromFile(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, '').trim()
  return stem.length > 0 ? stem : name
}

/**
 * The way into a new campaign.
 *
 * On the mock nothing is sent anywhere: the file is read locally for its
 * duration and a poster frame, and played from an object URL. On the live
 * backend it is posted to the worker on the same laptop. Failures render here, in place,
 * rather than as an alert, because the user's next move is to pick another file
 * and the message should still be on screen when they do.
 */
export function CampaignDropzone({ onCreated }: { onCreated(id: CampaignId): void }) {
  const createCampaign = useAppStore((state) => state.createCampaign)
  const live = useAppStore((state) => state.source.kind === 'spacetime')
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const accept = async (file: File) => {
    setError(null)
    if (!file.type.startsWith('video/')) {
      setError(`${file.name} is not a video file.`)
      return
    }
    setBusy(true)
    try {
      const durationSec = await readDuration(file)
      const id = await createCampaign(
        { name: file.name, durationSec, file },
        titleFromFile(file.name),
      )
      onCreated(id)
    } catch (cause: unknown) {
      console.error('Could not create the campaign', cause)
      setError(
        cause instanceof Error
          ? cause.message
          : 'That file could not be read. Try an mp4 or a mov.',
      )
      setBusy(false)
    }
  }

  // Demo videos go through the same path as a dropped file (poster, playback, upload, cache).
  const pickDemo = async (file: string) => {
    setError(null)
    try {
      const response = await fetch(`/demo/${file}`)
      if (!response.ok) throw new Error(`The demo video could not be loaded (HTTP ${response.status}).`)
      const blob = await response.blob()
      await accept(new File([blob], file, { type: blob.type || 'video/mp4' }))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The demo video could not be loaded.')
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file && !busy) void accept(file)
      }}
      className={
        'rounded-xl border border-dashed px-6 py-9 text-center transition-colors ' +
        (dragging ? 'border-sun bg-sun/[0.06]' : 'border-line bg-panel/60')
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void accept(file)
          event.target.value = ''
        }}
      />
      <p className="display text-[17px] text-paper" aria-live="polite">
        {busy ? (live ? 'Analysing… about 20–40 seconds' : 'Reading the file…') : 'Drop a video here'}
      </p>
      <p className="mx-auto mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-faint">
        {live
          ? 'Sent only to the worker on this laptop for analysis. Never posted.'
          : 'It stays in this browser. Nothing is uploaded, posted or shared.'}
      </p>
      <Button
        variant="secondary"
        className="mt-4"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        Choose a file
      </Button>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <span className="text-[12px] text-faint">or try a demo:</span>
        {DEMO_VIDEOS.map((demo) => (
          <Button key={demo.file} variant="secondary" disabled={busy} onClick={() => void pickDemo(demo.file)}>
            {demo.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3.5 text-[12.5px] leading-snug text-bloom">
          {error}
        </p>
      )}
    </div>
  )
}
