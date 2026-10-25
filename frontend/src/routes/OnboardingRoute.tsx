import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useAppStore } from '@/store/useAppStore'
import type { CompanyProfile } from '@/data/types'
import { deriveGroups, emptyProfile, normaliseShares } from '@/onboarding/suggestAudience'
import { PaperShell } from '@/components/PaperShell'
import { StepRail } from '@/onboarding/StepRail'
import { NextPanel } from '@/onboarding/NextPanel'
import { NameStep } from '@/onboarding/steps/NameStep'
import { DescriptionStep } from '@/onboarding/steps/DescriptionStep'
import { AudienceStep } from '@/onboarding/steps/AudienceStep'
import { DetailsStep } from '@/onboarding/steps/DetailsStep'

const STEPS = ['Name', 'What you do', 'Audience', 'Details'] as const
const LAST = STEPS.length - 1

/** One easing for every transition on the paper screens. */
const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Onboarding.
 *
 * Four questions, one per screen. The previous version put five fields on the
 * first screen and a percentage-slider editor on the second, which asked
 * people to describe our data model before they had seen the product do
 * anything. Here each screen asks one thing in plain words, and the audience
 * segments are inferred from the answer rather than demanded up front.
 *
 * Only the first three are required. The fourth is optional and says so.
 */
export function OnboardingRoute() {
  const navigate = useNavigate()
  const existing = useAppStore((state) => state.profile)
  const setProfile = useAppStore((state) => state.setProfile)

  const [draft, setDraft] = useState<CompanyProfile>(() => existing ?? emptyProfile())
  const [step, setStep] = useState(0)
  const reduceMotion = Boolean(useReducedMotion())

  const patch = (changes: Partial<CompanyProfile>) =>
    setDraft((current) => ({ ...current, ...changes }))

  const canAdvance =
    step === 0
      ? draft.name.trim().length > 1
      : step === 1
        ? draft.pitch.trim().length > 10
        : step === 2
          ? (draft.audienceDescription ?? '').trim().length > 10
          : true

  const finish = () => {
    const audienceDescription = (draft.audienceDescription ?? '').trim()
    const pitch = draft.pitch.trim()
    const derived = deriveGroups(audienceDescription, pitch)

    setProfile({
      ...draft,
      name: draft.name.trim(),
      pitch,
      audienceDescription,
      // Groups are always stored, so switching segmentation back on in the
      // workspace has something to restore. What `derived === null` changes is
      // whether the simulation uses them: nothing in the description matched a
      // known segment, so every resident is judged on their own persona rather
      // than on segments we would have had to invent.
      groups: normaliseShares(derived ?? draft.groups),
      useAudienceGroups: derived !== null,
      audienceVersion: (existing?.audienceVersion ?? 0) + 1,
    })
    navigate('/campaigns', { replace: true })
  }

  const advance = () => (step === LAST ? finish() : setStep(step + 1))

  const content = (
    <>
      {step === 0 && <NameStep draft={draft} patch={patch} total={STEPS.length} />}
      {step === 1 && <DescriptionStep draft={draft} patch={patch} total={STEPS.length} />}
      {step === 2 && <AudienceStep draft={draft} patch={patch} total={STEPS.length} />}
      {step === 3 && <DetailsStep draft={draft} patch={patch} total={STEPS.length} />}
    </>
  )

  return (
    <PaperShell>
      <StepRail labels={STEPS} current={step} onJump={setStep} />

      <div
        // Enter submits the step, which is what a one-field screen implies.
        // Textareas keep Enter for newlines and take the modifier instead.
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          const multiline = event.target instanceof HTMLTextAreaElement
          if (multiline && !(event.metaKey || event.ctrlKey)) return
          if (!canAdvance) return
          event.preventDefault()
          advance()
        }}
        // Centred in the remaining height rather than pinned under the rail:
        // one question on a wide screen otherwise sits in the top third with a
        // field of empty paper beneath it.
        className="grid gap-10 lg:min-h-[58vh] lg:grid-cols-12 lg:gap-14 lg:content-center"
      >
        <div className="lg:col-span-7">
          {reduceMotion ? (
            content
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -32 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {content}
              </motion.div>
            </AnimatePresence>
          )}

          <div className="mt-10 flex items-center gap-4">
            {/* Not merely hidden on the first step: an invisible button still
                holds its space, which pushed the primary action away from the
                margin and read as a misalignment. */}
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="h-12 rounded-md px-4 text-[15px] font-medium text-subtle transition-colors hover:text-graphite"
              >
                Back
              </button>
            )}

            <button
              onClick={advance}
              disabled={!canAdvance}
              className="h-12 rounded-md bg-primary px-6 text-[15px] font-medium text-white transition-all hover:bg-primary/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {step === LAST ? 'Finish' : 'Continue'}
            </button>

            {step === LAST && (
              <button
                onClick={finish}
                className="text-[15px] text-subtle underline-offset-4 transition-colors hover:text-graphite hover:underline"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-5">
          <NextPanel />
        </div>
      </div>
    </PaperShell>
  )
}
