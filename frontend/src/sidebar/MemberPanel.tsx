import { createAvatar } from '@dicebear/core'
import { openPeeps } from '@dicebear/collection'
import { useEffect, useState } from 'react'
import type { IdeaResident, IdeaTestResult, ReactionKind } from '@/data/types'
import { VERDICT_STYLE, verdictOf } from '@/data/ideaVerdict'
import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { memberTimeline, type MemberTimeline } from '@/store/selectors'
import { Pill, Section } from '@/components/ui'
import { MemberExplanation } from './MemberExplanation'
import { PersonaDetails } from './PersonaDetails'

const MAX_NEIGHBOURS = 8

/**
 * Portraits, generated once per member and kept.
 *
 * DiceBear open-peeps is CC0 and generated client-side, so a portrait costs
 * nothing and never leaves the browser — but it is deterministic in its seed,
 * and clicking along a chain of neighbours remounts this panel each time. A
 * module-level cache means each member's face is drawn once per session rather
 * than once per visit, and it is bounded by the audience size.
 */
const portraits = new Map<string, string>()

function portraitFor(memberId: number, name: string): string {
  const seed = `${memberId}-${name}`
  const cached = portraits.get(seed)
  if (cached) return cached
  const drawn = createAvatar(openPeeps, { seed, size: 72 }).toDataUri()
  portraits.set(seed, drawn)
  return drawn
}

const KIND_VERB: Record<ReactionKind, string> = {
  watch: 'watched it through',
  like: 'liked it',
  comment: 'commented',
  share: 'shared it on',
}

/**
 * One audience member, in the sidebar.
 *
 * This is where the simulation has to justify itself. A number on a chart is
 * easy to wave away; a named member with their interests, their predicted
 * probabilities and the reason given for them is something you can disagree
 * with, which is the honest way to present a model's output. It replaces the
 * floating card so the island stays unobstructed while a resident is followed.
 *
 * The neighbour chips make the share graph legible by walking it: the people a
 * member would reach are one click away, and each click re-targets the camera.
 */
export function MemberPanel({ memberId }: { memberId: number }) {
  const profile = useAppStore((state) => state.profile)
  const audience = useAppStore((state) => state.audience)
  const run = useAppStore(selectActiveRun)
  const selectMember = useAppStore((state) => state.selectMember)

  const member = audience?.members.find((candidate) => candidate.id === memberId)
  const ideaResult = useAppStore((state) => (state.idea?.status === 'ready' ? state.idea.result : undefined))
  const ideaResident = ideaResult?.residents.find((candidate) => candidate.memberId === memberId)

  // Cheap enough to derive every render: a cascade caps at six rounds, so this
  // is a handful of array scans. Memoising it by hand would only be guesswork
  // about when the round log changes identity.
  const compatibleRun = Boolean(run?.options.audienceKey) && run?.options.audienceKey === audience?.key
  const rounds = compatibleRun ? run?.rounds : undefined
  const timeline = rounds?.length ? memberTimeline(rounds, memberId) : null

  if (!audience || !member) return null

  const portrait = portraitFor(member.id, member.name)

  const group = profile?.groups.find((candidate) => candidate.id === member.groupId)
  const decision = compatibleRun ? run?.decisions?.find((candidate) => candidate.memberId === memberId) : undefined
  const nameOf = (id: number): string =>
    audience.members.find((candidate) => candidate.id === id)?.name ?? `Member ${id}`
  // Only a cohort of the audience has a body on the island, and selecting
  // someone without one leaves the camera nothing to follow — it returns to
  // the island view, which is baffling if the chip gave no warning. So the
  // neighbours you can actually walk to are offered first, and the rest are
  // marked rather than hidden: they are still part of this member's reach.
  const neighbours = (audience.adjacency[memberId] ?? [])
    .map((id) => {
      const neighbour = audience.members.find((candidate) => candidate.id === id)
      return {
        id,
        name: neighbour?.name ?? `Member ${id}`,
        onIsland: neighbour?.onIsland ?? false,
      }
    })
    .sort((a, b) => Number(b.onIsland) - Number(a.onIsland))
    .slice(0, MAX_NEIGHBOURS)
  const offIsland = neighbours.filter((neighbour) => !neighbour.onIsland).length

  return (
    <div>
      {/* The way back out is the pinned row the sidebar puts where the tabs
          were, so this panel starts straight in on the person. */}
      <div className="border-b border-ui-border px-4 pt-4 pb-4">
        <header className="flex items-start gap-3">
          <img
            src={portrait}
            alt=""
            width={44}
            height={44}
            className="shrink-0 rounded-full bg-ui-raised"
          />
          <div className="min-w-0 flex-1">
            <h3 className="display truncate text-[16px] leading-tight text-ui-text">{member.name}</h3>
            {member.millbrook && (
              <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
                Age {member.millbrook.persona.age} · {member.millbrook.persona.occupation}
              </p>
            )}
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ui-muted">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: group?.color ?? '#93a09a' }}
              />
              {group?.label ?? member.groupId}
            </p>
          </div>
        </header>
      </div>

      {/* In the idea view the verdict and its reason are the point, so they come first. */}
      {ideaResident && ideaResult && (
        <IdeaVerdictSection result={ideaResult} resident={ideaResident} />
      )}

      <div className="border-b border-ui-border px-4 pb-4">
        <p className="mt-3 text-[12.5px] leading-relaxed text-ui-muted">{member.persona}</p>
        {member.millbrook && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-ui-faint">Values</p>
            <div className="flex flex-wrap gap-1.5">
              {member.millbrook.persona.values.length
                ? member.millbrook.persona.values.map((value) => <Pill key={value}>{value}</Pill>)
                : <p className="text-[12px] text-ui-muted">No values recorded.</p>}
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-ui-faint">Assumed audience interests</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {member.interests.map((interest) => (
            <Pill key={interest}>{interest}</Pill>
          ))}
        </div>
      </div>

      <PersonaDetails member={member} audience={audience} onSelect={selectMember} />
      {!run ? (
        ideaResident ? null : (
          <p className="mx-4 mt-4 rounded-lg border border-dashed border-ui-border px-3 py-2.5 text-[12px] leading-relaxed text-ui-faint">
            Run a simulation to see how this member would respond.
          </p>
        )
      ) : !compatibleRun ? (ideaResident ? null : (
        <p className="mx-4 mt-4 rounded-lg border border-dashed border-ui-border px-3 py-2.5 text-[12px] leading-relaxed text-ui-faint">
          {run.options.audienceKey ? 'This run used a different audience configuration.' : 'This saved run belongs to the previous audience.'}
          {' '}Run this version again to see this resident’s response.
        </p>
      )) : (
        <>
          <Section title="What they did in this run">
            {timeline ? (
              <TimelineSummary timeline={timeline} nameOf={nameOf} />
            ) : (
              <p className="text-[12px] leading-relaxed text-ui-faint">
                The cascade was not stored for this run, so there is no round-by-round record for
                this member.
              </p>
            )}
          </Section>

          {decision && (
            <Section title="Chance of each action">
              {decision.missing ? (
                <div className="rounded-lg border border-ui-border bg-ui-panel px-3 py-2.5">
                  <p className="text-[12.5px] font-medium text-ui-text">No prediction</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ui-muted">
                    Scoring failed for this member. They are counted as exposed but excluded from
                    the action totals rather than counted as a zero.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-2 text-[11.5px] text-ui-faint">Chance of each action, if they see it</p>
                  <div className="space-y-1.5">
                    <Probability label="Watches it through" value={decision.pWatch} color="#6aa9c9" />
                    <Probability label="Likes it" value={decision.pLike} color="#7fb069" />
                    <Probability label="Comments" value={decision.pComment} color="#f2b53c" />
                    <Probability label="Shares it on" value={decision.pShare} color="#e2735f" />
                  </div>
                </>
              )}
            </Section>
          )}

          {decision && !decision.missing && (
            <Section title="Why">
              <MemberExplanation decision={decision} />
              <p className="mt-2 text-[11px] leading-relaxed text-ui-faint">
                A generated rationale for a simulated decision, not something this person did.
              </p>
            </Section>
          )}
        </>
      )}

      {neighbours.length > 0 && (
        <Section title="Who they'd reach" className="border-b-0">
          <div className="flex flex-wrap gap-1.5">
            {neighbours.map((neighbour) => (
              <button
                key={neighbour.id}
                onClick={() => selectMember(neighbour.id)}
                title={
                  neighbour.onIsland
                    ? undefined
                    : 'Simulated, but without a body on the island — the camera stays where it is.'
                }
                className={
                  'rounded-full px-2 py-0.5 text-[11.5px] transition-colors hover:text-ui-text ' +
                  (neighbour.onIsland
                    ? 'bg-ui-raised text-ui-muted'
                    : 'border border-dashed border-ui-border text-ui-faint')
                }
              >
                {neighbour.name}
              </button>
            ))}
          </div>
          {offIsland > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-ui-faint">
              Outlined names are simulated but have no body on the island, so selecting them leaves
              the camera where it is.
            </p>
          )}
        </Section>
      )}
    </div>
  )
}

function IdeaVerdictSection({
  result,
  resident,
}: {
  result: IdeaTestResult
  resident: IdeaResident
}) {
  const verdict = verdictOf(resident)
  const input = useAppStore((state) => state.idea?.input)
  return (
    <Section title="Idea verdict">
      {verdict === undefined ? (
        <div className="rounded-lg border border-ui-border bg-ui-panel px-3 py-2.5">
          <p className="text-[12.5px] font-medium text-ui-text">No prediction</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ui-muted">
            This resident’s profile lacked what the question needed, so they are left out of the
            counts rather than counted as a no.
          </p>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: VERDICT_STYLE[verdict].color }}>
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: VERDICT_STYLE[verdict].color }}
            />
            {VERDICT_STYLE[verdict].label}
          </p>
          <div className="mt-3 space-y-1.5">
            <Probability label="Would visit" value={resident.pVisit} color="#7fb069" />
            <Probability label="Would come back" value={resident.pReturn} color="#6aa9c9" />
            <Probability label="Would tell a friend" value={resident.pShare} color="#e2735f" />
          </div>
          {input && input.options.length > 0 && resident.optionInterest.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11.5px] text-ui-faint">Interest in each option</p>
              <div className="space-y-1.5">
                {input.options.map((option, index) => (
                  <Probability
                    key={option.name}
                    label={option.name}
                    value={resident.optionInterest[index] ?? 0}
                    color="#f2b53c"
                  />
                ))}
              </div>
            </div>
          )}
          <div className="mt-3">
            <IdeaReason ideaId={result.id} resident={resident} />
            <p className="mt-2 text-[11px] leading-relaxed text-ui-faint">
              A generated rationale for a simulated decision, not something this person did.
            </p>
          </div>
        </>
      )}
    </Section>
  )
}

function IdeaReason({ ideaId, resident }: { ideaId: string; resident: IdeaResident }) {
  const source = useAppStore((state) => state.source)
  // Keyed by member, so a panel reopened on someone else never shows the previous answer.
  const [fetched, setFetched] = useState<{ memberId: number; text: string; error?: string } | null>(null)
  const memberId = resident.memberId

  useEffect(() => {
    if (resident.reason) return
    let live = true
    source
      .explainIdeaResident(ideaId, memberId)
      .then((text) => {
        if (live) setFetched({ memberId, text })
      })
      .catch((cause: unknown) => {
        if (live) {
          setFetched({
            memberId,
            text: '',
            error: cause instanceof Error ? cause.message : 'The reason could not be written.',
          })
        }
      })
    return () => {
      live = false
    }
  }, [source, ideaId, memberId, resident.reason])

  const current = fetched?.memberId === memberId ? fetched : null
  const text = resident.reason || current?.text || ''
  if (current?.error) return <p className="text-[12px] leading-relaxed text-ui-danger">{current.error}</p>
  if (!text) return <p className="text-[12.5px] leading-relaxed text-ui-faint">Writing a reason…</p>
  return <p className="text-[12.5px] leading-relaxed text-ui-muted">{text}</p>
}

function TimelineSummary({
  timeline,
  nameOf,
}: {
  timeline: MemberTimeline
  nameOf: (id: number) => string
}) {
  if (timeline.exposedAtRound === null) {
    return <p className="text-[12px] leading-relaxed text-ui-muted">The cascade never reached them.</p>
  }

  const seen =
    timeline.exposedBy.length > 0
      ? `Saw it in round ${timeline.exposedAtRound}, shared by ${listNames(timeline.exposedBy, nameOf)}.`
      : `Saw it in round ${timeline.exposedAtRound}, in the first wave.`

  const did = timeline.ignored
    ? 'Scrolled past without reacting.'
    : timeline.kinds.length > 0
      ? `${capitalise(listWords(timeline.kinds.map((kind) => KIND_VERB[kind])))}.`
      : null

  const reach =
    timeline.sharedTo.length > 0
      ? `Shared on to ${timeline.sharedTo.length} ${timeline.sharedTo.length === 1 ? 'neighbour' : 'neighbours'}.`
      : null

  return (
    <ul className="space-y-1 text-[12.5px] leading-relaxed text-ui-muted">
      <li>{seen}</li>
      {did && <li>{did}</li>}
      {reach && <li>{reach}</li>}
    </ul>
  )
}

function listNames(ids: number[], nameOf: (id: number) => string): string {
  const shown = ids.slice(0, 3).map(nameOf)
  const rest = ids.length - shown.length
  return listWords(rest > 0 ? [...shown, `${rest} more`] : shown)
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function Probability({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex-1 truncate text-[12px] text-ui-text">{label}</span>
      <span className="h-1.5 w-[74px] overflow-hidden rounded-full bg-ui-well">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </span>
      <span className="tnum w-8 text-right text-[12px] text-ui-muted">{Math.round(value * 100)}%</span>
    </div>
  )
}
