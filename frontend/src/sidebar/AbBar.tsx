import { useAppStore } from '@/store/useAppStore'

/**
 * The A/B switch above the sidebar tabs. It swaps which video's simulation the island
 * shows; the Compare tab always holds A against B.
 */
export function AbBar({ onCompare }: { onCompare(): void }) {
  const ab = useAppStore((state) => state.ab)
  const campaigns = useAppStore((state) => state.campaigns)
  const runs = useAppStore((state) => state.runs)
  const showAbSide = useAppStore((state) => state.showAbSide)

  if (!ab) return null
  // A deleted campaign or run leaves the pair unusable; show nothing rather than a dead switch.
  if (!campaigns[ab.a.campaignId] || !campaigns[ab.b.campaignId] || !runs[ab.a.runId] || !runs[ab.b.runId]) return null

  return (
    <div className="border-b border-line px-4 py-3">
      {ab.goal && (
        <p className="mb-2 text-[12px] leading-relaxed text-muted">
          <span className="text-faint">Goal: </span>
          {ab.goal}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Video shown on the island" className="flex rounded-md border border-line bg-ink p-0.5">
          {(['a', 'b'] as const).map((side) => {
            const active = ab.active === side
            return (
              <button
                key={side}
                type="button"
                aria-pressed={active}
                onClick={() => showAbSide(side)}
                className={
                  'rounded px-3 py-1 text-[12.5px] font-medium transition-colors ' +
                  (active ? 'bg-sun text-ink' : 'text-muted hover:text-paper')
                }
              >
                Video {side.toUpperCase()}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onCompare}
          className="rounded px-1.5 py-1 text-[12px] text-faint transition-colors hover:text-paper"
        >
          See A vs B →
        </button>
      </div>
    </div>
  )
}
