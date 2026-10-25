import { useState } from 'react'
import { useAppStore, selectActiveCampaign, selectActiveRun } from '@/store/useAppStore'
import { Section } from '@/components/ui'
import { Button } from '@/components/ui/button'

/** Video uploads prepare results automatically. Only recovery and history need controls. */
export function RunPanel() {
  const campaign = useAppStore(selectActiveCampaign)
  const run = useAppStore(selectActiveRun)
  const runs = useAppStore((state) => state.runs)
  const preparation = useAppStore((state) => state.activeCampaignId ? state.videoPreparations[state.activeCampaignId] : undefined)
  const prepare = useAppStore((state) => state.prepareVideoResult)
  const setActiveRun = useAppStore((state) => state.setActiveRun)
  const [retrying, setRetrying] = useState(false)
  if (!campaign) return null
  const history = campaign.runIds.map((id) => runs[id]).filter((entry) => entry?.status === 'complete' && entry.metrics && entry.report)
  const complete = run?.status === 'complete' && run.metrics && run.report && !run.error
  const error = preparation?.status === 'failed' ? preparation.error : run?.error
  const failed = Boolean(error) || run?.status === 'failed'
  const loading = !complete && !failed && (retrying || preparation?.status === 'preparing' || (run && run.status !== 'failed'))
  const retry = async () => {
    setRetrying(true)
    try { await prepare(campaign.id) }
    catch (cause: unknown) { console.error('Could not prepare video result', cause) }
    finally { setRetrying(false) }
  }
  if (complete && history.length < 2) return null
  return <Section title={complete ? 'Saved results' : loading ? 'Video result' : 'Result unavailable'} className="py-3">
    {loading ? <p role="status" className="text-[12px] text-ui-muted">Preparing results…</p> : !complete ? <>
      {error && <p role="alert" className="mb-2 text-[12px] text-ui-danger">{error}</p>}
      {campaign.videoAvailable ? <Button variant="outline" size="sm" onClick={() => void retry()} disabled={retrying}>Retry results</Button>
        : <p className="text-[11px] text-ui-faint">Re-attach the original video to prepare its result.</p>}
    </> : null}
    {history.length > 1 && <select aria-label="Saved results" value={run?.id ?? ''} onChange={(event) => setActiveRun(event.target.value)}
      className="mt-2 w-full rounded-md border border-ui-border bg-ui-well px-2 py-2 text-[12px] text-ui-text">
      {history.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select>}
  </Section>
}
