import { createContext, useContext } from 'react'

export interface LoadingTicket {
  /** Resolve when the curtain covers the old screen, before navigating. */
  covered: Promise<void>
  finish(): void
}

export const LoadingContext = createContext<{ beginLoading(): LoadingTicket } | null>(null)

export function useLoadingTransition() {
  const context = useContext(LoadingContext)
  if (!context) throw new Error('Loading transitions require LoadingTransitionProvider.')
  return context
}
