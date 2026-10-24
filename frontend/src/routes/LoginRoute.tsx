import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Field, Input } from '@/components/ui'

/**
 * Sign-in.
 *
 * The driver is local-only for now, and the page says so plainly instead of
 * implying a backend that is not there yet.
 */
export function LoginRoute() {
  const { signIn, signUp, error, driverLabel } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await (mode === 'in' ? signIn(email, password) : signUp(email, password))
    } catch {
      // The provider holds the message; the form stays filled in so it can be retried.
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid h-full lg:grid-cols-[1.1fr_minmax(420px,0.9fr)]">
      <Marquee />

      <div className="flex items-center justify-center border-line px-6 py-10 lg:border-l">
        <form onSubmit={submit} className="w-full max-w-[340px]">
          <h2 className="display text-[26px] leading-tight">
            {mode === 'in' ? 'Sign in' : 'Create an account'}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Your uploads and reports stay private to your account. Nothing you test here is
            published.
          </p>

          <div className="mt-6 space-y-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jim@givinggarden.org"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Password" hint="At least 6 characters.">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                required
              />
            </Field>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-[13px] leading-snug text-bloom">
              {error}
            </p>
          )}

          <Button type="submit" className="mt-6 w-full py-2.5" disabled={busy}>
            {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </Button>

          <button
            type="button"
            onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
            className="mt-4 w-full text-[13px] text-muted transition-colors hover:text-paper"
          >
            {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </button>

          <p className="mt-8 border-t border-line pt-4 text-[11.5px] leading-relaxed text-faint">
            {driverLabel}. Accounts live in this browser only while the hosted backend is being
            finished, so any valid email and password will get you in.
          </p>
        </form>
      </div>
    </main>
  )
}

/**
 * The left half of the sign-in screen.
 *
 * It opens on the thing the product actually does — a crowd of people deciding
 * whether to pass a video on — rather than a logo and a tagline.
 */
function Marquee() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden px-10 py-12 lg:flex">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(118% 85% at 18% 8%, #24352b 0%, #121a16 58%, #0d1411 100%)',
        }}
      />

      <p className="relative text-[13px] font-medium text-sun">Giving Garden</p>

      <div className="relative max-w-[30ch]">
        <h1 className="display text-[clamp(2.1rem,3.6vw,3.1rem)] leading-[1.04]">
          Find out who shares it, before you post it.
        </h1>
        <p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-muted">
          Upload a campaign video and watch a simulated audience decide what to do with it. See
          which groups pass it on, where attention drops, and what to change — privately, while
          there is still time to re-cut.
        </p>
      </div>

      <dl className="relative flex gap-9 text-[13px]">
        <div>
          <dt className="text-faint">Audience</dt>
          <dd className="display tnum mt-0.5 text-lg text-paper">500 members</dd>
        </div>
        <div>
          <dt className="text-faint">Sharing rounds</dt>
          <dd className="display tnum mt-0.5 text-lg text-paper">6</dd>
        </div>
        <div>
          <dt className="text-faint">Published</dt>
          <dd className="display mt-0.5 text-lg text-paper">Nothing</dd>
        </div>
      </dl>
    </div>
  )
}
