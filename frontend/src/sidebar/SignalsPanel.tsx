import { useRef, useState } from 'react'
import { useAppStore, selectActiveCampaign, selectActiveVideo } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import type { ContentSignals } from '@/data/types'
import { Section } from '@/components/ui'
import { Button } from '@/components/ui/button'

const SIGNAL_FIELDS: { key: keyof Omit<ContentSignals, 'topics' | 'durationSec'>; label: string }[] = [
  { key: 'hookStrength', label: 'Opening' },
  { key: 'clarityOfAsk', label: 'Clarity of the ask' },
  { key: 'pacing', label: 'Pacing' },
  { key: 'warmth', label: 'Warmth' },
]

/**
 * The campaign's video and what the analysis found in it.
 *
 * Playback and reattachment remain visible; signal editing is a compact
 * optional control. Full analysis stays available to the assistant.
 */
export function SignalsPanel() {
  const campaign = useAppStore(selectActiveCampaign)
  const video = useAppStore(selectActiveVideo)
  const reviseSignals = useAppStore((state) => state.reviseSignals)
  const attachVideo = useAppStore((state) => state.attachVideo)
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!campaign || !video) return null
  const editable = campaign.videoAvailable

  const patchSignal = (key: keyof ContentSignals, value: number) => {
    reviseSignals(video.id, { [key]: value }).catch((cause: unknown) => {
      console.error('Could not revise the signals', cause)
      setError(cause instanceof Error ? cause.message : 'The signals could not be updated.')
    })
  }

  const reattach = async (file: File) => {
    setError(null)
    if (!file.type.startsWith('video/')) {
      setError(`${file.name} is not a video file.`)
      return
    }
    setBusy(true)
    try {
      const durationSec = await readDuration(file)
      await attachVideo(campaign.id, { name: file.name, durationSec, file })
    } catch (cause: unknown) {
      console.error('Could not attach the video', cause)
      setError(
        cause instanceof Error
          ? cause.message
          : 'That file could not be read. Try an mp4 or a mov.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Video" className="py-3">
      {video.objectUrl && (
        <video
          key={video.objectUrl}
          src={video.objectUrl}
          controls
          preload="metadata"
          className="max-h-[140px] w-full rounded-lg border border-ui-border bg-ui-well object-contain"
        />
      )}

      {!editable && (
        <div className="rounded-lg border border-dashed border-ui-border px-3 py-2.5">
          <p className="truncate text-[11.5px] text-ui-muted" title={campaign.videoName}>{campaign.videoName}</p>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void reattach(file)
              event.target.value = ''
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Reading…' : 'Re-attach video'}
          </Button>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-ui-faint">Adjust video signals</summary>
        <div className="mt-2 space-y-2">
          {SIGNAL_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2.5">
              <span className="w-[96px] shrink-0 text-[11px] text-ui-muted">{field.label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={video.signals[field.key]}
                disabled={!editable}
                onChange={(event) => patchSignal(field.key, Number(event.target.value))}
                className="min-w-0 flex-1 disabled:opacity-45"
              />
              <span className="tnum w-8 text-right text-[12px] text-ui-muted">
                {Math.round(video.signals[field.key] * 100)}
              </span>
            </label>
          ))}
        </div>
      </details>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] leading-snug text-ui-danger">
          {error}
        </p>
      )}
    </Section>
  )
}
