import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { LoadingContext, useLoadingTransition, type LoadingTicket } from './loading-transition-context'
import './loading-transition.css'

type Phase = 'hidden' | 'covering' | 'holding' | 'revealing'
const PANELS = 12

/** Shared curtain for entering the workspace and waiting on its analysis and assets. */
export function LoadingTransitionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [pending, setPending] = useState(0)
  const nextId = useRef(0)
  const covered = useRef(false)
  const tickets = useRef(new Map<number, () => void>())

  const beginLoading = useCallback((): LoadingTicket => {
    const id = ++nextId.current
    let resolveCovered = () => {}
    const ready = covered.current ? Promise.resolve() : new Promise<void>((resolve) => { resolveCovered = resolve })
    tickets.current.set(id, resolveCovered)
    setPending(tickets.current.size)
    setPhase((current) => current === 'hidden' || current === 'revealing' ? 'covering' : current)
    let finished = false
    return {
      covered: ready,
      finish() {
        if (finished) return
        finished = true
        resolveCovered()
        tickets.current.delete(id)
        setPending(tickets.current.size)
      },
    }
  }, [])

  useEffect(() => {
    if (phase !== 'holding' || pending > 0) return
    // Give the loading label a short, readable beat even on a cache hit.
    const timeout = window.setTimeout(() => {
      covered.current = false
      setPhase('revealing')
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [phase, pending])

  const completeAnimation = () => {
    if (phase === 'covering') {
      covered.current = true
      for (const resolve of tickets.current.values()) resolve()
      setPhase('holding')
    } else if (phase === 'revealing') {
      setPhase(tickets.current.size ? 'covering' : 'hidden')
    }
  }

  const visible = phase !== 'hidden'
  return (
    <LoadingContext.Provider value={{ beginLoading }}>
      <div className="contents" inert={visible || undefined}>{children}</div>
      {visible && (
        <div className={`loading-curtain loading-curtain--${phase}`} data-loading-phase={phase}
          role="status" aria-live="polite" aria-label="Loading...">
          <div className="loading-curtain__panels" aria-hidden="true">
            {Array.from({ length: PANELS }, (_, index) => (
              <div key={index} className="loading-curtain__panel"
                style={{ left: `${index * 100 / PANELS}%`, animationDelay: `${index * 35}ms` }}
                onAnimationEnd={index === PANELS - 1 ? completeAnimation : undefined} />
            ))}
          </div>
          <div className="loading-curtain__label" aria-hidden="true">
            <span className="display">Loading...</span>
            <span className="loading-curtain__dots"><i /><i /><i /></span>
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  )
}

/** Keep the same curtain up until this particular piece of real work is ready. */
export function LoadingGate({ active = true }: { active?: boolean }) {
  const { beginLoading } = useLoadingTransition()
  useEffect(() => {
    if (!active) return
    return beginLoading().finish
  }, [active, beginLoading])
  return null
}
