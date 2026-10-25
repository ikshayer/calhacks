import type { IdeaViewState, RunState } from '../store/useAppStore.ts'
import type { ChatTarget } from './types.ts'

export type ChatSubject = ChatTarget & { label: string; ready: boolean; failed: boolean }

/** The active idea view takes precedence over any older video still in memory. */
export function chatSubject(idea: IdeaViewState | null, run: RunState | undefined): ChatSubject | undefined {
  if (idea) return {
    kind: 'idea', id: idea.result?.id ?? '', label: idea.result?.idea || idea.input.prompt,
    ready: idea.status === 'ready' && idea.result?.status === 'ready', failed: idea.status === 'failed',
  }
  if (run) return { kind: 'run', id: run.id, label: run.label, ready: run.status === 'complete', failed: run.status === 'failed' }
  return undefined
}

export function chatTargetKey(target: ChatTarget): string {
  return `${target.kind}:${target.id}`
}
