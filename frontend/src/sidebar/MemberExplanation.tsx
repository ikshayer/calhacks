import { useEffect, useState } from 'react'
import type { Decision } from '@/data/types'
import { useAppStore } from '@/store/useAppStore'

/**
 * Why a simulated member would or would not engage.
 *
 * The mock writes explanations at scoring time; the live backend writes one on
 * demand (Claude) the first time a member is opened, so it may arrive a moment
 * after the panel does.
 */
export function MemberExplanation({ decision }: { decision: Decision }) {
  const source = useAppStore((state) => state.source)
  const runId = useAppStore((state) => state.activeRunId)
  // Keyed by member, so a panel reopened on someone else never shows the previous answer.
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
