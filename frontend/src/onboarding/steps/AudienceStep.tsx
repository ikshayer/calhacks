import type { CompanyProfile } from '@/data/types'
import { BigTextarea, StepShell } from './StepShell'

/**
 * Who the campaign is for, in the user's own words.
 *
 * This replaces a screen that asked people to name audience segments and set
 * each one's percentage with a slider, before they had seen a single
 * simulation. That is a question about our data model, not about their
 * business. The sentence they write here is turned into segments by
 * `deriveGroups`, and the groups stay editable in the workspace once there are
 * numbers on screen to edit them against.
 */
export function AudienceStep({
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
      step={3}
      total={total}
      question="Who are you trying to reach?"
      help="Describe them the way you would to a new volunteer. Ages, where they live, what they care about — whatever actually distinguishes them."
    >
      <BigTextarea
        autoFocus
        rows={4}
        value={draft.audienceDescription ?? ''}
        onChange={(event) => patch({ audienceDescription: event.target.value })}
        placeholder="Students at the nearby campus, local families with young kids, and retired neighbours who already garden."
        aria-label="Who you are trying to reach"
      />
    </StepShell>
  )
}
