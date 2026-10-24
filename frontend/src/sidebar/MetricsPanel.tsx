import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { EmptyState, Section, Stat } from '@/components/ui'
import type { RoundEvent } from '@/data/types'

/**
 * Live run totals.
 *
 * Counted from the rounds actually played back, so the numbers climb in step
 * with the island rather than appearing complete before the cascade has
 * finished animating.
 *
 * Reach and interactions are shown in separate blocks and never added
 * together: unique exposure, watch-throughs and shares are different
 * quantities, and summing them into one "score" would be the quickest way to
 * make this tool lie.
 */
export function MetricsPanel() {
  const run = useAppStore(selectActiveRun)
  const round = useAppStore((state) => state.playback.round)
  const audienceSize = useAppStore((state) => state.audience?.members.length ?? 0)

  if (!run) {
    return (
      <Section title="Results">
        <EmptyState title="Nothing has run yet">
          Upload a video and start a simulation to see how the audience responds.
        </EmptyState>
      </Section>
    )
  }

  const visible = run.rounds.slice(0, round)
  const live = tally(visible)
  const finished = run.status === 'complete' && round >= run.rounds.length
  const metrics = run.metrics

  return (
    <Section
      title="Results"
      aside={
        <span className="tnum text-[11.5px] text-faint">
          {finished ? 'final' : `round ${round}`}
        </span>
      }
    >
      <div className="rounded-lg border border-line bg-ink px-3.5 py-3">
        <div className="flex items-end justify-between gap-3">
          <Stat
            label={`of ${audienceSize} members have seen it`}
            value={live.exposed}
            tone="water"
          />
          <p className="tnum text-[12.5px] text-muted">
            {audienceSize > 0 ? `${((live.exposed / audienceSize) * 100).toFixed(0)}%` : '—'}
          </p>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Distinct members reached, counted once each. Not views — one person can watch twice.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-line bg-ink px-3.5 py-3">
        <Stat label="watched" value={live.watch} />
        <Stat label="liked" value={live.likes} tone="leaf" />
        <Stat label="replied" value={live.comments} tone="sun" />
        <Stat label="shared" value={live.shares} tone="bloom" />
      </div>

      {metrics && (
        <dl className="mt-3 space-y-1.5 text-[11.5px]">
          <Row
            label="Prediction coverage"
            value={`${(metrics.coverage * 100).toFixed(1)}%`}
            note={
              metrics.missing > 0
                ? `${metrics.missing} members returned no prediction and are excluded from the totals`
                : undefined
            }
          />
          <Row
            label="Spread across 200 trials"
            value={`${metrics.spread.p10}–${metrics.spread.p90} actions`}
            note="Variability within these assumptions, not a prediction interval"
          />
        </dl>
      )}
    </Section>
  )
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted">{label}</dt>
        <dd className="tnum text-paper">{value}</dd>
      </div>
      {note && <p className="mt-0.5 text-[10.5px] leading-snug text-faint">{note}</p>}
    </div>
  )
}

function tally(rounds: RoundEvent[]) {
  const totals = { exposed: 0, watch: 0, likes: 0, comments: 0, shares: 0 }
  for (const round of rounds) {
    totals.exposed += round.exposed.length
    for (const act of round.acted) {
      for (const kind of act.kinds) {
        if (kind === 'watch') totals.watch++
        else if (kind === 'like') totals.likes++
        else if (kind === 'comment') totals.comments++
        else totals.shares++
      }
    }
  }
  return totals
}
