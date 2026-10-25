import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useReducedMotion } from 'motion/react'
import CountUp from '@/components/reactbits/CountUp'

/**
 * Compose classes so a caller's override actually wins.
 *
 * These controls are sized for the dense sidebar, and the paper screens reuse
 * them at a larger scale. `clsx` alone just concatenates, so `h-12` next to the
 * base `py-2` resolved by stylesheet order rather than by intent — it happened
 * to work, which is not the same as being correct. `tailwind-merge` drops the
 * class the caller meant to replace.
 */
const cx = (...parts: Parameters<typeof clsx>): string => twMerge(clsx(...parts))

/**
 * The small set of controls this app needs, in its own voice.
 *
 * Hand-rolled rather than generated: the brief is explicitly a warm, dense
 * instrument panel sitting beside a bright 3D scene, and a stock component kit
 * would pull every surface back towards the same rounded-card default.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-ui-accent text-ui-on-accent hover:brightness-105',
  secondary: 'bg-ui-raised text-ui-text border border-ui-border hover:border-ui-edge',
  ghost: 'text-ui-muted hover:text-ui-text hover:bg-ui-raised',
  danger: 'bg-ui-danger text-ui-on-accent hover:brightness-110',
}

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ui-text">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-snug text-ui-faint">{hint}</span>}
    </label>
  )
}

const INPUT_BASE =
  'w-full rounded-md border border-ui-border bg-ui-surface px-3 py-2 text-[13px] text-ui-text ' +
  'placeholder:text-ui-faint transition-colors hover:border-ui-edge focus:border-ui-accent focus:outline-none'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(INPUT_BASE, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(INPUT_BASE, 'resize-none leading-relaxed', className)} {...rest} />
}

/** A labelled section inside the sidebar. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('border-b border-ui-border px-4 py-4', className)}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="display text-[15px] text-ui-text">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  )
}

/**
 * A number with its label. Figures are tabular so a column of these stays
 * aligned as the cascade updates them.
 *
 * Numeric values count from wherever they currently are to the new value. The
 * vendored CountUp already restarts from its live value whenever `to` changes,
 * so with `trigger="load"` it needs no wrapper to behave as a ticker; the
 * 0.5s duration settles inside the shortest round dwell (650ms at 4x). Its own
 * reduced-motion check is a matchMedia read inside the effect, so the explicit
 * branch here keeps the rendered number a plain text node in that case.
 */
export function Stat({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string
  value: string | number
  tone?: 'default' | 'sun' | 'leaf' | 'bloom' | 'water'
  hint?: string
}) {
  const reduceMotion = useReducedMotion()
  const toneClass = {
    default: 'text-ui-text',
    sun: 'text-sun',
    leaf: 'text-leaf',
    bloom: 'text-bloom',
    water: 'text-water',
  }[tone]

  return (
    <div title={hint}>
      <div className={cx('display tnum text-[22px] leading-none', toneClass)}>
        {typeof value === 'number' && !reduceMotion ? (
          <CountUp to={value} trigger="load" duration={0.5} />
        ) : (
          value
        )}
      </div>
      <div className="mt-1 text-[11.5px] leading-tight text-ui-muted">{label}</div>
    </div>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'sun' | 'leaf' | 'bloom'
}) {
  return (
    <span
      className={cx(
        'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-ui-raised text-ui-muted',
        tone === 'sun' && 'bg-sun/15 text-sun',
        tone === 'leaf' && 'bg-leaf/15 text-leaf',
        tone === 'bloom' && 'bg-bloom/15 text-bloom',
      )}
    >
      {children}
    </span>
  )
}

/** A horizontal proportion bar, coloured to match a district on the island. */
export function Meter({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ui-surface">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ui-border px-4 py-6 text-center">
      <p className="display text-sm text-ui-text">{title}</p>
      {children && <p className="mt-1.5 text-xs leading-relaxed text-ui-faint">{children}</p>}
    </div>
  )
}
