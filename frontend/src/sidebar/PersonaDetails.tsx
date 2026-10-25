import type { ReactNode } from 'react'
import type { Audience, AudienceMember } from '@/data/types'
import type { FamilyRelation } from '@/data/millbrookTypes'

const FAMILY_ROLE: Record<FamilyRelation, string> = {
  spouse: 'Spouse of', parent: 'Parent of', child: 'Child of', sibling: 'Sibling of',
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-[12px] leading-relaxed text-muted">{children}</dd>
    </div>
  )
}

function Expandable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="border-b border-line px-4 py-3">
      <summary className="cursor-pointer text-[12.5px] font-medium text-paper focus-visible:outline-sun">{title}</summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  )
}

/** All values are the supplied snapshot; selecting a relative never changes it. */
export function PersonaDetails({ member, audience, onSelect }: {
  member: AudienceMember
  audience: Audience
  onSelect(id: number): void
}) {
  if (!member.millbrook) return null
  const { persona, household } = member.millbrook
  const bySourceId = new Map(audience.members.map((candidate) => [candidate.millbrook?.persona.id, candidate]))
  const personLink = (id: string) => {
    const target = bySourceId.get(id)
    return target ? (
      <button onClick={() => onSelect(target.id)} className="rounded text-left text-paper underline decoration-line underline-offset-2 hover:text-sun focus-visible:outline-sun">
        {target.name}
      </button>
    ) : <span>{id}</span>
  }

  return (
    <div>
      <Expandable title="Background">
        <dl className="grid grid-cols-2 gap-3">
          <Detail label="Resident ID">{persona.id}</Detail>
          <Detail label="Gender">{persona.gender}</Detail>
          <Detail label="Education">{persona.education}</Detail>
          <Detail label="Hometown">{persona.hometown}</Detail>
        </dl>
      </Expandable>

      <Expandable title="Personality and expression">
        <dl className="grid grid-cols-2 gap-3">
          {Object.entries(persona.personality).map(([trait, score]) => (
            <Detail key={trait} label={trait.charAt(0).toUpperCase() + trait.slice(1)}>{Math.round(score * 100)} / 100</Detail>
          ))}
        </dl>
        <dl className="space-y-3">
          <Detail label="Quirks">{persona.quirks.join('; ') || 'None recorded.'}</Detail>
          <Detail label="Speech style">{persona.speechStyle || 'None recorded.'}</Detail>
        </dl>
      </Expandable>

      <Expandable title="Household and relationships">
        <dl className="space-y-3">
          <Detail label="Household">{household.surname} · {household.id}</Detail>
          <Detail label="Address">{household.address}</Detail>
        </dl>
        <div className="text-[12px] leading-relaxed text-muted">
          <p className="mb-1 text-[11px] text-faint">Household residents</p>
          <ul className="space-y-1">
            {household.memberIds.map((id) => <li key={id}>{personLink(id)}</li>)}
          </ul>
        </div>
        <div className="text-[12px] leading-relaxed text-muted">
          <p className="mb-1 text-[11px] text-faint">Family · this resident’s role</p>
          {Object.keys(persona.family).length ? (
            <ul className="space-y-1">
              {Object.entries(persona.family).map(([id, relation]) => (
                <li key={id}>{FAMILY_ROLE[relation]} {personLink(id)}</li>
              ))}
            </ul>
          ) : <p>No family links recorded.</p>}
        </div>
        <div className="text-[12px] leading-relaxed text-muted">
          <p className="mb-1 text-[11px] text-faint">Friends · affinity from −1 to +1</p>
          {Object.keys(persona.friends).length ? (
            <ul className="space-y-1">
              {Object.entries(persona.friends).map(([id, affinity]) => (
                <li key={id}>{personLink(id)} <span className="text-faint">({affinity > 0 ? '+' : ''}{affinity.toFixed(2)})</span></li>
              ))}
            </ul>
          ) : <p>No friendships recorded.</p>}
        </div>
      </Expandable>

      <Expandable title="Current state and memories">
        <p className="text-[11px] leading-relaxed text-faint">Read-only persona snapshot. Runs do not update these fields.</p>
        <dl className="grid grid-cols-2 gap-3">
          <Detail label="Mood">{persona.mood}</Detail>
          <Detail label="Location">{persona.location}</Detail>
          <Detail label="Money">{persona.money.toLocaleString('en-US')} (source units)</Detail>
        </dl>
        <dl className="space-y-3">
          <Detail label="Goals">{persona.goals.join('; ') || 'No goals recorded.'}</Detail>
          <Detail label="Beliefs">{persona.beliefs.join('; ') || 'No beliefs recorded.'}</Detail>
        </dl>
        <div className="text-[12px] leading-relaxed text-muted">
          <p className="mb-1 text-[11px] text-faint">Memories</p>
          {persona.memories.length ? (
            <ul className="space-y-3">
              {persona.memories.map((memory) => (
                <li key={memory.id}>
                  <p>{memory.text}</p>
                  <p className="text-[11px] text-faint">{memory.id} · Tick {memory.tick} · Importance {memory.importance}</p>
                  <p className="text-[11px] text-faint">{memory.tags.join(', ') || 'No tags.'}</p>
                </li>
              ))}
            </ul>
          ) : <p>No memories recorded.</p>}
        </div>
      </Expandable>
    </div>
  )
}
