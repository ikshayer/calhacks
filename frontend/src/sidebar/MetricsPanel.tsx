import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { Section, Stat } from '@/components/ui'
import { chartNumber, nonnegative, visibleRunResults } from '@/data/overviewStats'
import { ChartBar } from './OverviewCharts'

/** Independent action counts; one resident can take several different actions. */
export function MetricsPanel() {
  const run = useAppStore(selectActiveRun)
  const round = useAppStore((state) => state.playback.round)
  const audience = useAppStore((state) => state.audience)
  if (!run) return null
  const result = visibleRunResults(run, round)
  const compatible = Boolean(run.options.audienceKey) && run.options.audienceKey === audience?.key
  const size = compatible ? audience?.members.length : undefined
  const actions = [
    { label: 'Watched', value: result.watch, color: '#6aa9c9' },
    { label: 'Liked', value: result.likes, color: '#7fb069' },
    { label: 'Commented', value: result.comments, color: '#f2b53c' },
    { label: 'Shared', value: result.shares, color: '#e2735f' },
  ]
  const max = Math.max(1, ...actions.map((action) => nonnegative(action.value) ?? 0))
  const spread = run.metrics?.spread
  const low = nonnegative(spread?.p10)
  const median = nonnegative(spread?.p50)
  const high = nonnegative(spread?.p90)
  const spreadValid = low !== undefined && median !== undefined && high !== undefined && low <= median && median <= high

  return (
    <Section title="Simulation results" className="py-3" aside={<span className="text-[11px] text-ui-faint">{result.final ? (run.rounds.length ? 'Final' : 'Saved result') : `Round ${round}`}</span>}>
      <div className="mb-3 flex items-end justify-between gap-4 rounded-lg border border-ui-border bg-ui-well px-3 py-2.5">
        <Stat label={size === undefined ? 'Residents reached' : `Reached · ${size} residents`} value={nonnegative(result.exposed) ?? '—'} tone="water" />
        {size !== undefined && size > 0 && nonnegative(result.exposed) !== undefined && <span className="tnum text-[16px] text-ui-muted">{Math.round(result.exposed / size * 100)}%</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {actions.map((action) => <ChartBar key={action.label} {...action} max={max} />)}
      </div>
      {spreadValid && <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[10.5px] text-ui-faint"><span>200 trials · actions</span><span>P10 / P50 / P90</span></div>
        <div role="img" aria-label={`Actions across 200 trials: P10 ${low}, median ${median}, P90 ${high}. Simulation variability.`}>
          <div className="relative h-3 rounded-full bg-ui-accent/20">
            <span className="absolute inset-y-0 w-0.5 bg-ui-accent" style={{ left: `${high > low ? Math.min(99, (median - low) / (high - low) * 100) : 50}%` }} />
          </div>
          <div className="tnum mt-1 flex justify-between text-[10.5px] text-ui-muted"><span>P10 {chartNumber(low)}</span><span>P50 {chartNumber(median)}</span><span>P90 {chartNumber(high)}</span></div>
        </div>
      </div>}
      <p className="mt-2 text-[10.5px] text-ui-faint">Actions overlap · {run.metrics?.missing ?? 0} unscored, excluded</p>
    </Section>
  )
}
