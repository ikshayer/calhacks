export interface Session {
  userId: string
  email: string
  /** Opaque token the backend will validate. The mock driver issues a local one. */
  token: string
}

/**
 * Authentication, behind one small interface.
 *
 * HACK.md leaves the authentication implementation open. Rather than block the
 * whole frontend on that decision, screens talk to this interface and the mock
 * driver keeps everything usable now. Swapping in a real driver (the Node
 * backend, or SpacetimeDB identity) touches this folder and nothing else.
 *
 * Whatever driver ships must enforce the privacy requirement that matters here:
 * uploads and reports are per-owner and never exposed to another user.
 */
export interface AuthDriver {
  /** Shown in the UI so it is always obvious which driver is live. */
  readonly label: string
  /** Returns the stored session, or null. Must not throw on corrupt storage. */
  restore(): Promise<Session | null>
  signIn(email: string, password: string): Promise<Session>
  signUp(email: string, password: string): Promise<Session>
  signOut(): Promise<void>
}
