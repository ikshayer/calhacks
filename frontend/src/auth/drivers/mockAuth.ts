import { hashSeed } from '@/lib/rng'
import type { AuthDriver, Session } from './types'

const STORAGE_KEY = 'gardenlab.session'
/** Accounts created in this tab. Deliberately in-memory: no password is persisted anywhere. */
const accounts = new Map<string, string>()

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.token === 'string'
  )
}

function persist(session: Session): Session {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (cause: unknown) {
    // Private browsing or blocked storage: the session still works for this tab.
    console.warn('Could not persist session; it will not survive a reload.', cause)
  }
  return session
}

function makeSession(email: string): Session {
  return {
    userId: `local-${hashSeed(email.toLowerCase()).toString(36)}`,
    email,
    token: `local-${Date.now().toString(36)}`,
  }
}

function validate(email: string, password: string) {
  if (!email.includes('@')) throw new Error('Enter an email address.')
  if (password.length < 6) throw new Error('Use at least 6 characters.')
}

/**
 * Local-only authentication.
 *
 * It accepts any well-formed email and password so the demo never stalls on a
 * forgotten credential, stores the session in localStorage, and keeps nothing
 * on a server. It is a placeholder for a real driver, and the login screen says
 * so on the page rather than hiding it.
 */
export const mockAuthDriver: AuthDriver = {
  label: 'Local sign-in (no server)',

  async restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      if (!isSession(parsed)) {
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      return parsed
    } catch (cause: unknown) {
      console.warn('Discarding unreadable stored session.', cause)
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // Nothing more to do: storage is unavailable, so there is no session to clear.
      }
      return null
    }
  },

  async signIn(email, password) {
    validate(email, password)
    const known = accounts.get(email.toLowerCase())
    if (known !== undefined && known !== password) {
      throw new Error('That password does not match the account created in this tab.')
    }
    return persist(makeSession(email))
  },

  async signUp(email, password) {
    validate(email, password)
    accounts.set(email.toLowerCase(), password)
    return persist(makeSession(email))
  },

  async signOut() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (cause: unknown) {
      console.warn('Could not clear stored session.', cause)
    }
  },
}
