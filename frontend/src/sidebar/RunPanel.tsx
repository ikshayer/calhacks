import { useState } from 'react'
import { useAppStore, selectActiveRun, selectActiveVideo } from '@/store/useAppStore'
import { Button, Section } from '@/components/ui'

/**
 * Starting a run, and switching between the ones already done.
 *
 * Every run inherits the same seed, audience and starting exposure. That is not
 * a detail: it is the only thing that makes "the revision did better" mean
 * anything, so the panel states it rather than hiding it.
 */
export function RunPanel() {
  const video = useAppStore(selectActiveVideo)
  const audience = useAppStore((state) => state.audience)
  const runs = useAppStore((state) => state.runs)
  const activeRun = useAppStore(selectActiveRun)
  const startRun = useAppStore((state) => state.startRun)
  const setActiveRun = useAppStore((state) => state.setActiveRun)
  const [busy, setBusy] = useState(false)

  const ordered = Object.values(runs)
  const ready = Boolean(video && audience)

  const begin = async () => {
    setBusy(true)
    try {
      const label = ordered.length === 0 ? 'Original' : `Version ${ordered.length + 1}`
      await startRun(label)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Simulation"
      aside={
        activeRun && (
          <span className="text-[11.5px] text-faint">
            {activeRun.status === 'scoring' && 'Scoring…'}
            {activeRun.status === 'cascading' && 'Spreading…'}
            {activeRun.status === 'complete' && 'Done'}
            {activeRun.status === 'failed' && 'Failed'}
          </span>
        )
      }
    >
      <Button className="w-full py-2.5" onClick={() => void begin()} disabled={!ready || busy}>
        {busy
          ? 'Starting…'
          : ordered.length === 0
            ? 'Run the simulation'
            : 'Run this version'}
      </Button>

      {!ready && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-faint">
          Upload a video first. The audience is already built and waiting.
        </p>
      )}

      {ordered.length > 1 && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] text-paper">Runs</p>
          <div className="space-y-1.5">
            {ordered.map((run) => {
              const active = run.id === activeRun?.id
              return (
                <button
                  key={run.id}
                  onClick={() => setActiveRun(run.id)}
                  className={
                    'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ' +
                    (active ? 'border-sun bg-sun/[0.07]' : 'border-line bg-ink hover:border-faint')
                  }
                >
                  <span className="truncate text-[12.5px] text-paper">{run.label}</span>
                  <span className="tnum shrink-0 text-[11.5px] text-muted">
                    {run.metrics
                      ? `${run.metrics.likes + run.metrics.shares + run.metrics.comments} actions`
                      : '—'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {activeRun && (
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3.5 text-[11.5px]">
          <Detail label="Seed" value={String(activeRun.options.seed)} />
          <Detail
            label="Seeded exposure"
            value={`${(activeRun.options.seedExposure * 100).toFixed(0)}% of audience`}
          />
          <Detail label="Audience" value={`v${activeRun.options.audienceVersion}`} />
          <Detail label="Round cap" value={String(activeRun.options.maxRounds)} />
        </dl>
      )}

      {ordered.length > 1 && (
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Every run uses the same audience, social graph, starting exposure and seeds, so
          differences come from the video and nothing else.
        </p>
      )}
    </Section>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="tnum mt-0.5 text-muted">{value}</dd>
    </div>
  )
}
