import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { IdeaTestResult } from '@/data/types'
import { Button, Field, Input, Textarea } from '@/components/ui'

const MAX_OPTIONS = 3

interface OptionRow {
  name: string
  cost: string
}

/**
 * Test an idea before there is any footage: the simulated town is asked
 * directly and the answer cites the residents behind it. The disclosure line is
 * always on screen, because nothing here is consumer research.
 */
export function IdeaTestCard() {
  const testIdea = useAppStore((state) => state.testIdea)
  const [prompt, setPrompt] = useState('')
  const [budget, setBudget] = useState('')
  const [options, setOptions] = useState<OptionRow[]>([])
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IdeaTestResult | null>(null)

  const updateOption = (index: number, patch: Partial<OptionRow>) =>
    setOptions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const run = async () => {
    setError(null)
    setResult(null)
    const budgetUsd = budget.trim() === '' ? undefined : Number(budget)
    if (budgetUsd !== undefined && !(Number.isFinite(budgetUsd) && budgetUsd >= 0)) {
      setError('The budget must be a number of dollars, or left blank.')
      return
    }
    const parsed = options
      .filter((row) => row.name.trim() !== '')
      .map((row) => ({ name: row.name.trim(), costUsd: row.cost.trim() === '' ? 0 : Number(row.cost) }))
    if (parsed.some((o) => !(Number.isFinite(o.costUsd) && o.costUsd >= 0))) {
      setError('Each campaign cost must be a number of dollars.')
      return
    }
    setRunning(true)
    setStage('Starting')
    try {
      setResult(await testIdea({ prompt: prompt.trim(), budgetUsd, options: parsed }, setStage))
    } catch (cause: unknown) {
      console.error('Idea test failed', cause)
      setError(cause instanceof Error ? cause.message : 'The idea test failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="display text-[18px] leading-tight text-paper">No video yet? Test an idea.</h2>
      <p className="mt-1 text-[12.5px] text-muted">
        Ask the simulated town whether an idea would land, before you shoot anything.
      </p>

      <div className="mt-4 space-y-3">
        <Textarea
          rows={3}
          value={prompt}
          disabled={running}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="I'm thinking about launching a boba shop, would people ages 18–21 come?"
          aria-label="The idea to test"
        />
        <Field label="Budget ($, optional)">
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            value={budget}
            disabled={running}
            onChange={(event) => setBudget(event.target.value)}
            className="max-w-[160px]"
          />
        </Field>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-paper">Campaigns to compare (optional)</p>
          <div className="space-y-2">
            {options.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.name}
                  disabled={running}
                  onChange={(event) => updateOption(index, { name: event.target.value })}
                  placeholder="Campaign name"
                  aria-label={`Campaign ${index + 1} name`}
                />
                <Input
                  type="number"
                  min={0}
                  value={row.cost}
                  disabled={running}
                  onChange={(event) => updateOption(index, { cost: event.target.value })}
                  placeholder="Cost $"
                  aria-label={`Campaign ${index + 1} cost`}
                  className="max-w-[110px]"
                />
                <Button
                  variant="ghost"
                  type="button"
                  disabled={running}
                  onClick={() => setOptions((rows) => rows.filter((_, i) => i !== index))}
                  aria-label={`Remove campaign ${index + 1}`}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {options.length < MAX_OPTIONS && (
            <Button
              variant="ghost"
              type="button"
              disabled={running}
              className="mt-2"
              onClick={() => setOptions((rows) => [...rows, { name: '', cost: '' }])}
            >
              Add a campaign
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void run()} disabled={running || prompt.trim() === ''}>
            {running ? 'Running' : 'Run'}
          </Button>
          {running && (
            <p role="status" className="text-[12.5px] text-muted">
              {stage}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-bloom">
            {error}
          </p>
        )}
      </div>

      {result && <IdeaResult result={result} />}

      <p className="mt-4 text-[11.5px] text-faint">
        Simulated residents of a fictional town — not consumer research, not a sales forecast.
      </p>
    </section>
  )
}

function IdeaResult({ result }: { result: IdeaTestResult }) {
  const { metrics, analysis } = result
  if (!metrics || !analysis) {
    return <p className="mt-4 text-[12.5px] text-bloom">The test finished without a result.</p>
  }
  const cited = result.residents
    .filter((r) => !r.missing)
    .sort((a, b) => b.pVisit - a.pVisit)
    .slice(0, 8)

  return (
    <div className="mt-5 space-y-4 border-t border-line pt-4">
      <p className="text-[14px] font-medium leading-snug text-paper">
        {metrics.interestedInTarget} of {metrics.inTarget} residents in {result.targetLabel} would probably go; whole
        town: {metrics.interested} of {metrics.scored}
      </p>
      {metrics.inTarget < 5 && (
        <p className="text-[12.5px] text-bloom">
          Small sample: only {metrics.inTarget} residents match this group, so treat the split as a hint.
        </p>
      )}
      <Block title="Recommended campaign">{analysis.recommendedCampaign}</Block>
      <List title="Evidence" items={analysis.evidence} />
      <List title="Segments" items={analysis.segments} />
      <List title="Top objections" items={analysis.objections.slice(0, 3)} />
      <Block title="Budget allocation">{analysis.budgetAllocation}</Block>
      <Block title="Experiment">{analysis.experiment}</Block>
      <Block title="Success metric">{analysis.successMetric}</Block>
      <List title="Assumptions" items={analysis.assumptions} />
      <List title="Limitations" items={analysis.limitations} />
      {cited.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-faint">Residents cited</h3>
          <ul className="space-y-1.5">
            {cited.map((r) => (
              <li key={r.memberId} className="text-[12.5px] leading-snug text-muted">
                <span className="text-paper">
                  {r.name}, {r.age}
                </span>{' '}
                · {Math.round(r.pVisit * 100)}% to visit · {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <p className="text-[13px] leading-relaxed text-muted">{children}</p>
    </div>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
