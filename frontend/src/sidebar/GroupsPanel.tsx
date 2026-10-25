import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { Section } from '@/components/ui'
import { visibleGroupResults } from '@/data/overviewStats'
import { ChartBar } from './OverviewCharts'

/** Group reach stays separate from overlapping action counts. */
export function GroupsPanel() {
  const profile = useAppStore((state) => state.profile)
  const audience = useAppStore((state) => state.audience)
  const run = useAppStore(selectActiveRun)
  const round = useAppStore((state) => state.playback.round)
  const selectMember = useAppStore((state) => state.selectMember)
  const highlightGroup = useAppStore((state) => state.highlightGroup)
  if (!run) return null
  const compatible = Boolean(run.options.audienceKey) && run.options.audienceKey === audience?.key
  const people = compatible ? audience?.members ?? [] : []
  const rows = visibleGroupResults(run, round, new Map(people.map((person) => [person.id, person.groupId])))
    .sort((a, b) => b.actions - a.actions)
  if (rows.length < 2) return null
  const max = Math.max(1, ...rows.map((row) => row.exposed))
  return <Section title="Group response" className="py-3">
    <div className="space-y-2.5">{rows.slice(0, 6).map((row) => {
      const group = profile?.groups.find((entry) => entry.id === row.groupId)
      const size = compatible ? people.filter((person) => person.groupId === row.groupId).length : undefined
      return <button key={row.groupId} type="button" disabled={!compatible} className="block w-full text-left"
        onMouseEnter={() => highlightGroup(row.groupId)} onMouseLeave={() => highlightGroup(null)}
        onFocus={() => highlightGroup(row.groupId)} onBlur={() => highlightGroup(null)}
        onClick={() => selectMember(people.find((person) => person.groupId === row.groupId && person.onIsland)?.id ?? null)}>
        <ChartBar label={group?.label ?? row.groupId} value={row.exposed} max={size ?? max}
          color={group?.color} detail={`${row.exposed} reached · ${row.actions} actions`} />
      </button>
    })}</div>
    {rows.length > 6 && <p className="mt-2 text-[10.5px] text-ui-faint">+{rows.length - 6} groups in the full report</p>}
  </Section>
}
