import { useAppStore, type RunState } from '@/store/useAppStore'

/** A concise disclosure is always visible; full assumptions remain in Assistant. */
export function AssumptionsStrip({ run }: { run?: RunState }) {
  const source = useAppStore((state) => state.source)
  const idea = useAppStore((state) => state.idea)
  const missing = idea?.result?.residents.filter((resident) => resident.missing).length ?? run?.metrics?.missing
  return <p className="shrink-0 border-t border-ui-border bg-ui-well px-4 py-2 text-[10.5px] leading-snug text-ui-faint">
    Synthetic results · not measured{source.kind === 'mock' ? ' · Demo' : ''}{missing !== undefined ? ` · ${missing} unscored` : ''}
  </p>
}
