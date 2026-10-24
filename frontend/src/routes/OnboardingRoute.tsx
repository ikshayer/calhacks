import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useAppStore } from '@/store/useAppStore'
import type { CompanyProfile } from '@/data/types'
import { emptyProfile, normaliseShares } from '@/onboarding/suggestAudience'
import { Button } from '@/components/ui'
import DotGrid from '@/components/reactbits/DotGrid'
import { CompanyStep } from '@/onboarding/steps/CompanyStep'
import { AudienceStep } from '@/onboarding/steps/AudienceStep'
import { ObjectiveStep } from '@/onboarding/steps/ObjectiveStep'

const STEPS = [
  { id: 'company', title: 'Your organisation', blurb: 'One sentence is enough to start.' },
  { id: 'audience', title: 'Who you are reaching', blurb: 'Confirm or change the suggested groups.' },
  { id: 'objective', title: 'What you are optimising', blurb: 'And how you want to sound.' },
] as const

/**
 * DotGrid parses plain hex only and cannot see CSS variables, so the garden
 * tokens are read off the root once, with the index.css values as fallback.
 */
function themeHex(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback
}

/**
 * Onboarding.
 *
 * Builds the company profile the whole simulation depends on: the audience
 * groups, their assumed shares, and the tone. It is a wizard rather than one
 * long form because step two asks the user to confirm assumptions, and that
 * decision deserves its own screen rather than being buried in a field.
 */
export function OnboardingRoute() {
  const navigate = useNavigate()
  const existing = useAppStore((state) => state.profile)
  const setProfile = useAppStore((state) => state.setProfile)

  const [draft, setDraft] = useState<CompanyProfile>(() => existing ?? emptyProfile())
  const [step, setStep] = useState(0)
  const reduceMotion = Boolean(useReducedMotion())
  const [dots] = useState(() => ({
    base: themeHex('--color-line', '#2e3b34'),
    active: themeHex('--color-sun', '#f2b53c'),
  }))

  const patch = (changes: Partial<CompanyProfile>) =>
    setDraft((current) => ({ ...current, ...changes }))

  const canAdvance =
    step === 0
      ? draft.name.trim().length > 1 && draft.pitch.trim().length > 10
      : step === 1
        ? draft.groups.length > 0
        : true

  const finish = () => {
    setProfile({
      ...draft,
      name: draft.name.trim(),
      pitch: draft.pitch.trim(),
      groups: normaliseShares(draft.groups),
      // Bumped so a run can declare which audience definition it used.
      audienceVersion: (existing?.audienceVersion ?? 0) + 1,
    })
    navigate('/workspace', { replace: true })
  }

  const current = STEPS[step] ?? STEPS[0]

  const stepContent = (
    <>
      {step === 0 && <CompanyStep draft={draft} patch={patch} />}
      {step === 1 && <AudienceStep draft={draft} patch={patch} />}
      {step === 2 && <ObjectiveStep draft={draft} patch={patch} />}
    </>
  )

  return (
    <div className="relative h-full overflow-hidden">
      {/*
        Only there so the space beside the column and under short steps does not
        read as empty. It ignores the pointer on purpose (a form should not
        react to being typed near), and `paused` is what honours reduced motion,
        because the grid's own loop is not covered by the CSS rule.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <DotGrid
          dotSize={3}
          gap={26}
          baseColor={dots.base}
          activeColor={dots.active}
          opacity={0.28}
          fade={0.9}
          glow={0}
          mouseInteraction={false}
          clickShock={false}
          paused={reduceMotion}
        />
      </div>

      <main className="relative mx-auto flex h-full w-full max-w-[680px] flex-col px-6 py-8">
        <nav aria-label="Progress" className="flex items-center gap-2">
          {STEPS.map((entry, index) => (
            <div key={entry.id} className="flex flex-1 items-center gap-2">
              {/* The fill scales rather than swaps colour so finishing a step reads as progress. */}
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
                <span
                  className={`block h-full origin-left rounded-full bg-sun transition-transform duration-500 ease-out ${
                    index <= step ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
              </span>
            </div>
          ))}
        </nav>

        <header className="mt-7">
          <p className="text-[12.5px] text-faint">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1 className="display mt-1 text-[27px] leading-tight">{current.title}</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">{current.blurb}</p>
        </header>

        <div className="scroll-slim mt-7 min-h-0 flex-1 overflow-y-auto pr-1">
          {reduceMotion ? (
            stepContent
          ) : (
            // "wait" so the old step is gone before the new one mounts; they never share the scroll area.
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {stepContent}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <footer className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
          <Button
            variant="ghost"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0}
          >
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((value) => value + 1)} disabled={!canAdvance}>
              Continue
            </Button>
          ) : (
            <Button onClick={finish} disabled={!canAdvance}>
              Open the town
            </Button>
          )}
        </footer>
      </main>
    </div>
  )
}
