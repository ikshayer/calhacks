import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
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
  const startIdeaTest = useAppStore((state) => state.startIdeaTest)
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [budget, setBudget] = useState('')
  const [options, setOptions] = useState<OptionRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const updateOption = (index: number, patch: Partial<OptionRow>) =>
    setOptions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const run = () => {
    setError(null)
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
    // Progress and the result show on the island and sidebar, not in this card.
    void startIdeaTest({ prompt: prompt.trim(), budgetUsd, options: parsed })
    navigate('/workspace')
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
                          onChange={(event) => updateOption(index, { name: event.target.value })}
                  placeholder="Campaign name"
                  aria-label={`Campaign ${index + 1} name`}
                />
                <Input
                  type="number"
                  min={0}
                  value={row.cost}
                          onChange={(event) => updateOption(index, { cost: event.target.value })}
                  placeholder="Cost $"
                  aria-label={`Campaign ${index + 1} cost`}
                  className="max-w-[110px]"
                />
                <Button
                  variant="ghost"
                  type="button"
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
                  className="mt-2"
              onClick={() => setOptions((rows) => [...rows, { name: '', cost: '' }])}
            >
              Add a campaign
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={run} disabled={prompt.trim() === ''}>
            Run
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-bloom">
            {error}
          </p>
        )}
      </div>

      <p className="mt-4 text-[11.5px] text-faint">
        Simulated residents of a fictional town — not consumer research, not a sales forecast.
      </p>
    </section>
  )
}
