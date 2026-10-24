import { useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Field, Input } from '@/components/ui'
import DotGrid from '@/components/reactbits/DotGrid'
import RotatingText from '@/components/reactbits/RotatingText'

/**
 * DotGrid parses plain hex only and cannot see CSS variables, so the garden
 * tokens are read off the root once. The fallbacks match index.css, so a theme
 * that has not emitted the variable still lands on the right colour.
 */
function themeHex(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback
}

/** What the audience might do with the video; the headline cycles through them. */
const VERDICTS = ['shares it', 'skips it', 'passes it on']

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
  const reduceMotion = useReducedMotion()
  const [dots] = useState(() => ({
    base: themeHex('--color-line', '#2e3b34'),
    active: themeHex('--color-sun', '#f2b53c'),
  }))

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

      {/*
        The crowd. It sits above the vignette but well under the copy, and stays
        faint on purpose: legibility of the headline beats the effect. A click
        sends a ripple through it, which is the product's cascade in miniature.
        `paused` is needed because the grid's own loop ignores the CSS
        reduced-motion rule.
      */}
      <div aria-hidden className="absolute inset-0">
        <DotGrid
          dotSize={4}
          gap={22}
          baseColor={dots.base}
          activeColor={dots.active}
          opacity={0.6}
          proximity={110}
          strength={0.6}
          glow={0.25}
          swell={0.5}
          fade={0.7}
          clickShock
          paused={Boolean(reduceMotion)}
        />
      </div>

      <p className="relative text-[13px] font-medium text-sun">Giving Garden</p>

      <div className="relative max-w-[40rem]">
        <h1 className="display text-[clamp(2.1rem,3.6vw,3.1rem)] leading-[1.04]">
          Find out who <Verdict reduceMotion={Boolean(reduceMotion)} />
          <br />
          before you post it.
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

/**
 * The rotating middle of the headline.
 *
 * RotatingText resizes its highlight block to each word, which would drag
 * everything after it sideways on every swap. So the block lives in a grid
 * cell shared with invisible copies of every phrase: the cell is as wide as the
 * longest one and never changes, and shorter highlights sit left-aligned inside
 * it. The line break after it stops the leftover gap reading as a hole in a
 * sentence.
 *
 * The highlight colour is a colour-mix, not a hex, on purpose: RotatingText
 * picks black or white text by parsing the background, and parsing the opaque
 * sun would give dark text on what is really a near-black tint.
 */
function Verdict({ reduceMotion }: { reduceMotion: boolean }) {
  const tint = 'color-mix(in oklab, var(--color-sun) 16%, transparent)'

  if (reduceMotion) {
    return (
      <span
        className="rounded-[0.16em] px-[0.28em] py-[0.1em] text-sun"
        style={{ backgroundColor: tint }}
      >
        {VERDICTS[0]}
      </span>
    )
  }

  return (
    <span className="inline-grid align-baseline">
      {VERDICTS.map((text) => (
        <span
          key={text}
          aria-hidden
          className="invisible col-start-1 row-start-1 whitespace-pre px-[0.28em] py-[0.1em]"
        >
          {text}
        </span>
      ))}
      <RotatingText
        texts={VERDICTS}
        highlight
        highlightColor={tint}
        style={{ color: 'var(--color-sun)' }}
        mainClassName="col-start-1 row-start-1 justify-self-start"
        effect="slide"
        staggerDuration={0.018}
        rotationInterval={2800}
      />
    </span>
  )
}
