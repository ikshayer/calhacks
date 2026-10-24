import type { CompanyProfile } from '@/data/types'
import { Field, Input, Textarea } from '@/components/ui'

export interface StepProps {
  draft: CompanyProfile
  patch(changes: Partial<CompanyProfile>): void
}

export function CompanyStep({ draft, patch }: StepProps) {
  return (
    <div className="space-y-5">
      <Field label="Organisation name">
        <Input
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="The Giving Garden"
          autoFocus
        />
      </Field>

      <Field
        label="What you do, and who it is for"
        hint="One sentence. This is what the simulated audience reacts to, so be concrete about the people rather than the mission."
      >
        <Textarea
          rows={3}
          value={draft.pitch}
          onChange={(event) => patch({ pitch: event.target.value })}
          placeholder="A community garden that grows free produce for neighbours and needs weekend volunteers to harvest it."
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Website" hint="Optional.">
          <Input
            value={draft.website ?? ''}
            onChange={(event) => patch({ website: event.target.value })}
            placeholder="givinggarden.org"
          />
        </Field>
        <Field label="Instagram" hint="Optional.">
          <Input
            value={draft.instagram ?? ''}
            onChange={(event) => patch({ instagram: event.target.value })}
            placeholder="@givinggarden"
          />
        </Field>
      </div>

      <Field label="Where you are" hint="Used to keep the audience local where that matters.">
        <Input
          value={draft.location ?? ''}
          onChange={(event) => patch({ location: event.target.value })}
          placeholder="Oakland, CA"
        />
      </Field>

      <p className="rounded-lg border border-line bg-panel px-3.5 py-3 text-xs leading-relaxed text-muted">
        Working on something unreleased? The description on its own is enough. You can leave the
        website and Instagram blank and nothing you upload is ever made public.
      </p>
    </div>
  )
}
