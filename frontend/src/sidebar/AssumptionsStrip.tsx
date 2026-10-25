import { useState } from 'react'
import { STANDING_ASSUMPTIONS } from '@/data/mock/report'
import { useAppStore, type RunState } from '@/store/useAppStore'

/**
 * The disclosure strip, pinned to the bottom of the sidebar.
 *
 * It is always on screen and it is not in a tab. Everything this tool produces
 * is a model's output, and the one failure mode that would matter more than any
 * bug is someone walking away believing a simulated number was a measurement.
 * The collapsed line carries that claim on its own; expanding gives the
 * specifics.
 */
export function AssumptionsStrip({ run }: { run?: RunState }) {
  const [open, setOpen] = useState(false)
  const source = useAppStore((state) => state.source)
  const audience = useAppStore((state) => state.audience)

  const coverage = run?.metrics?.coverage
  const missing = run?.metrics?.missing ?? 0
  const total = run?.decisions?.length ?? (run?.options.audienceKey === audience?.key ? audience?.members.length : undefined)

  return (
    <div className="shrink-0 border-t border-line bg-ink">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <span aria-hidden className="text-[13px] text-sun">
          ◆
        </span>
        <span className="flex-1 text-[11.5px] leading-snug text-muted">
          Simulated, not measured. {source.kind === 'mock' && 'Running locally. '}
          {coverage !== undefined && coverage < 1
            ? `${missing}${total === undefined ? '' : ` of ${total}`} members had no prediction.`
            : 'Read the assumptions behind these numbers.'}
        </span>
        <span
          aria-hidden
          className={
            'text-[10px] text-faint transition-transform ' + (open ? 'rotate-180' : '')
          }
        >
          ▲
        </span>
      </button>

      {open && (
        <ul className="space-y-2 px-4 pb-3.5 pt-0.5">
          {STANDING_ASSUMPTIONS.map((assumption) => (
            <li key={assumption} className="flex gap-2 text-[11px] leading-relaxed text-faint">
              <span aria-hidden className="text-line">
                —
              </span>
              <span>{assumption}</span>
            </li>
          ))}
          <li className="flex gap-2 text-[11px] leading-relaxed text-faint">
            <span aria-hidden className="text-line">
              —
            </span>
            <span>
              Residents use the existing Mii-style avatars and the town is built from Kenney&apos;s
              CC0 city kits; portraits are DiceBear open-peeps (CC0). The buildings and the small
              talk are set dressing and carry no data. Full credits in{' '}
              <code className="text-muted">ASSET-CREDITS.md</code>.
            </span>
          </li>
        </ul>
      )}
    </div>
  )
}
