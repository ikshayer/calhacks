import type { ReactNode } from 'react'

/**
 * One question, and room to answer it.
 *
 * The question is set at display size because on a screen that asks for
 * exactly one thing, the question *is* the content — shrinking it to a form
 * label and filling the rest with chrome is what made the old three-step
 * version feel like paperwork.
 */
export function StepShell({
  step,
  total,
  question,
  help,
  children,
}: {
  step: number
  total: number
  question: string
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <p className="text-[14px] text-subtle">
        Step {step} of {total}
      </p>
      <h2 className="display mt-2 max-w-[18ch] text-[34px] leading-[1.1] tracking-tight text-title md:text-[42px]">
        {question}
      </h2>
      {help && <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-subtle">{help}</p>}
      <div className="mt-7">{children}</div>
    </div>
  )
}

/**
 * The single large control each step is built around.
 *
 * Deliberately not the shared `Input`: that one is sized for a dense sidebar at
 * 13px, and the same control here needs to look like the only thing on the
 * page. Both read the same `--color-ui-*` roles, so they stay the same colour.
 */
const FIELD_BASE =
  'w-full rounded-lg border border-ui-border bg-ui-surface px-4 text-[17px] text-ui-text ' +
  'placeholder:text-ui-faint transition-colors hover:border-ui-edge ' +
  // An explicit shadow rather than `ring-*`: the ring utilities were not
  // being generated here, so the focus state was a border colour change and
  // nothing else — too quiet to be the only cue.
  'focus:border-ui-accent focus:outline-none focus:shadow-[0_0_0_3px_rgba(101,0,48,0.16)]'

export function BigInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return <input className={`${FIELD_BASE} h-14 ${className ?? ''}`} {...rest} />
}

export function BigTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props
  return (
    <textarea
      className={`${FIELD_BASE} resize-none py-3.5 leading-relaxed ${className ?? ''}`}
      {...rest}
    />
  )
}
