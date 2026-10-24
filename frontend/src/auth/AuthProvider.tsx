import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { mockAuthDriver } from './drivers/mockAuth'
import type { AuthDriver, Session } from './drivers/types'

interface AuthState {
  session: Session | null
  /** True until the stored session has been read; routes must not redirect before this clears. */
  loading: boolean
  error: string | null
  driverLabel: string
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({
  children,
  driver = mockAuthDriver,
}: {
  children: ReactNode
  driver?: AuthDriver
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    driver
      .restore()
      .then((restored) => {
        if (active) setSession(restored)
      })
      .catch((cause: unknown) => {
        // A corrupt stored session must not lock the user out of the login screen.
        console.error('Failed to restore session', cause)
        if (active) setSession(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [driver])

  const run = useCallback(
    async (action: () => Promise<Session>) => {
      setError(null)
      try {
        setSession(await action())
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : 'Something went wrong. Try again.'
        setError(message)
        throw cause
      }
    },
    [],
  )

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      error,
      driverLabel: driver.label,
      signIn: (email, password) => run(() => driver.signIn(email, password)),
      signUp: (email, password) => run(() => driver.signUp(email, password)),
      signOut: async () => {
        await driver.signOut()
        setSession(null)
        setError(null)
      },
    }),
    [session, loading, error, driver, run],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}
