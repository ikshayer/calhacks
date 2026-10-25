import { useState } from 'react'
import type { CompanyProfile, Objective } from '@/data/types'
import { BigInput, StepShell } from './StepShell'

const OBJECTIVES: { id: Objective; label: string; blurb: string }[] = [
  { id: 'engagement', label: 'Engagement', blurb: 'Likes, comments, shares.' },
  { id: 'reach', label: 'Reach', blurb: 'How far it travels.' },
  { id: 'conversion', label: 'Turning up', blurb: 'People who actually act.' },
]

/**
 * The optional fourth step.
 *
 * Everything here improves the simulation without being needed to start one,
 * so the step says so and offers a real way past it. Two of these fields are
 * not decoration: the live backend builds its reference-reel scrape from the
 * Instagram handle plus these accounts, so filling them in is what gets you
 * comparisons against real posts in your niche.
 */
export function DetailsStep({
  draft,
  patch,
  total,
}: {
  draft: CompanyProfile
  patch(changes: Partial<CompanyProfile>): void
  total: number
}) {
  const [account, setAccount] = useState('')

  const addAccount = () => {
    const handle = account.trim().replace(/^@/, '')
    if (!handle || draft.inspirationAccounts.includes(handle)) {
      setAccount('')
      return
    }
    patch({ inspirationAccounts: [...draft.inspirationAccounts, handle] })
    setAccount('')
  }

  return (
    <StepShell
      step={4}
      total={total}
      question="Anything else that would help?"
      help="All optional. You can skip this and fill it in later."
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Website">
            <BigInput
              autoFocus
              value={draft.website ?? ''}
              onChange={(event) => patch({ website: event.target.value })}
              placeholder="givinggarden.org"
              aria-label="Website"
            />
          </Labelled>
          <Labelled label="Instagram">
            <BigInput
              value={draft.instagram ?? ''}
              onChange={(event) => patch({ instagram: event.target.value })}
              placeholder="@givinggarden"
              aria-label="Instagram handle"
            />
          </Labelled>
        </div>

        <Labelled
          label="Accounts worth learning from"
          hint="We look for reference reels in this niche, including ordinary performers — not only the ones that went big."
        >
          <div className="flex gap-2">
            <BigInput
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                // Enter advances the wizard everywhere else; here it belongs to the chip list.
                event.preventDefault()
                event.stopPropagation()
                addAccount()
              }}
              placeholder="@anotherGarden"
              aria-label="Account to learn from"
            />
            <button
              type="button"
              onClick={addAccount}
              className="h-14 shrink-0 rounded-lg border border-ui-border px-4 text-[15px] font-medium text-graphite transition-colors hover:border-ui-edge"
            >
              Add
            </button>
          </div>
          {draft.inspirationAccounts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.inspirationAccounts.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  onClick={() =>
                    patch({
                      inspirationAccounts: draft.inspirationAccounts.filter((a) => a !== handle),
                    })
                  }
                  className="group flex items-center gap-1.5 rounded-full bg-ui-raised px-3 py-1 text-[14px] text-subtle transition-colors hover:text-graphite"
                >
                  @{handle}
                  <span aria-hidden className="text-[16px] leading-none">
                    ×
                  </span>
                  <span className="sr-only">Remove</span>
                </button>
              ))}
            </div>
          )}
        </Labelled>

        <Labelled label="What matters most">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {OBJECTIVES.map((option) => {
              const selected = draft.objective === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ objective: option.id })}
                  className={
                    'rounded-lg border px-3.5 py-3 text-left transition-colors ' +
                    (selected
                      ? 'border-primary bg-primary/[0.06]'
                      : 'border-ui-border bg-card hover:border-ui-edge')
                  }
                >
                  <span className="block text-[15px] font-medium text-graphite">{option.label}</span>
                  <span className="mt-0.5 block text-[13.5px] text-subtle">{option.blurb}</span>
                </button>
              )
            })}
          </div>
        </Labelled>
      </div>
    </StepShell>
  )
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-2 text-[15px] font-medium text-graphite">{label}</p>
      {hint && <p className="mb-2.5 max-w-[56ch] text-[13.5px] leading-relaxed text-subtle">{hint}</p>}
      {children}
    </div>
  )
}
