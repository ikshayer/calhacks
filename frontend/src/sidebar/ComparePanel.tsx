import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { EmptyState, Section } from '@/components/ui'
import type { RunMetrics } from '@/data/types'
import type { RunState } from '@/store/useAppStore'
import { sameRunAudience } from '@/data/runCompatibility'
import type { GroupMetrics } from '@/data/types'

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

  const sameAudience = sameRunAudience(left.options, right.options)

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
    sameAudience &&
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
          {!sameAudience ? (
            <>
              <p className="display text-[14px] text-paper">Different simulation settings</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                These results cannot establish a winner. Run both versions against the same
                Millbrook audience and exposure settings to compare them.
              </p>
            </>
          ) : winner ? (
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

        {sameAudience && (
          // Runs are stored in creation order, so the earlier one is the original.
          <WrittenComparison
            baseRunId={complete.indexOf(left) < complete.indexOf(right) ? left.id : right.id}
            revisedRunId={complete.indexOf(left) < complete.indexOf(right) ? right.id : left.id}
          />
        )}

        {!sameAudience && (
          <p className="mt-3 rounded-lg border border-bloom/30 bg-bloom/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
            {!left.options.audienceKey || !right.options.audienceKey
              ? 'A saved run belongs to the previous audience. Its original results remain available.'
              : 'These runs used different audience or exposure settings.'}
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

      <AbBreakdown decisive={decisive} />
    </>
  )
}

/**
 * The live backend's plain-language account of the difference (Claude, grounded
 * in both videos and the matched-member deltas). The mock has none and renders nothing.
 */
function WrittenComparison({ baseRunId, revisedRunId }: { baseRunId: string; revisedRunId: string }) {
  const source = useAppStore((state) => state.source)
  const [result, setResult] = useState<{ key: string; text: string | null; error?: string } | null>(null)
  const key = `${baseRunId}:${revisedRunId}`

  useEffect(() => {
    let live = true
    source
      .compareRuns(baseRunId, revisedRunId)
      .then((text) => {
        if (live) setResult({ key, text })
      })
      .catch((cause: unknown) => {
        if (live) setResult({ key, text: null, error: cause instanceof Error ? cause.message : 'The comparison could not be written.' })
      })
    return () => {
      live = false
    }
  }, [source, baseRunId, revisedRunId, key])

  const current = result?.key === key ? result : null
  if (current?.error) return <p className="mt-3 text-[12px] leading-relaxed text-bloom">{current.error}</p>
  if (!current) {
    return source.kind === 'spacetime' ? (
      <p className="mt-3 text-[12px] leading-relaxed text-faint">Writing up the difference…</p>
    ) : null
  }
  if (!current.text) return null
  return (
    <div className="mt-3">
      <p className="text-[12.5px] leading-relaxed text-muted">{current.text}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
        Written by Claude from the two analyses and the simulated results.
      </p>
    </div>
  )
}

/**
 * Where video A and video B differ: who only one of them reached, and each audience group's
 * reach and likes. Shown only for an A/B test. When the overall result is inside the trial
 * spread, the gaps here are described as noise, not as wins.
 */
function AbBreakdown({ decisive }: { decisive: boolean }) {
  const ab = useAppStore((state) => state.ab)
  const runs = useAppStore((state) => state.runs)
  const groups = useAppStore((state) => state.profile?.groups)
  if (!ab) return null
  const a = runs[ab.a.runId]
  const b = runs[ab.b.runId]
  if (!a?.metrics || !b?.metrics || a.status !== 'complete' || b.status !== 'complete') return null

  const reached = (run: RunState) => new Set(run.rounds.flatMap((round) => round.exposed))
  const reachedA = reached(a)
  const reachedB = reached(b)
  // Rounds are not stored across a reload, so without them the overlap cannot be computed.
  const haveRounds = reachedA.size > 0 && reachedB.size > 0
  const onlyA = [...reachedA].filter((id) => !reachedB.has(id)).length
  const onlyB = [...reachedB].filter((id) => !reachedA.has(id)).length
  const both = reachedA.size - onlyA

  const byGroup = new Map<string, { a?: GroupMetrics; b?: GroupMetrics }>()
  for (const row of a.metrics.byGroup) byGroup.set(row.groupId, { ...byGroup.get(row.groupId), a: row })
  for (const row of b.metrics.byGroup) byGroup.set(row.groupId, { ...byGroup.get(row.groupId), b: row })
  const label = (id: string) => groups?.find((group) => group.id === id)?.label ?? id

  const lead = (x: number, y: number) => (x === y ? '=' : x > y ? 'A' : 'B')

  return (
    <Section title="Where each one wins">
      {haveRounds && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {onlyA} residents saw only Video A, {onlyB} saw only Video B, and {both} saw both.
        </p>
      )}
      <table className="mt-3 w-full text-[12px]">
        <thead>
          <tr className="text-[11px] text-faint">
            <th className="pb-2 text-left font-normal">Group</th>
            <th className="pb-2 text-right font-normal" colSpan={2}>Reached A / B</th>
            <th className="pb-2 text-right font-normal" colSpan={2}>Likes A / B</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {[...byGroup.entries()].map(([id, row]) => {
            const reachA = row.a?.exposed ?? 0
            const reachB = row.b?.exposed ?? 0
            const likesA = row.a?.likes ?? 0
            const likesB = row.b?.likes ?? 0
            return (
              <tr key={id} className="border-t border-line">
                <td className="py-1.5 text-muted">{label(id)}</td>
                <td className="py-1.5 text-right text-paper">{reachA} / {reachB}</td>
                <td className="w-6 py-1.5 text-right text-sun">{lead(reachA, reachB)}</td>
                <td className="py-1.5 text-right text-paper">{likesA} / {likesB}</td>
                <td className="w-6 py-1.5 text-right text-sun">{lead(likesA, likesB)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        {decisive
          ? 'The overall result is outside the trial spread; per-group gaps are smaller samples and less certain.'
          : 'The overall result is inside the trial spread, so treat these gaps as noise, not as wins.'}
      </p>
    </Section>
  )
}

function ComparisonRow({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 text-muted">{label}</td>
      <td className="py-1.5 text-right text-paper">{a}</td>
      <td className="py-1.5 text-right text-paper">{b}</td>
    </tr>
  )
}
