import { useAppStore } from '@/store/useAppStore'
import { Section, Stat } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { chartNumber, ideaResponse, nonnegative, recommendedOption } from '@/data/overviewStats'
import { ChartBar, ResponseDonut } from './OverviewCharts'

/** The overview shows the result; the assistant retains the complete report. */
export function IdeaPanel({ onAsk }: { onAsk(): void }) {
  const idea = useAppStore((state) => state.idea)
  const clearIdeaTest = useAppStore((state) => state.clearIdeaTest)
  if (!idea) return null
  const result = idea.status === 'ready' ? idea.result : undefined
  const response = result ? ideaResponse(result.residents) : undefined
  const target = result ? ideaResponse(result.residents.filter((resident) => resident.inTarget)) : undefined
  const options = idea.input.options
  const visits = result?.metrics?.optionVisits ?? []
  const ceiling = Math.max(0, ...visits.map((value) => nonnegative(value) ?? 0))
  const recommended = recommendedOption(options, result?.analysis?.recommendedCampaign, result?.plain?.bestBet.what)
  const budget = nonnegative(idea.input.budgetUsd)
  const targetsEveryone = result?.minAge === undefined && result?.maxAge === undefined

  return (
    <>
      <Section title="Audience response" className="py-3" aside={
        <Button variant="ghost" size="sm" onClick={clearIdeaTest}>Exit idea</Button>
      }>
        {!result || !response ? (
          <p role={idea.status === 'failed' ? 'alert' : 'status'} className={`text-[12px] ${idea.status === 'failed' ? 'text-ui-danger' : 'text-ui-muted'}`}>
            {idea.status === 'failed' ? (idea.error || 'The idea test failed.') : idea.status === 'ready' ? 'No result was returned.' : (idea.stage || 'Testing the idea…')}
          </p>
        ) : (
          <>
            <ResponseDonut response={response} />
            <p className="mt-1 text-[11px] text-ui-faint">{response.scored} scored · {response.missing} unscored, excluded</p>
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-ui-border bg-ui-well p-3">
              <Stat label="Expected visits" value={chartNumber(result.metrics?.expectedVisits, 1)} tone="leaf" />
              <Stat label="Expected shares" value={chartNumber(result.metrics?.expectedShares, 1)} tone="bloom" />
              <Stat label="Target scored" value={target?.scored ?? 0} />
            </div>
            {!targetsEveryone && target && (
              <div className="mt-3 space-y-2.5">
                <ChartBar label={`Target · ${result.targetLabel}`} value={target.scored ? target.counts.going / target.scored : undefined} max={1}
                  detail={target.scored ? `${target.counts.going} / ${target.scored} would go` : 'No scored sample'} color="#7fb069" />
                <ChartBar label="Whole town" value={response.scored ? response.counts.going / response.scored : undefined} max={1}
                  detail={response.scored ? `${response.counts.going} / ${response.scored} would go` : 'No scored sample'} color="#6aa9c9" />
                {target.scored < 5 && <p className="text-[10.5px] text-ui-faint">{target.scored ? 'Small target sample' : 'No target predictions'} · {target.missing} unscored</p>}
              </div>
            )}
          </>
        )}
      </Section>
      {result && options.length > 0 && (
        <Section title="Campaign options" className="py-3" aside={<span className="text-[11px] text-ui-faint">{budget === undefined ? 'Budget unset' : `$${chartNumber(budget)} budget`}</span>}>
          <div className="space-y-3">
            {options.map((option, index) => {
              const cost = nonnegative(option.costUsd)
              const overBudget = budget !== undefined && cost !== undefined && cost > budget
              return <div key={`${index}:${option.name}`}>
                <ChartBar label={option.name} value={visits[index]} max={ceiling}
                  detail={`${chartNumber(visits[index], 1)} visits`} />
                <p className="mt-1 text-[10.5px] text-ui-faint">Option {index + 1} · ${chartNumber(cost)}{overBudget ? ' · Over budget' : ''}</p>
              </div>
            })}
          </div>
          {recommended && <p className="mt-3 truncate text-[12px] font-medium text-ui-text" title={recommended}>Recommended: {recommended}</p>}
        </Section>
      )}
      <div className="flex justify-end px-4 py-3">
        <Button variant="outline" size="sm" onClick={onAsk}>Ask assistant</Button>
      </div>
    </>
  )
}
