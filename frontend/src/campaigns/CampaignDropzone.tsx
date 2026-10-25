import { useEffect, useRef, useState } from 'react'
import { useAppStore, VideoResultError } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import type { CampaignId } from '@/data/types'
import { Button } from '@/components/ui'
import { DEMO_VIDEOS } from '@/data/spacetime/SpacetimeDataSource'
import { useLoadingTransition } from '@/components/loading-transition-context'

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
  const { beginLoading } = useLoadingTransition()
  const createCampaign = useAppStore((state) => state.createCampaign)
  const prepareVideoResult = useAppStore((state) => state.prepareVideoResult)
  const live = useAppStore((state) => state.source.kind === 'spacetime')
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const locked = useRef(false)
  const mounted = useRef(true)
  const [retryCampaignId, setRetryCampaignId] = useState<CampaignId | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Lock synchronously, including the initial demo fetch, before React can
  // render disabled buttons. Remounts never resubmit this background action.
  const runExclusive = async (work: () => Promise<CampaignId>) => {
    if (locked.current) return
    locked.current = true
    const transition = beginLoading()
    setBusy(true)
    setError(null)
    setRetryCampaignId(null)
    try {
      const id = await work()
      await transition.covered
      const current = useAppStore.getState()
      if (mounted.current && current.activeCampaignId === id && !current.idea) onCreated(id)
    } catch (cause: unknown) {
      console.error('Could not prepare video result', cause)
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'The video result could not be prepared.')
        if (cause instanceof VideoResultError) setRetryCampaignId(cause.campaignId)
      }
    } finally {
      transition.finish()
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const createFromFile = async (file: File) => {
    if (!file.type.startsWith('video/')) throw new Error(`${file.name} is not a video file.`)
    const durationSec = await readDuration(file)
    return createCampaign({ name: file.name, durationSec, file }, titleFromFile(file.name))
  }
  const accept = (file: File) => runExclusive(() => createFromFile(file))
  const pickDemo = (file: string) => runExclusive(async () => {
    const response = await fetch(`/demo/${file}`)
    if (!response.ok) throw new Error(`The demo video could not be loaded (HTTP ${response.status}).`)
    const blob = await response.blob()
    return createFromFile(new File([blob], file, { type: blob.type || 'video/mp4' }))
  })

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
        // Centred rather than top-aligned: this sits beside the taller idea
        // card and stretches to match it, so top-aligned content left a pool of
        // empty white under the button.
        'flex h-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors ' +
        (dragging
          ? 'border-primary bg-primary/[0.05]'
          : 'border-rule bg-card shadow-[0_20px_48px_-28px_rgba(101,0,48,0.28)]')
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
      <p className="display text-[20px] text-title" aria-live="polite">
        {busy ? 'Preparing results...' : 'Drop a video here'}
      </p>
      <p className="mx-auto mt-1.5 max-w-[40ch] text-[15px] leading-relaxed text-subtle">
        {busy ? 'Your finished result will open automatically.' : live
          ? 'Sent only to the worker on this laptop for analysis. Never posted.'
          : 'It stays in this browser. Nothing is uploaded, posted or shared.'}
      </p>
      <Button
        variant="secondary"
        className="mt-5 h-11 px-5 text-[15px]"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        Choose a file
      </Button>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-[13.5px] text-subtle">or try a demo:</span>
        {DEMO_VIDEOS.map((demo) => (
          <Button
            key={demo.file}
            variant="secondary"
            className="h-10 text-[14px]"
            disabled={busy} onClick={() => void pickDemo(demo.file)}>
            {demo.label}
          </Button>
        ))}
      </div>
      {retryCampaignId && !busy && <Button variant="secondary" className="mt-3" onClick={() => void runExclusive(async () => {
        try { await prepareVideoResult(retryCampaignId) }
        catch (cause: unknown) { throw new VideoResultError(retryCampaignId, cause) }
        return retryCampaignId
      })}>Retry results</Button>}
      {error && (
        <p role="alert" className="mt-3.5 text-[13.5px] leading-snug text-ui-danger">
          {error}
        </p>
      )}
    </div>
  )
}
