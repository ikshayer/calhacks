import type { IdeaOption, IdeaResident, RoundEvent, RunMetrics } from './types.ts'
import { verdictOf, type IdeaVerdict } from './ideaVerdict.ts'

export function nonnegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function chartNumber(value: number | undefined, digits = 0): string {
  const valid = nonnegative(value)
  return valid === undefined ? '—' : valid.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function probability(value: number | undefined): number | undefined {
  const valid = nonnegative(value)
  return valid !== undefined && valid <= 1 ? valid : undefined
}

export function ideaResponse(residents: IdeaResident[]) {
  const counts: Record<IdeaVerdict, number> = { going: 0, maybe: 0, not: 0 }
  let scored = 0
  for (const resident of residents) {
    const verdict = probability(resident.pVisit) === undefined ? undefined : verdictOf(resident)
    if (verdict === undefined) continue
    counts[verdict]++
    scored++
  }
  return { counts, scored, missing: residents.length - scored, total: residents.length }
}

/** A short recommendation is shown only when it names an actual option exactly. */
export function recommendedOption(options: IdeaOption[], ...recommendations: (string | undefined)[]): string | undefined {
  const normalize = (text: string) => text.trim().replace(/[.!]$/, '').toLocaleLowerCase()
  for (const recommendation of recommendations) {
    if (!recommendation) continue
    const matches = options.filter((option) => normalize(option.name) === normalize(recommendation))
    if (matches.length === 1) return matches[0].name
  }
  return undefined
}

interface RunResult {
  status: string
  rounds: RoundEvent[]
  metrics?: RunMetrics
}

/** Saved runs have no replay log. Their stored final totals remain authoritative. */
export function visibleRunResults(run: RunResult, round: number) {
  const playbackRound = Math.max(0, Number.isFinite(round) ? Math.floor(round) : 0)
  const final = run.status === 'complete' && (run.rounds.length === 0 || playbackRound >= run.rounds.length)
  if (final && run.metrics) return {
    final: true, exposed: run.metrics.uniqueExposed, watch: run.metrics.watch,
    likes: run.metrics.likes, comments: run.metrics.comments, shares: run.metrics.shares,
  }
  const totals = { final, exposed: 0, watch: 0, likes: 0, comments: 0, shares: 0 }
  const exposed = new Set<number>()
  for (const event of run.rounds.slice(0, playbackRound)) {
    event.exposed.forEach((id) => exposed.add(id))
    for (const action of event.acted) for (const kind of action.kinds) {
      if (kind === 'watch') totals.watch++
      else if (kind === 'like') totals.likes++
      else if (kind === 'comment') totals.comments++
      else if (kind === 'share') totals.shares++
    }
  }
  return { ...totals, exposed: exposed.size }
}

export function visibleGroupResults(run: RunResult, round: number, memberGroups: Map<number, string>) {
  if (visibleRunResults(run, round).final && run.metrics) return run.metrics.byGroup.map((group) => ({
    groupId: group.groupId, exposed: group.exposed,
    actions: group.watch + group.likes + group.comments + group.shares,
  }))
  const groups = new Map<string, { groupId: string; exposed: number; actions: number }>()
  const get = (id: number) => {
    const groupId = memberGroups.get(id)
    if (groupId === undefined) return undefined
    let group = groups.get(groupId)
    if (!group) { group = { groupId, exposed: 0, actions: 0 }; groups.set(groupId, group) }
    return group
  }
  for (const event of run.rounds.slice(0, Math.max(0, Math.floor(round)))) {
    for (const id of event.exposed) { const group = get(id); if (group) group.exposed++ }
    for (const action of event.acted) { const group = get(action.memberId); if (group) group.actions += action.kinds.length }
  }
  return [...groups.values()]
}
