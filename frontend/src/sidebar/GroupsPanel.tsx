import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { Button, Meter, Section } from '@/components/ui'
import { GroupEditor } from '@/audience/GroupEditor'

/**
 * Per-group response.
 *
 * The town has no labels over it, so this panel is the legend: pointing at a
 * row rings that group's villagers on the ground in the row's colour, and
 * clicking one opens somebody from it. That keeps the question "which of these
 * people are the students?" answerable without writing the answer across the
 * sky forever.
 *
 * The section stays mounted whenever there is a profile, even with no rows. An
 * edit rebuilds the audience, which empties `rows` until the new one arrives, so
 * returning null there would close the editor under the user's cursor after
 * every change (and make it unreachable once the last group is removed).
 */
export function GroupsPanel() {
  const profile = useAppStore((state) => state.profile)
  const audience = useAppStore((state) => state.audience)
  const run = useAppStore(selectActiveRun)
  const round = useAppStore((state) => state.playback.round)
  const selectMember = useAppStore((state) => state.selectMember)
  const highlightGroup = useAppStore((state) => state.highlightGroup)
  const reduceMotion = useReducedMotion()
  const [editing, setEditing] = useState(false)

  const rows = useMemo(() => {
    const groups = profile?.groups ?? []
    if (!audience) return []

    const sizeByGroup = new Map<string, number>()
    for (const member of audience.members) {
      sizeByGroup.set(member.groupId, (sizeByGroup.get(member.groupId) ?? 0) + 1)
    }

    const groupOf = new Map(audience.members.map((member) => [member.id, member.groupId]))
    const exposed = new Map<string, number>()
    const acted = new Map<string, number>()

    const rounds = run && run.options.audienceKey === audience.key ? run.rounds : []
    for (const event of rounds.slice(0, round)) {
      for (const id of event.exposed) {
        const groupId = groupOf.get(id)
        if (groupId) exposed.set(groupId, (exposed.get(groupId) ?? 0) + 1)
      }
      for (const act of event.acted) {
        const groupId = groupOf.get(act.memberId)
        if (groupId) acted.set(groupId, (acted.get(groupId) ?? 0) + act.kinds.length)
      }
    }

    return groups.map((group) => {
      const size = sizeByGroup.get(group.id) ?? 0
      const seen = exposed.get(group.id) ?? 0
      return {
        ...group,
        size,
        seen,
        actions: acted.get(group.id) ?? 0,
        penetration: size > 0 ? seen / size : 0,
      }
    })
  }, [profile?.groups, audience, run, round])

  if (!profile) return null

  const ranked = [...rows].sort((a, b) => b.actions - a.actions)

  return (
    <Section title="Who responded" aside={<span className="text-[11.5px] text-faint">by actions</span>}>
      {rows.length > 0 && (
        <>
          <ul className="space-y-2.5">
            {ranked.map((row) => (
              // `layout` makes rows slide past each other as the ranking changes
              // rather than teleporting; keys are the stable group ids.
              <motion.li key={row.id} layout={!reduceMotion} transition={{ duration: 0.35, ease: 'easeOut' }}>
                <button
                  onMouseEnter={() => highlightGroup(row.id)}
                  onMouseLeave={() => highlightGroup(null)}
                  onFocus={() => highlightGroup(row.id)}
                  onBlur={() => highlightGroup(null)}
                  onClick={() => {
                    // Open someone from this group, so the row leads somewhere.
                    const member = audience?.members.find(
                      (candidate) => candidate.groupId === row.id && candidate.onIsland,
                    )
                    selectMember(member?.id ?? null)
                  }}
                  className="group flex w-full items-center gap-2.5 text-left"
                >
                  <span
                    aria-hidden
                    className="h-7 w-[3px] shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] text-paper transition-colors group-hover:text-sun">
                        {row.label}
                      </span>
                      <span className="tnum shrink-0 text-[11.5px] text-muted">
                        {row.actions} from {row.seen}
                      </span>
                    </span>
                    <span className="mt-1.5 block">
                      <Meter value={row.penetration} color={row.color} />
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            The bar is how much of each group has seen it. Point at a row to find those residents in
            town. Group sizes are inferred from the audience you described, and are assumptions
            rather than measured demographics — edit them below.
          </p>
        </>
      )}
      <Button
        variant="ghost"
        className="mt-3 -ml-2.5"
        aria-expanded={editing}
        onClick={() => setEditing((open) => !open)}
      >
        {editing ? 'Hide group editor' : 'Edit groups'}
      </Button>
      {editing && (
        <div className="mt-3">
          <GroupEditor />
        </div>
      )}
    </Section>
  )
}
