import type { IdeaViewState, RunState } from '../store/useAppStore.ts'

type Result = Pick<RunState, 'status' | 'error' | 'metrics' | 'report'> | undefined

function pending(result: Result): boolean {
  return Boolean(result && result.status !== 'failed' && !result.error &&
    !(result.status === 'complete' && result.metrics && result.report))
}

/** Wait for all results being shown, but reveal failed results so recovery stays accessible. */
export function simulationResultsLoading({ run, idea, preparing, comparedRuns = [], comparisonPreparation }: {
  run: Result
  idea: Pick<IdeaViewState, 'status'> | null
  preparing: boolean
  comparedRuns?: Result[]
  comparisonPreparation?: { status: 'preparing' | 'failed' } | null
}): boolean {
  if (comparisonPreparation) return comparisonPreparation.status === 'preparing'
  if (idea) return idea.status === 'running'
  if (comparedRuns.some((result) => result?.status === 'failed' || result?.error)) return false
  return preparing || pending(run) || comparedRuns.some(pending)
}
