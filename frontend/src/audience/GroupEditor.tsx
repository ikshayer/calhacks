import { useState } from 'react'
import type { AudienceGroup, CompanyProfile } from '@/data/types'
import { Button, Input, Meter } from '@/components/ui'
import { PALETTE, normaliseShares } from '@/onboarding/suggestAudience'
import { useAppStore } from '@/store/useAppStore'

/**
 * Edit the audience groups on the live profile.
 *
 * The shares are the single most consequential assumption in the product, so
 * this editor is explicit that they are the user's estimate and not measured
 * demographics. The colour on each row is the colour that group's neighbourhood
 * has on the island, so the legend is the thing being edited.
 *
 * Every committed change goes through `setProfile`, which discards the audience
 * and makes the workspace re-partition the 50 residents from the new groups.
 * `audienceVersion` is bumped alongside it because the version, not the groups,
 * is what stored runs are compared against: without the bump an old run would
 * still read as comparable to an audience it was never played on.
 *
 * Because each commit rebuilds the town, the two continuous controls (the name
 * field and the share slider) hold their value locally while being edited and
 * commit once: the name on blur or Enter, the slider on release. Committing per
 * keystroke or per drag step would rebuild the island dozens of times for what
 * the user experiences as one edit.
 */
export function GroupEditor() {
  const profile = useAppStore((state) => state.profile)
  const setProfile = useAppStore((state) => state.setProfile)
  const [newLabel, setNewLabel] = useState('')

  if (!profile) return null

  const commit = (changes: Partial<Pick<CompanyProfile, 'groups' | 'useAudienceGroups'>>) =>
    setProfile({ ...profile, ...changes, audienceVersion: profile.audienceVersion + 1 })

  const total = profile.groups.reduce((sum, group) => sum + group.share, 0)

  const update = (id: string, changes: Partial<AudienceGroup>) =>
    commit({
      groups: profile.groups.map((group) => (group.id === id ? { ...group, ...changes } : group)),
    })

  const remove = (id: string) => commit({ groups: profile.groups.filter((group) => group.id !== id) })

  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (profile.groups.some((group) => group.id === id)) return
    commit({
      groups: [
        ...profile.groups,
        {
          id,
          label,
          share: 0.1,
          color: PALETTE[profile.groups.length % PALETTE.length] as string,
          blurb: 'Added in the workspace.',
          interests: [label.toLowerCase()],
        },
      ],
    })
    setNewLabel('')
  }

  // Off means the groups below are kept but ignored: every resident is simulated as "Everyone".
  const enabled = profile.useAudienceGroups !== false

  return (
    <div>
      <label className="mb-4 flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-ui-border bg-ui-surface px-3.5 py-3">
        <span>
          <span className="block text-[13.5px] font-medium text-ui-text">Use audience groups</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-ui-faint">
            {enabled
              ? 'Residents are sorted into these groups, and each group’s interests shape the prediction.'
              : 'Off: the groups have no effect. Each resident is judged only on their own profile.'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => commit({ useAudienceGroups: !enabled })}
          className={
            'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ' +
            (enabled ? 'bg-ui-accent' : 'bg-ui-edge')
          }
        >
          <span
            aria-hidden
            className={
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-ui-surface transition-transform ' +
              (enabled ? 'translate-x-5' : 'translate-x-0')
            }
          />
        </button>
      </label>

      <fieldset disabled={!enabled} className={enabled ? '' : 'opacity-40'}>
        <div className="space-y-2.5">
          {profile.groups.map((group) => (
            <GroupRow key={group.id} group={group} onChange={update} onRemove={remove} />
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

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-ui-border pt-4">
          <p className="tnum text-[13px] text-ui-muted">Shares total {(total * 100).toFixed(0)}%</p>
          {Math.abs(total - 1) > 0.005 && (
            <Button variant="secondary" onClick={() => commit({ groups: normaliseShares(profile.groups) })}>
              Scale to 100%
            </Button>
          )}
        </div>

        <p className="mt-4 rounded-lg border border-ui-accent/25 bg-ui-accent/[0.07] px-3.5 py-3 text-xs leading-relaxed text-ui-muted">
          These groups and shares are your estimate of who you are reaching. They are not measured
          follower demographics, and every result in the app inherits that assumption — so it is worth
          getting them roughly right.
        </p>
      </fieldset>
    </div>
  )
}

/**
 * One editable group. `null` drafts mean "not being edited", so the displayed
 * value falls straight through to the profile and can never go stale when
 * something else (such as Scale to 100%) rewrites the shares.
 */
function GroupRow({
  group,
  onChange,
  onRemove,
}: {
  group: AudienceGroup
  onChange: (id: string, changes: Partial<AudienceGroup>) => void
  onRemove: (id: string) => void
}) {
  const [labelDraft, setLabelDraft] = useState<string | null>(null)
  const [shareDraft, setShareDraft] = useState<number | null>(null)

  const share = shareDraft ?? group.share

  const commitLabel = () => {
    const label = (labelDraft ?? group.label).trim()
    setLabelDraft(null)
    // A blank name would leave an unlabelled row nobody can find on the legend, so it reverts.
    if (label && label !== group.label) onChange(group.id, { label })
  }

  const commitShare = (value: number) => {
    setShareDraft(null)
    if (value !== group.share) onChange(group.id, { share: value })
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-ui-border bg-ui-surface px-3 py-2.5">
      <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: group.color }} />

      <div className="min-w-0 flex-1">
        <input
          value={labelDraft ?? group.label}
          onChange={(event) => setLabelDraft(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="w-full bg-transparent text-[13.5px] font-medium text-ui-text focus:outline-none"
          aria-label={`Name of the ${group.label} group`}
        />
        <p className="truncate text-[11.5px] text-ui-faint">{group.blurb}</p>
        <div className="mt-1.5">
          <Meter value={share} color={group.color} />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.01}
          value={share}
          onChange={(event) => setShareDraft(Number(event.target.value))}
          onPointerUp={(event) => commitShare(Number(event.currentTarget.value))}
          onKeyUp={(event) => commitShare(Number(event.currentTarget.value))}
          onBlur={(event) => commitShare(Number(event.currentTarget.value))}
          className="w-20"
          aria-label={`Share of audience in ${group.label}`}
        />
        <span className="tnum w-11 text-right text-[12.5px] text-ui-muted">{(share * 100).toFixed(0)}%</span>
      </div>

      <button
        onClick={() => onRemove(group.id)}
        className="shrink-0 rounded px-1.5 text-ui-muted transition-colors hover:text-ui-danger"
        aria-label={`Remove ${group.label}`}
        title={`Remove ${group.label}`}
      >
        ×
      </button>
    </div>
  )
}
