import { Section } from '@/components/ui'
import { AUDIENCE_SIZE } from '@/store/useAppStore'

/**
 * Display controls and the honest note about what the island shows.
 *
 * Shadows are the one toggle that reliably buys frames on a weak laptop, so it
 * lives here rather than being a constant the demo cannot change on the spot.
 */
export function ViewOptions({
  shadows,
  onShadowsChange,
  sourceLabel,
  playing,
}: {
  shadows: boolean
  onShadowsChange(value: boolean): void
  sourceLabel: string
  playing: boolean
}) {
  return (
    <Section title="The town" className="border-b-0">
      <label className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ui-text">Shadows</span>
        <input
          type="checkbox"
          checked={shadows}
          onChange={(event) => onShadowsChange(event.target.checked)}
          className="h-4 w-4 accent-[var(--color-sun)]"
        />
      </label>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ui-faint">
        Turn these off if the town stutters. Nothing about the simulation changes.
      </p>

      <dl className="mt-3.5 space-y-1.5 border-t border-ui-border pt-3.5 text-[11.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ui-muted">Living in town</dt>
          <dd className="tnum text-ui-text">
            {AUDIENCE_SIZE.onIsland} of {AUDIENCE_SIZE.total}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ui-muted">Simulation</dt>
          <dd className="truncate text-ui-text">{sourceLabel}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ui-muted">Playback</dt>
          <dd className="text-ui-text">{playing ? 'Playing' : 'Paused'}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-ui-faint">
        All {AUDIENCE_SIZE.total} fictional Millbrook residents live in town, are simulated and
        appear in the network view. Audience groups follow your onboarding shares, rounded to
        whole people.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-ui-faint">
        Residents chat among themselves for atmosphere. That small talk is decoration — only the
        emoji reactions above their heads come from the simulation.
      </p>
    </Section>
  )
}
