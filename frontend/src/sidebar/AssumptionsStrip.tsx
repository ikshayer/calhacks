import { useAppStore, type RunState } from '@/store/useAppStore'

/** Compact simulation status; detailed report context remains in Assistant. */
export function AssumptionsStrip({ run }: { run?: RunState }) {
  const source = useAppStore((state) => state.source)
  const idea = useAppStore((state) => state.idea)
  const missing = idea?.result?.residents.filter((resident) => resident.missing).length ?? run?.metrics?.missing
  return <p className="shrink-0 border-t border-ui-border bg-ui-well px-4 py-2 text-[10.5px] leading-snug text-ui-faint">
    Simulation results{source.kind === 'mock' ? ' · Demo' : ''}{missing !== undefined ? ` · ${missing} unscored` : ''}
  </p>
}
