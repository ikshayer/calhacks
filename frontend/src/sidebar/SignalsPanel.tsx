import { useRef, useState } from 'react'
import { useAppStore, selectActiveCampaign, selectActiveVideo } from '@/store/useAppStore'
import { readDuration } from '@/data/videoPoster'
import { Section } from '@/components/ui'
import { Button } from '@/components/ui/button'

/** Video playback and reattachment; full analysis is available to the assistant. */
export function SignalsPanel() {
  const campaign = useAppStore(selectActiveCampaign)
  const video = useAppStore(selectActiveVideo)
  const attachVideo = useAppStore((state) => state.attachVideo)
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!campaign || !video) return null

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

      {!campaign.videoAvailable && (
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

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] leading-snug text-ui-danger">
          {error}
        </p>
      )}
    </Section>
  )
}
