import { useRef, useState } from 'react'
import { useAppStore, selectActiveCampaign, selectActiveVideo } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import type { ContentSignals } from '@/data/types'
import { Button, Section } from '@/components/ui'

const SIGNAL_FIELDS: { key: keyof Omit<ContentSignals, 'topics' | 'durationSec'>; label: string }[] = [
  { key: 'hookStrength', label: 'Opening' },
  { key: 'clarityOfAsk', label: 'Clarity of the ask' },
  { key: 'pacing', label: 'Pacing' },
  { key: 'warmth', label: 'Warmth' },
]

/**
 * The campaign's video and what the analysis found in it.
 *
 * Nothing is sent anywhere: the file is played from an object URL. The
 * analysed signals are editable because they are a model's read of the video
 * and the user knows it better, and because adjusting them is how you ask
 * "what would a clearer ask do here?" without re-cutting the footage first.
 *
 * After a reload the signals survive but the file does not, and a revision
 * made now could not be simulated: `reviseSignals` throws until a file is
 * attached. The sliders are therefore disabled rather than left to fail, and
 * the one thing that unlocks them, re-attaching the file, sits where the
 * player would be.
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
    <Section title="The video">
      {video.objectUrl && (
        <video
          key={video.objectUrl}
          src={video.objectUrl}
          controls
          preload="metadata"
          className="max-h-[240px] w-full rounded-lg border border-line bg-ink object-contain"
        />
      )}

      {!editable && (
        <div className="rounded-lg border border-dashed border-line px-3.5 py-3.5">
          <p className="text-[12.5px] text-paper">Re-attach the video to play it back</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
            Browsers do not keep files across a reload. Choose {campaign.videoName} again to edit
            the signals or run it again. It stays in this browser.
          </p>
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
            variant="secondary"
            className="mt-3"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Reading the file…' : 'Choose the file'}
          </Button>
        </div>
      )}

      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{video.summary}</p>

      <div className="mt-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-[12px] text-paper">What the analysis found</p>
          <p className="text-[11px] text-faint">
            {editable ? 'Adjust if it read it wrong' : 'Locked until the video is attached'}
          </p>
        </div>
        <div className="space-y-2">
          {SIGNAL_FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2.5">
              <span className="w-[108px] shrink-0 text-[12px] text-muted">{field.label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={video.signals[field.key]}
                disabled={!editable}
                onChange={(event) => patchSignal(field.key, Number(event.target.value))}
                className="flex-1 disabled:opacity-45"
              />
              <span className="tnum w-8 text-right text-[12px] text-muted">
                {Math.round(video.signals[field.key] * 100)}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-faint">
          These four numbers are everything the simulation sees of the video. Changing one and
          re-running is how you test a cut before you make it.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] leading-snug text-bloom">
          {error}
        </p>
      )}
    </Section>
  )
}
