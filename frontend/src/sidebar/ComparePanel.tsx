import { useAppStore } from '@/store/useAppStore'
import { EmptyState, Section } from '@/components/ui'
import type { RunMetrics } from '@/data/types'
import type { RunState } from '@/store/useAppStore'

/**
 * Original against revision.
 *
 * An inconclusive result is a real outcome here, not a failure to decide. When
 * two versions land inside each other's trial spread, the honest answer is that
 * the simulation cannot tell them apart — and saying so is more useful than
 * declaring a winner by a margin the model cannot support.
 */
export function ComparePanel() {
  const runs = useAppStore((state) => state.runs)
  const activeRunId = useAppStore((state) => state.activeRunId)
  const compareRunId = useAppStore((state) => state.compareRunId)
  const setCompareRun = useAppStore((state) => state.setCompareRun)

  const complete = Object.values(runs).filter(
    (run): run is RunState & { metrics: RunMetrics } =>
      run.status === 'complete' && run.metrics !== undefined,
  )

  if (complete.length < 2) {
    return (
      <Section title="Compare versions">
        <EmptyState title="Two finished runs needed">
          Upload a revision, run it, and the two are compared here against the same audience and
          starting exposure.
        </EmptyState>
      </Section>
    )
  }

  const left = complete.find((run) => run.id === activeRunId) ?? complete[0]
  const right =
    complete.find((run) => run.id === compareRunId && run.id !== left?.id) ??
    complete.find((run) => run.id !== left?.id)

  if (!left || !right) return null

  const leftSpread = left.metrics.spread
  const rightSpread = right.metrics.spread

  const sameAudience =
    left.options.audienceVersion === right.options.audienceVersion &&
    left.options.seed === right.options.seed &&
    left.options.seedExposure === right.options.seedExposure

  // Declare a winner only when each run's typical result sits outside the
  // other's P10-P90 band, in both directions.
  //
  // The obvious test - "do the two bands overlap at all?" - is uselessly
  // conservative: two runs whose bands graze each other by a few actions at the
  // extreme tails were being called a tie while one of them tripled the other's
  // median. Comparing medians against the opposing band keeps the honest
  // refusal to split hairs without throwing away a result this clear.
  const separated = (a: RunMetrics['spread'], b: RunMetrics['spread']) =>
    a.p50 > b.p90 || a.p50 < b.p10
  const decisive =
    leftSpread.p50 !== rightSpread.p50 &&
    separated(leftSpread, rightSpread) &&
    separated(rightSpread, leftSpread)

  const winner = !decisive ? null : leftSpread.p50 > rightSpread.p50 ? left : right
  const margin = Math.abs(leftSpread.p50 - rightSpread.p50)

  return (
    <>
      <Section title="Compare versions">
        <div className="flex items-center gap-2">
          <p className="flex-1 truncate text-[12.5px] text-paper">{left.label}</p>
          <span className="text-[11px] text-faint">against</span>
          <select
            value={right.id}
            onChange={(event) => setCompareRun(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1.5 text-[12.5px] text-paper focus:border-sun focus:outline-none"
            aria-label="Version to compare against"
          >
            {complete
              .filter((run) => run.id !== left.id)
              .map((run) => (
                <option key={run.id} value={run.id}>
                  {run.label}
                </option>
              ))}
          </select>
        </div>

        <div
          className={
            'mt-4 rounded-lg border px-3.5 py-3 ' +
            (winner ? 'border-sun/30 bg-sun/[0.07]' : 'border-line bg-ink')
          }
        >
          {winner ? (
            <>
              <p className="display text-[14px] text-sun">{winner.label} does better</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                About {margin} more simulated actions in a typical run, with each version's
                typical result outside the other's range across 200 trials. A modelled ranking,
                not a measured improvement.
              </p>
            </>
          ) : (
            <>
              <p className="display text-[14px] text-paper">Too close to call</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Across 200 trials these two land inside each other's range, so this simulation
                cannot separate them. Either change something bigger, or treat them as
                equivalent.
              </p>
            </>
          )}
        </div>

        {!sameAudience && (
          <p className="mt-3 rounded-lg border border-bloom/30 bg-bloom/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
            These runs used different audience or exposure settings, so the comparison is not
            like-for-like. Re-run them with the same settings before trusting the gap.
          </p>
        )}
      </Section>

      <Section title="Side by side">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-faint">
              <th className="pb-2 text-left font-normal" />
              <th className="pb-2 text-right font-normal">{left.label}</th>
              <th className="pb-2 text-right font-normal">{right.label}</th>
            </tr>
          </thead>
          <tbody className="tnum">
            <ComparisonRow label="Members reached" a={left.metrics.uniqueExposed} b={right.metrics.uniqueExposed} />
            <ComparisonRow label="Watched through" a={left.metrics.watch} b={right.metrics.watch} />
            <ComparisonRow label="Liked" a={left.metrics.likes} b={right.metrics.likes} />
            <ComparisonRow label="Replied" a={left.metrics.comments} b={right.metrics.comments} />
            <ComparisonRow label="Shared" a={left.metrics.shares} b={right.metrics.shares} />
            <ComparisonRow label="Rounds of spread" a={left.metrics.rounds} b={right.metrics.rounds} />
          </tbody>
        </table>

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Across 200 trials, a typical run produced {leftSpread.p50} actions for {left.label} (range {leftSpread.p10}–{leftSpread.p90}) and{' '}
          {rightSpread.p50} for {right.label} (range {rightSpread.p10}–{rightSpread.p90}). Reach and
          interactions are listed separately and are not added together.
        </p>
      </Section>
    </>
  )
}

function ComparisonRow({ label, a, b }: { label: string; a: number; b: number }) {
  const better = a === b ? null : a > b ? 'a' : 'b'
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 text-muted">{label}</td>
      <td className={'py-1.5 text-right ' + (better === 'a' ? 'text-sun' : 'text-paper')}>{a}</td>
      <td className={'py-1.5 text-right ' + (better === 'b' ? 'text-sun' : 'text-paper')}>{b}</td>
    </tr>
  )
}
