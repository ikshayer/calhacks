import { createAvatar } from '@dicebear/core'
import { openPeeps } from '@dicebear/collection'
import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { memberTimeline } from '@/store/selectors'
import { Section, Pill } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { VERDICT_STYLE, verdictOf } from '@/data/ideaVerdict'
import { probability } from '@/data/overviewStats'
import { ChartBar } from './OverviewCharts'

const portraits = new Map<string, string>()
function portraitFor(id: number, name: string) {
  const key = `${id}:${name}`
  let portrait = portraits.get(key)
  if (!portrait) { portrait = createAvatar(openPeeps, { seed: key, size: 72 }).toDataUri(); portraits.set(key, portrait) }
  return portrait
}

/** Selection stays a compact visual card. Opening it never requests a generated rationale. */
export function MemberPanel({ memberId, onAsk, onBack }: { memberId: number; onAsk(): void; onBack(): void }) {
  const audience = useAppStore((state) => state.audience)
  const run = useAppStore(selectActiveRun)
  const idea = useAppStore((state) => state.idea)
  const round = useAppStore((state) => state.playback.round)
  const selectMember = useAppStore((state) => state.selectMember)
  const member = audience?.members.find((person) => person.id === memberId)
  if (!member || !audience) return null
  const persona = member.millbrook?.persona
  const compatible = Boolean(run?.options.audienceKey) && run?.options.audienceKey === audience.key
  const decision = !idea && compatible ? run?.decisions?.find((entry) => entry.memberId === memberId) : undefined
  const resident = idea?.status === 'ready' ? idea.result?.residents.find((entry) => entry.memberId === memberId) : undefined
  const verdict = resident && probability(resident.pVisit) !== undefined ? verdictOf(resident) : undefined
  const timeline = !idea && compatible && run?.rounds.length ? memberTimeline(run.rounds.slice(0, round), memberId) : undefined
  const values = (persona?.values ?? member.hotButtons).slice(0, 3)
  const neighbours = (audience.adjacency[memberId] ?? []).map((id) => audience.members.find((person) => person.id === id)).filter((person) => person !== undefined).slice(0, 4)
  const predictions = idea ? [
    { label: 'Visit', value: resident?.pVisit }, { label: 'Return after visit', value: resident?.pReturn }, { label: 'Share after visit', value: resident?.pShare },
  ] : [
    { label: 'Watch', value: decision?.pWatch }, { label: 'Like', value: decision?.pLike }, { label: 'Comment', value: decision?.pComment }, { label: 'Share', value: decision?.pShare },
  ]
  const missing = idea ? !resident || resident.missing : !decision || decision.missing

  return <>
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <Button variant="ghost" size="sm" onClick={onBack}>← Everyone</Button>
      <Button variant="outline" size="sm" onClick={onAsk}>Ask assistant</Button>
    </div>
    <Section title={member.name} className="py-3" aside={<img src={portraitFor(memberId, member.name)} alt="" width={40} height={40} className="rounded-full bg-ui-raised" />}>
      {persona && <p className="truncate text-[12px] text-ui-muted">{persona.age} years · {persona.occupation}</p>}
      <p className="mt-2 break-words text-[12px] leading-relaxed text-ui-muted">{member.persona}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{values.map((value, index) => <Pill key={`${index}:${value}`}>{value}</Pill>)}</div>
    </Section>
    {persona && <Section title="Personality" className="py-3">
      <div className="space-y-2.5">{Object.entries(persona.personality).map(([trait, raw]) => {
        const value = probability(raw)
        return <ChartBar key={trait} label={trait.charAt(0).toUpperCase() + trait.slice(1)} value={value} max={1}
          detail={value === undefined ? 'Unavailable' : `${Math.round(value * 100)} / 100`} color="#6aa9c9" />
      })}</div>
    </Section>}
    <Section title={idea ? 'Idea response' : 'Predicted actions'} className="py-3" aside={verdict ? <span className="text-[11px] text-ui-muted">{VERDICT_STYLE[verdict].label}</span> : undefined}>
      {missing ? <p className="text-[12px] text-ui-faint">{idea?.status === 'running' ? 'Idea test in progress…' : 'Prediction unavailable'}</p> : <div className="space-y-2.5">
        {predictions.map(({ label, value: raw }) => {
          const value = probability(raw)
          return <ChartBar key={label} label={label} value={value} max={1} detail={value === undefined ? 'Unavailable' : `${Math.round(value * 100)}%`} />
        })}
        <p className="text-[10.5px] text-ui-faint">{idea ? 'Uncalibrated · return/share assume a visit' : 'Per exposure · synthetic probabilities'}</p>
      </div>}
      {timeline && <div className="mt-3 border-t border-ui-border pt-2">
        <p className="mb-1.5 text-[10.5px] text-ui-faint">In the replay</p>
        <div className="flex flex-wrap gap-1">{timeline.kinds.length ? timeline.kinds.map((kind) => <Pill key={kind}>{kind}</Pill>) : <span className="text-[11px] text-ui-muted">{timeline.exposedAtRound === null ? 'Not reached yet' : 'No action'}</span>}</div>
      </div>}
    </Section>
    {neighbours.length > 0 && <Section title="Connections" className="py-3">
      <div className="grid grid-cols-2 gap-1.5">{neighbours.map((person) => <Button variant="ghost" size="sm" key={person.id} onClick={() => selectMember(person.id)} className="min-w-0 justify-start overflow-hidden text-ellipsis text-[11px]">{person.name}</Button>)}</div>
    </Section>}
  </>
}
