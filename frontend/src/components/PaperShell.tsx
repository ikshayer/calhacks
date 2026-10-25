import type { ReactNode } from 'react'

/**
 * The light surface the app wears before the simulation starts.
 *
 * Sign-in, onboarding and the campaign hub are where someone decides what to
 * test; the workspace is an instrument standing next to a bright 3D island.
 * Those are different jobs, so they look different: paper here, dark there.
 * The `paper` class is what does it — index.css repoints the `--color-ui-*`
 * roles inside this subtree, so the shared controls come out burgundy on white
 * without a single changed class name.
 */
export function PaperShell({
  title,
  subtitle,
  actions,
  width = 'wide',
  children,
}: {
  /** Omitted on screens that carry their own headline, like sign-in. */
  title?: string
  subtitle?: string
  actions?: ReactNode
  /** `form` narrows the column for reading; `wide` is the hub's card grid. */
  width?: 'wide' | 'form'
  children: ReactNode
}) {
  return (
    <div className="paper scroll-slim h-full overflow-y-auto bg-canvas text-graphite">
      <div className="mx-auto w-full max-w-[1120px] px-5 pt-8 pb-16 md:px-8 md:pt-12 md:pb-24">
        {(title || actions) && (
          <header className="mb-10 flex items-start justify-between gap-6 md:mb-14">
            <div className="min-w-0">
              {title && (
                <h1 className="display text-[32px] leading-[1.14] tracking-tight text-graphite md:text-[40px]">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="mt-2.5 max-w-[46ch] text-[16px] leading-relaxed text-subtle">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-4 pt-1.5">{actions}</div>}
          </header>
        )}

        <div className={width === 'form' ? 'max-w-[880px]' : undefined}>{children}</div>
      </div>
    </div>
  )
}

/** A quiet text link for the shell header — sign out, edit profile. */
export function ShellLink({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded text-[14px] text-subtle transition-colors hover:text-graphite"
    >
      {children}
    </button>
  )
}
