import { useMemo, useState } from 'react'
import type { IdeaOption, IdeaResident, IdeaTestResult } from '@/data/types'
import { VERDICT_STYLE, verdictOf, type IdeaVerdict } from '@/data/ideaVerdict'
import { useAppStore } from '@/store/useAppStore'
import { Button, Section } from '@/components/ui'

const DISCLOSURE = 'Simulated residents of a fictional town — not consumer research, not a sales forecast.'
const SMALL_SAMPLE = 5
const VERDICTS: IdeaVerdict[] = ['going', 'maybe', 'not']
const MAX_NAMES = 12
const VERDICT_EMOJI: Record<IdeaVerdict, string> = { going: '🟢', maybe: '🟡', not: '⚪' }

type Counts = Record<IdeaVerdict, number>

function tally(residents: IdeaResident[]): { counts: Counts; scored: number } {
  const counts: Counts = { going: 0, maybe: 0, not: 0 }
  let scored = 0
  for (const resident of residents) {
    const verdict = verdictOf(resident)
    if (!verdict) continue
    counts[verdict] += 1
    scored += 1
  }
  return { counts, scored }
}

/**
 * The result of testing one idea on the town, pinned at the top of the sidebar.
 *
 * The rings on the island and every number here come from the same
 * `verdictOf` rule, so the panel and the picture cannot disagree.
 */
export function IdeaPanel() {
  const idea = useAppStore((state) => state.idea)
  const clearIdeaTest = useAppStore((state) => state.clearIdeaTest)
  const selectMember = useAppStore((state) => state.selectMember)

  if (!idea) return null
  const result = idea.status === 'ready' ? idea.result : undefined

  return (
    <div className="border-b border-line bg-panel">
      <Section
        title="Idea test"
        aside={
          <Button variant="ghost" className="!px-2 !py-1 !text-[12px]" onClick={clearIdeaTest}>
            Exit idea view
          </Button>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-paper">{idea.input.prompt}</p>
        {idea.status === 'running' && (
          <p className="mt-2 text-[12px] leading-relaxed text-sun">{idea.stage || 'Starting…'}</p>
        )}
        {idea.status === 'failed' && (
          <p className="mt-2 text-[12px] leading-relaxed text-bloom">
            {idea.error ?? 'The idea test failed.'}
          </p>
        )}
        {idea.status === 'ready' && !result && (
          <p className="mt-2 text-[12px] leading-relaxed text-bloom">The idea test finished without a result.</p>
        )}
      </Section>
      {result && <IdeaResult result={result} options={idea.input.options} onSelect={selectMember} />}
      <p className="px-4 pb-4 text-[11px] leading-relaxed text-faint">{DISCLOSURE}</p>
    </div>
  )
}

/** The analyst writes long, careful sentences; the overview shows only the first one, without asides. */
function firstSentence(text: string): string {
  const withoutAsides = text.replace(/\s*\([^)]*\)/g, '')
  const match = withoutAsides.match(/^.*?[.!?](?=\s|$)/)
  return (match ? match[0] : withoutAsides).trim()
}

function people(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`
}

function IdeaResult({
  result,
  options,
  onSelect,
}: {
  result: IdeaTestResult
  options: IdeaOption[]
  onSelect(memberId: number): void
}) {
  const [showAll, setShowAll] = useState(false)
  const target = useMemo(() => tally(result.residents.filter((resident) => resident.inTarget)), [result])
  const town = useMemo(() => tally(result.residents), [result])
  const byVerdict = useMemo(() => {
    const grouped: Record<IdeaVerdict, IdeaResident[]> = { going: [], maybe: [], not: [] }
    for (const resident of result.residents) {
      const verdict = verdictOf(resident)
      if (verdict) grouped[verdict].push(resident)
    }
    for (const verdict of VERDICTS) grouped[verdict].sort((a, b) => b.pVisit - a.pVisit)
    return grouped
  }, [result])
  const analysis = result.analysis
  const plain = result.plain
  const targetsEveryone = result.minAge === undefined && result.maxAge === undefined

  return (
    <>
      <Section title="The answer">
        <p className="text-[13px] leading-relaxed text-paper">
          We asked {people(town.scored)} in town. {VERDICT_EMOJI.going} {town.counts.going} would go,{' '}
          {VERDICT_EMOJI.maybe} {town.counts.maybe} maybe, {VERDICT_EMOJI.not} {town.counts.not} would not.
        </p>
        {!targetsEveryone &&
          (target.scored === 0 ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Nobody in town is {result.targetLabel}, so this is everyone&apos;s answer.
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Of the {people(target.scored)} who are {result.targetLabel}: {target.counts.going} would go.
              {target.scored < SMALL_SAMPLE ? ' That is a very small group.' : ''}
            </p>
          ))}
        <VerdictBar counts={town.counts} scored={town.scored} />
        <p className="mt-2 text-[11px] text-faint">The coloured rings on the island match these.</p>
        {plain && (
          <div className="mt-3">
            <p className="text-[12.5px] leading-relaxed text-paper">{plain.answer.text}</p>
            <Why>{plain.answer.because}</Why>
          </div>
        )}
      </Section>

      {plain && (
        <>
          <Section title="Best bet">
            <p className="text-[12.5px] leading-relaxed text-paper">{plain.bestBet.what}</p>
            <Why>{plain.bestBet.because}</Why>
            <OptionTable options={options}visits={result.metrics?.optionVisits ?? []} />
          </Section>
          <Section title="Try this first">
            <p className="text-[12.5px] leading-relaxed text-paper">{plain.experiment.what}</p>
            <Why>{plain.experiment.because}</Why>
          </Section>
          <Section title="How you'll know it worked">
            <p className="text-[12.5px] leading-relaxed text-paper">{plain.howYouKnow.what}</p>
            <Why>{plain.howYouKnow.because}</Why>
          </Section>
          {plain.objections.length > 0 && (
            <Section title="Why some would say no">
              <ul className="space-y-3">
                {plain.objections.map((objection) => (
                  <li key={objection.reason}>
                    <p className="text-[12.5px] leading-relaxed text-paper">{objection.reason}</p>
                    <Why>{objection.because}</Why>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {!plain && analysis && (
        <Section title="What to try">
          <dl className="space-y-2 text-[12.5px] leading-relaxed">
            <div>
              <dt className="text-[11px] text-faint">Best bet</dt>
              <dd className="text-paper">{firstSentence(analysis.recommendedCampaign)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-faint">Try this first, for real</dt>
              <dd className="text-muted">{firstSentence(analysis.experiment)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-faint">How you will know it worked</dt>
              <dd className="text-muted">{firstSentence(analysis.successMetric)}</dd>
            </div>
          </dl>
        </Section>
      )}

      {!plain && analysis && analysis.objections.length > 0 && (
        <Section title="Why some would say no">
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-muted">
            {analysis.objections.map((objection) => (
              <li key={objection}>• {firstSentence(objection.split(':')[0] ?? objection)}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Who said what">
        <p className="mb-2 text-[11.5px] text-faint">Tap a name to see why.</p>
        <div className="space-y-3">
          {VERDICTS.map((verdict) => {
            const residents = byVerdict[verdict]
            if (residents.length === 0) return null
            const shown = residents.slice(0, MAX_NAMES)
            return (
              <div key={verdict}>
                <p className="mb-1.5 text-[11px]" style={{ color: VERDICT_STYLE[verdict].color }}>
                  {VERDICT_EMOJI[verdict]} {VERDICT_STYLE[verdict].label} · {residents.length}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {shown.map((resident) => (
                    <button
                      key={resident.memberId}
                      onClick={() => onSelect(resident.memberId)}
                      className="rounded-full bg-raised px-2 py-0.5 text-[11.5px] text-muted transition-colors hover:text-paper"
                    >
                      {resident.name}
                    </button>
                  ))}
                  {residents.length > shown.length && (
                    <span className="px-1 py-0.5 text-[11.5px] text-faint">
                      +{residents.length - shown.length} more
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {analysis && (
        <div className="border-b border-line px-4 py-3">
          <button
            onClick={() => setShowAll((open) => !open)}
            className="text-[12px] text-sun transition-colors hover:brightness-110"
            aria-expanded={showAll}
          >
            {showAll ? 'Hide the full analysis' : 'Show the full analysis'}
          </button>
        </div>
      )}
      {analysis && showAll && (
        <>
          <Section title="Recommended campaign">
            <p className="text-[12.5px] leading-relaxed text-muted">{analysis.recommendedCampaign}</p>
          </Section>
          <ListSection title="Evidence" items={analysis.evidence} />
          <ListSection title="Segments" items={analysis.segments} />
          <ListSection title="Objections" items={analysis.objections} />
          <Section title="Budget allocation">
            <p className="text-[12.5px] leading-relaxed text-muted">{analysis.budgetAllocation}</p>
          </Section>
          <Section title="Experiment">
            <p className="text-[12.5px] leading-relaxed text-muted">{analysis.experiment}</p>
          </Section>
          <Section title="Success metric">
            <p className="text-[12.5px] leading-relaxed text-muted">{analysis.successMetric}</p>
          </Section>
          <ListSection title="Assumptions" items={analysis.assumptions} />
          <ListSection title="Limitations" items={analysis.limitations} />
        </>
      )}
    </>
  )
}

function Why({ children }: { children: string }) {
  return (
    <p className="mt-1 text-[12px] leading-relaxed text-muted">
      <span className="font-medium text-faint">Why: </span>
      {children}
    </p>
  )
}

function OptionTable({ options, visits }: { options: IdeaOption[]; visits: number[] }) {
  if (options.length === 0) return null
  const max = Math.max(...options.map((_, i) => visits[i] ?? 0))
  return (
    <table className="mt-3 w-full text-[11.5px]">
      <thead>
        <tr className="text-left text-faint">
          <th className="pb-1 font-normal">Option</th>
          <th className="pb-1 text-right font-normal">Cost</th>
          <th className="pb-1 text-right font-normal">Simulated visits</th>
        </tr>
      </thead>
      <tbody>
        {options.map((option, i) => {
          const value = visits[i]
          const best = value !== undefined && value === max
          return (
            <tr key={option.name} className={best ? 'font-medium text-sun' : 'text-muted'}>
              <td className="py-0.5 pr-2">{option.name}</td>
              <td className="py-0.5 text-right tabular-nums">${option.costUsd}</td>
              <td className="py-0.5 text-right tabular-nums">{value === undefined ? '—' : value.toFixed(1)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function VerdictBar({ counts, scored }: { counts: Counts; scored: number }) {
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink">
      {VERDICTS.map((verdict) => (
        <span
          key={verdict}
          className="block h-full"
          style={{
            width: scored === 0 ? 0 : `${(counts[verdict] / scored) * 100}%`,
            background: VERDICT_STYLE[verdict].color,
          }}
        />
      ))}
    </div>
  )
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <Section title={title}>
      <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Section>
  )
}
