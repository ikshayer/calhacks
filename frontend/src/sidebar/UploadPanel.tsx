import { useCallback, useRef, useState } from 'react'
import { useAppStore, selectActiveVideo } from '@/store/useAppStore'
import type { ContentSignals } from '@/data/types'
import { Button, Section } from '@/components/ui'
import { DEMO_VIDEOS } from '@/data/spacetime/SpacetimeDataSource'

const SIGNAL_FIELDS: { key: keyof Omit<ContentSignals, 'topics' | 'durationSec'>; label: string }[] = [
  { key: 'hookStrength', label: 'Opening' },
  { key: 'clarityOfAsk', label: 'Clarity of the ask' },
  { key: 'pacing', label: 'Pacing' },
  { key: 'warmth', label: 'Warmth' },
]

/**
 * Upload and content analysis.
 *
 * Nothing is sent anywhere: the file is read locally for its duration and
 * played from an object URL. The analysed signals are editable because they are
 * a model's read of the video and the user knows it better — and because
 * adjusting them is how you ask "what would a clearer ask do here?" without
 * re-cutting the footage first.
 */
export function UploadPanel() {
  const video = useAppStore(selectActiveVideo)
  const analyseUpload = useAppStore((state) => state.analyseUpload)
  const reviseSignals = useAppStore((state) => state.reviseSignals)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const accept = useCallback(
    async (file: File) => {
      setError(null)
      if (!file.type.startsWith('video/')) {
        setError(`${file.name} is not a video file.`)
        return
      }
      setBusy(true)
      try {
        const durationSec = await readDuration(file)
        const label = video ? 'Revision' : 'Original'
        await analyseUpload({ name: file.name, durationSec, file }, label)
      } catch (cause: unknown) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'That file could not be read. Try an mp4 or a mov.',
        )
      } finally {
        setBusy(false)
      }
    },
    [analyseUpload, video],
  )

  // The live backend can only analyse these (no upload storage); the mock accepts them too.
  const [demoBusy, setDemoBusy] = useState(false)
  const pickDemo = async (demo: (typeof DEMO_VIDEOS)[number]) => {
    setError(null)
    setDemoBusy(true)
    try {
      await analyseUpload({ name: demo.file, durationSec: demo.durationSec }, demo.label)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The demo video could not be analysed.')
    } finally {
      setDemoBusy(false)
    }
  }

  const patchSignal = (key: keyof ContentSignals, value: number) => {
    if (!video) return
    void reviseSignals(video.id, { [key]: value })
  }

  return (
    <Section
      title="The video"
      aside={
        video && (
          <button
            onClick={() => inputRef.current?.click()}
            className="text-[12px] text-sun transition-colors hover:brightness-110"
          >
            Replace
          </button>
        )
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

      {!video ? (
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
            if (file) void accept(file)
          }}
          className={
            'rounded-lg border border-dashed px-4 py-7 text-center transition-colors ' +
            (dragging ? 'border-sun bg-sun/[0.06]' : 'border-line')
          }
        >
          <p className="display text-[14px] text-paper">
            {busy ? 'Reading the file…' : 'Drop a video here'}
          </p>
          <p className="mx-auto mt-1.5 max-w-[30ch] text-[12px] leading-relaxed text-faint">
            It stays in this browser. Nothing is uploaded, posted or shared.
          </p>
          <Button variant="secondary" className="mt-3.5" onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
        </div>
      ) : (
        <div>
          {video.objectUrl && (
            <video
              key={video.objectUrl}
              src={video.objectUrl}
              controls
              preload="metadata"
              className="max-h-[240px] w-full rounded-lg border border-line bg-ink object-contain"
            />
          )}

          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{video.summary}</p>

          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-[12px] text-paper">What the analysis found</p>
              <p className="text-[11px] text-faint">Adjust if it read it wrong</p>
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
                    onChange={(event) => patchSignal(field.key, Number(event.target.value))}
                    className="flex-1"
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
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-[11.5px] text-faint">
          {demoBusy ? 'Analysing the demo video… about 20 seconds' : 'Or use a pre-loaded demo video'}
        </p>
        <div className="flex gap-2">
          {DEMO_VIDEOS.map((demo) => (
            <Button
              key={demo.file}
              variant="secondary"
              disabled={demoBusy}
              onClick={() => void pickDemo(demo)}
            >
              {demo.label} demo
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] leading-snug text-bloom">
          {error}
        </p>
      )}
    </Section>
  )
}

/** Reads a video's duration by letting the browser decode its metadata. */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const element = document.createElement('video')
    element.preload = 'metadata'

    const cleanup = () => {
      URL.revokeObjectURL(url)
      element.removeAttribute('src')
    }

    element.onloadedmetadata = () => {
      const { duration } = element
      cleanup()
      // A stream with no known duration still deserves a usable default.
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 30)
    }
    element.onerror = () => {
      cleanup()
      reject(new Error('The browser could not read that video. Try an mp4.'))
    }
    element.src = url
  })
}
