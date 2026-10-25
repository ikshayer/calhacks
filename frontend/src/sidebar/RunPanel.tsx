import { useMemo, useState } from 'react'
import { useAppStore, selectActiveCampaign, selectActiveRun, selectActiveVideo } from '@/store/useAppStore'
import { Section } from '@/components/ui'
import { Button } from '@/components/ui/button'

export function RunPanel() {
  const video = useAppStore(selectActiveVideo)
  const audience = useAppStore((state) => state.audience)
  const runs = useAppStore((state) => state.runs)
  const campaign = useAppStore(selectActiveCampaign)
  const activeRun = useAppStore(selectActiveRun)
  const startRun = useAppStore((state) => state.startRun)
  const setActiveRun = useAppStore((state) => state.setActiveRun)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ordered = useMemo(() => Object.values(runs).filter((run) => run.campaignId === campaign?.id), [runs, campaign?.id])
  const needsVideo = campaign?.videoAvailable === false
  const ready = Boolean(video && audience) && !needsVideo
  const running = activeRun?.status === 'scoring' || activeRun?.status === 'cascading'
  const begin = async () => {
    setBusy(true)
    setError(null)
    try { await startRun(ordered.length === 0 ? 'Original' : `Version ${ordered.length + 1}`) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'The simulation could not start.') }
    finally { setBusy(false) }
  }

  return (
    <Section title="Simulation" className="py-3" aside={<span role="status" className="max-w-[170px] truncate text-[11px] text-ui-faint" title={activeRun?.note}>{running ? (activeRun?.note || 'Running…') : activeRun?.status === 'failed' ? 'Failed' : ''}</span>}>
      <div className="flex items-center gap-2">
        {ordered.length > 1 && <select aria-label="Saved runs" value={activeRun?.id ?? ''} onChange={(event) => setActiveRun(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-ui-border bg-ui-well px-2 py-2 text-[12px] text-ui-text">
          {ordered.map((run) => <option key={run.id} value={run.id}>{run.label}</option>)}
        </select>}
        <Button className={ordered.length > 1 ? '' : 'w-full'} disabled={!ready || busy || running} onClick={() => void begin()}>
          {busy ? 'Starting…' : running ? 'Running…' : ordered.length ? 'Run again' : 'Run simulation'}
        </Button>
      </div>
      {!ready && <p className="mt-2 text-[11px] text-ui-faint">{needsVideo ? 'Re-attach the video to run again.' : 'Attach a video to start.'}</p>}
      {(error || activeRun?.error) && <p role="alert" className="mt-2 text-[12px] text-ui-danger">{error || activeRun?.error}</p>}
      {activeRun && activeRun.options.audienceKey !== audience?.key && <p className="mt-2 text-[10.5px] text-ui-faint">Saved results · a previous audience</p>}
    </Section>
  )
}
