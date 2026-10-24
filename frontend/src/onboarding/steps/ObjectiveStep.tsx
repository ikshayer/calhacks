import { useState } from 'react'
import type { Objective } from '@/data/types'
import { Button, Field, Input } from '@/components/ui'
import { TONE_OPTIONS } from '@/onboarding/suggestAudience'
import type { StepProps } from './CompanyStep'

const OBJECTIVES: { id: Objective; label: string; blurb: string }[] = [
  {
    id: 'engagement',
    label: 'Engagement',
    blurb: 'Watch-through, likes, comments and shares. The default, and what the simulation models best.',
  },
  {
    id: 'reach',
    label: 'Reach',
    blurb: 'How many distinct people see it at all. Reported separately from interactions, never added to them.',
  },
  {
    id: 'conversion',
    label: 'Turning up',
    blurb: 'People who act on the ask. The simulation cannot measure this, so it is treated as a goal, not a prediction.',
  },
]

export function ObjectiveStep({ draft, patch }: StepProps) {
  const [account, setAccount] = useState('')

  const toggleTone = (tone: string) =>
    patch({
      tone: draft.tone.includes(tone)
        ? draft.tone.filter((entry) => entry !== tone)
        : [...draft.tone, tone],
    })

  const addAccount = () => {
    const handle = account.trim().replace(/^@/, '')
    if (!handle || draft.inspirationAccounts.includes(handle)) return
    patch({ inspirationAccounts: [...draft.inspirationAccounts, handle] })
    setAccount('')
  }

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="mb-2.5 text-[13px] font-medium text-paper">What matters most</legend>
        <div className="space-y-2">
          {OBJECTIVES.map((objective) => {
            const selected = draft.objective === objective.id
            return (
              <button
                key={objective.id}
                onClick={() => patch({ objective: objective.id })}
                aria-pressed={selected}
                className={
                  'block w-full rounded-lg border px-3.5 py-3 text-left transition-colors ' +
                  (selected
                    ? 'border-sun bg-sun/[0.07]'
                    : 'border-line bg-panel hover:border-faint')
                }
              >
                <span className="display block text-[14px] text-paper">{objective.label}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                  {objective.blurb}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-[13px] font-medium text-paper">How you want to sound</legend>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((tone) => {
            const selected = draft.tone.includes(tone)
            return (
              <button
                key={tone}
                onClick={() => toggleTone(tone)}
                aria-pressed={selected}
                className={
                  'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ' +
                  (selected
                    ? 'border-sun bg-sun text-ink'
                    : 'border-line bg-panel text-muted hover:text-paper')
                }
              >
                {tone}
              </button>
            )
          })}
        </div>
      </fieldset>

      <Field
        label="Accounts worth learning from"
        hint="Optional. We look for reference videos in this niche, including ordinary performers — not only the ones that went big."
      >
        <div className="flex items-center gap-2">
          <Input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addAccount()
              }
            }}
            placeholder="@localharvestshare"
          />
          <Button variant="secondary" onClick={addAccount} disabled={!account.trim()}>
            Add
          </Button>
        </div>
      </Field>

      {draft.inspirationAccounts.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {draft.inspirationAccounts.map((handle) => (
            <li key={handle}>
              <button
                onClick={() =>
                  patch({
                    inspirationAccounts: draft.inspirationAccounts.filter((entry) => entry !== handle),
                  })
                }
                className="rounded-full bg-raised px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-bloom"
                title={`Remove @${handle}`}
              >
                @{handle} ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
