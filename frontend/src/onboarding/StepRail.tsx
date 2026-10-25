/**
 * Where you are in onboarding.
 *
 * Numbered rather than a plain progress bar because these four questions are
 * genuinely a sequence with a known end — the number answers "how much more of
 * this is there", which a filling bar only gestures at. Steps already passed
 * stay filled so the rail reads as ground covered.
 */
export function StepRail({
  labels,
  current,
  onJump,
}: {
  labels: readonly string[]
  /** Zero-based. */
  current: number
  /** Jumping back is allowed; jumping ahead past unanswered questions is not. */
  onJump(index: number): void
}) {
  return (
    <ol className="mb-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] md:mb-14">
      {labels.map((label, index) => {
        const reached = index <= current
        const visited = index < current
        return (
          <li key={label} className="flex items-center gap-3">
            {index > 0 && <span aria-hidden className="h-px w-6 bg-rule" />}
            <button
              type="button"
              onClick={() => visited && onJump(index)}
              disabled={!visited}
              aria-current={index === current ? 'step' : undefined}
              className={
                'flex items-center gap-2 rounded ' +
                (visited ? 'cursor-pointer' : 'cursor-default')
              }
            >
              <span
                className={
                  'grid size-6 place-items-center rounded-full text-[12px] font-medium transition-colors ' +
                  (reached ? 'bg-primary text-white' : 'bg-rule/60 text-subtle')
                }
              >
                {index + 1}
              </span>
              <span
                className={
                  'transition-colors ' +
                  (index === current
                    ? 'font-medium text-title'
                    : visited
                      ? 'text-subtle hover:text-title'
                      : 'text-subtle/70')
                }
              >
                {label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
