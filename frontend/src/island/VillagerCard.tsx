import { useEffect, useMemo, useState } from 'react'
import { createAvatar } from '@dicebear/core'
import { openPeeps } from '@dicebear/collection'
import type { AudienceGroup, AudienceMember, Decision } from '@/data/types'
import { Pill } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'

/**
 * One audience member, opened by clicking them on the island.
 *
 * This is where the simulation has to justify itself. A number on a chart is
 * easy to wave away; a named member with their interests, their predicted
 * probabilities and the reason given for them is something you can disagree
 * with — which is the honest way to present a model's output.
 */
export function VillagerCard({
  member,
  decision,
  group,
  onClose,
}: {
  member: AudienceMember
  decision?: Decision
  group?: AudienceGroup
  onClose(): void
}) {
  // DiceBear open-peeps is CC0 and generated client-side, so a portrait costs
  // nothing and never leaves the browser.
  const portrait = useMemo(
    () => createAvatar(openPeeps, { seed: `${member.id}-${member.name}`, size: 72 }).toDataUri(),
    [member.id, member.name],
  )

  return (
    <aside className="over-canvas absolute bottom-5 right-5 w-[310px] rounded-xl p-4 lg:bottom-auto lg:top-5">
      <header className="flex items-start gap-3">
        <img
          src={portrait}
          alt=""
          width={44}
          height={44}
          className="shrink-0 rounded-full bg-raised"
        />
        <div className="min-w-0 flex-1">
          <h3 className="display truncate text-[16px] leading-tight text-paper">{member.name}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: group?.color ?? '#93a09a' }}
            />
            {group?.label ?? member.groupId}
          </p>
        </div>
        <button
          onClick={onClose}
          className="-mt-1 -mr-1 shrink-0 rounded px-1.5 py-0.5 text-muted transition-colors hover:text-paper"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{member.persona}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {member.interests.map((interest) => (
          <Pill key={interest}>{interest}</Pill>
        ))}
      </div>

      {decision ? (
        decision.missing ? (
          <div className="mt-4 rounded-lg border border-line bg-panel px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-paper">No prediction</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              Scoring failed for this member. They are counted as exposed but excluded from the
              action totals rather than counted as a zero.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="mb-2 text-[11.5px] text-faint">
              Chance of each action, if they see it
            </p>
            <div className="space-y-1.5">
              <Probability label="Watches it through" value={decision.pWatch} color="#6aa9c9" />
              <Probability label="Likes it" value={decision.pLike} color="#7fb069" />
              <Probability label="Comments" value={decision.pComment} color="#f2b53c" />
              <Probability label="Shares it on" value={decision.pShare} color="#e2735f" />
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <Explanation decision={decision} />
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                A generated rationale for a simulated decision, not something this person did.
              </p>
            </div>
          </div>
        )
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] leading-relaxed text-faint">
          Run a simulation to see how this member would respond.
        </p>
      )}
    </aside>
  )
}

/**
 * The mock writes explanations at scoring time; the live backend writes one on
 * demand (Claude) the first time a member is opened, so it may arrive a moment
 * after the card does.
 */
function Explanation({ decision }: { decision: Decision }) {
  const source = useAppStore((state) => state.source)
  const runId = useAppStore((state) => state.activeRunId)
  // Keyed by member, so a card reopened on someone else never shows the previous answer.
  const [fetched, setFetched] = useState<{ memberId: number; text: string; error?: string } | null>(null)

  useEffect(() => {
    if (decision.explanation || !runId) return
    let live = true
    const memberId = decision.memberId
    source
      .explainMember(runId, memberId)
      .then((text) => {
        if (live) setFetched({ memberId, text })
      })
      .catch((cause: unknown) => {
        if (live) setFetched({ memberId, text: '', error: cause instanceof Error ? cause.message : 'The explanation could not be written.' })
      })
    return () => {
      live = false
    }
  }, [source, runId, decision.memberId, decision.explanation])

  const current = fetched?.memberId === decision.memberId ? fetched : null
  const text = decision.explanation || current?.text || ''
  const error = current?.error
  if (error) return <p className="text-[12px] leading-relaxed text-bloom">{error}</p>
  if (!text) return <p className="text-[12.5px] leading-relaxed text-faint">Writing an explanation…</p>
  return <p className="text-[12.5px] leading-relaxed text-muted">{text}</p>
}

function Probability({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex-1 truncate text-[12px] text-paper">{label}</span>
      <span className="h-1.5 w-[74px] overflow-hidden rounded-full bg-ink">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </span>
      <span className="tnum w-8 text-right text-[12px] text-muted">
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}
