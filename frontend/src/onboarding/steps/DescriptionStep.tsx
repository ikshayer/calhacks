import type { CompanyProfile } from '@/data/types'
import { BigTextarea, StepShell } from './StepShell'

export function DescriptionStep({
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
      step={2}
      total={total}
      question="What do you do?"
      help="A sentence or two, concrete rather than lofty. This is what the simulated residents judge your campaign against, so name the actual thing you make or run."
    >
      <BigTextarea
        autoFocus
        rows={4}
        value={draft.pitch}
        onChange={(event) => patch({ pitch: event.target.value })}
        placeholder="A community garden in Oakland that grows free produce and runs weekend harvests."
        aria-label="What your organisation does"
      />
    </StepShell>
  )
}
