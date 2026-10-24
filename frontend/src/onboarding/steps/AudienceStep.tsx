import { useState } from 'react'
import type { AudienceGroup } from '@/data/types'
import { Button, Input, Meter } from '@/components/ui'
import { PALETTE, normaliseShares } from '@/onboarding/suggestAudience'
import type { StepProps } from './CompanyStep'

/**
 * Confirm or edit the suggested audience groups.
 *
 * The shares are the single most consequential assumption in the product, so
 * this screen is explicit that they are the user's estimate and not measured
 * demographics. The colour on each row is the colour that group's
 * neighbourhood will have on the island, which makes the legend learnable here
 * rather than later.
 */
export function AudienceStep({ draft, patch }: StepProps) {
  const [newLabel, setNewLabel] = useState('')
  const total = draft.groups.reduce((sum, group) => sum + group.share, 0)

  const update = (id: string, changes: Partial<AudienceGroup>) =>
    patch({
      groups: draft.groups.map((group) => (group.id === id ? { ...group, ...changes } : group)),
    })

  const remove = (id: string) =>
    patch({ groups: draft.groups.filter((group) => group.id !== id) })

  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (draft.groups.some((group) => group.id === id)) return
    patch({
      groups: [
        ...draft.groups,
        {
          id,
          label,
          share: 0.1,
          color: PALETTE[draft.groups.length % PALETTE.length] as string,
          blurb: 'Added during onboarding.',
          interests: [label.toLowerCase()],
        },
      ],
    })
    setNewLabel('')
  }

  return (
    <div>
      <div className="space-y-2.5">
        {draft.groups.map((group) => (
          <div
            key={group.id}
            className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5"
          >
            <span
              aria-hidden
              className="h-9 w-[3px] shrink-0 rounded-full"
              style={{ background: group.color }}
            />

            <div className="min-w-0 flex-1">
              <input
                value={group.label}
                onChange={(event) => update(group.id, { label: event.target.value })}
                className="w-full bg-transparent text-[13.5px] font-medium text-paper focus:outline-none"
                aria-label={`Name of the ${group.label} group`}
              />
              <p className="truncate text-[11.5px] text-faint">{group.blurb}</p>
              <div className="mt-1.5">
                <Meter value={group.share} color={group.color} />
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.01}
                value={group.share}
                onChange={(event) => update(group.id, { share: Number(event.target.value) })}
                className="w-20"
                aria-label={`Share of audience in ${group.label}`}
              />
              <span className="tnum w-11 text-right text-[12.5px] text-muted">
                {(group.share * 100).toFixed(0)}%
              </span>
            </div>

            <button
              onClick={() => remove(group.id)}
              className="shrink-0 rounded px-1.5 text-muted transition-colors hover:text-bloom"
              aria-label={`Remove ${group.label}`}
              title={`Remove ${group.label}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          placeholder="Add a group, e.g. Dog walkers"
        />
        <Button variant="secondary" onClick={add} disabled={!newLabel.trim()}>
          Add
        </Button>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
        <p className="tnum text-[13px] text-muted">
          Shares total {(total * 100).toFixed(0)}%
        </p>
        {Math.abs(total - 1) > 0.005 && (
          <Button variant="secondary" onClick={() => patch({ groups: normaliseShares(draft.groups) })}>
            Scale to 100%
          </Button>
        )}
      </div>

      <p className="mt-4 rounded-lg border border-sun/25 bg-sun/[0.07] px-3.5 py-3 text-xs leading-relaxed text-muted">
        These groups and shares are your estimate of who you are reaching. They are not measured
        follower demographics, and every result in the app inherits that assumption — so it is worth
        getting them roughly right.
      </p>
    </div>
  )
}
