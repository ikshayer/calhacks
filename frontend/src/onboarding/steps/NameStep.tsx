import type { CompanyProfile } from '@/data/types'
import { BigInput, StepShell } from './StepShell'

export function NameStep({
  draft,
  patch,
  total,
}: {
  draft: CompanyProfile
  patch(changes: Partial<CompanyProfile>): void
  total: number
}) {
  return (
    <StepShell
      step={1}
      total={total}
      question="What is your organisation called?"
      help="However you say it out loud. It appears on your reports and nowhere public."
    >
      <BigInput
        autoFocus
        value={draft.name}
        onChange={(event) => patch({ name: event.target.value })}
        placeholder="The Giving Garden"
        aria-label="Organisation name"
      />
    </StepShell>
  )
}
