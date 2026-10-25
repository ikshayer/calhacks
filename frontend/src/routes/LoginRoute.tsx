import { useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Field, Input } from '@/components/ui'
import DotGrid from '@/components/reactbits/DotGrid'
import RotatingText from '@/components/reactbits/RotatingText'
import { TOWN_SIZE } from '@/data/millbrook'

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
    <main className="paper lobby grid h-full lg:grid-cols-[1.1fr_minmax(420px,0.9fr)]">
      <Marquee />

      <div className="flex items-center justify-center bg-canvas px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-[380px]">
          <h2 className="display text-[30px] leading-tight text-title">
            {mode === 'in' ? 'Sign in' : 'Create an account'}
          </h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-subtle">
            Your uploads and reports stay private to your account. Nothing you test here is
            published.
          </p>

          <div className="mt-7 space-y-4">
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
            <p role="alert" className="mt-4 text-[14px] leading-snug text-ui-danger">
              {error}
            </p>
          )}

          <Button type="submit" className="mt-6 h-12 w-full text-[15px]" disabled={busy}>
            {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </Button>

          <button
            type="button"
            onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
            className="mt-4 w-full text-[14px] text-subtle transition-colors hover:text-title"
          >
            {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </button>

          <p className="mt-8 border-t border-rule pt-4 text-[13px] leading-relaxed text-subtle">
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
  // Light dots over the burgundy panel: the crowd has to read against the
  // gradient, and the garden tokens were picked for a near-black background.
  const [dots] = useState(() => ({ base: '#ffffff', active: '#ffd7c2' }))

  return (
    <div className="relative hidden flex-col justify-between overflow-hidden px-10 py-12 lg:flex">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(115deg, #650030, #b3124a 55%, #ff4f17)' }}
      />

      {/*
        The crowd. It sits over the gradient but well under the copy, and stays
        faint on purpose: legibility of the headline beats the effect. A click
        sends a ripple through it, which is the product's cascade in miniature —
        the one piece of decoration here that is actually about what this does.
        `paused` is needed because the grid's own loop ignores the CSS
        reduced-motion rule.
      */}
      <div aria-hidden className="absolute inset-0">
        <DotGrid
          dotSize={4}
          gap={22}
          baseColor={dots.base}
          activeColor={dots.active}
          opacity={0.32}
          proximity={110}
          strength={0.6}
          glow={0.25}
          swell={0.5}
          fade={0.7}
          clickShock
          paused={Boolean(reduceMotion)}
        />
      </div>

      <p className="relative text-[14px] font-medium text-white/80">Simthetic</p>

      <div className="relative max-w-[40rem]">
        <h1 className="display text-[clamp(2.2rem,3.7vw,3.3rem)] leading-[1.04] text-white">
          Find out who <Verdict reduceMotion={Boolean(reduceMotion)} />
          <br />
          before you post it.
        </h1>
        <p className="mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-white/80">
          Upload a campaign video and watch a simulated audience decide what to do with it. See
          which groups pass it on, where attention drops, and what to change — privately, while
          there is still time to re-cut.
        </p>
      </div>

      <dl className="relative flex gap-9 text-[14px]">
        <div>
          <dt className="text-white/65">Audience</dt>
          <dd className="display tnum mt-0.5 text-lg text-white">{TOWN_SIZE.total} residents</dd>
        </div>
        <div>
          <dt className="text-white/65">Sharing rounds</dt>
          <dd className="display tnum mt-0.5 text-lg text-white">6</dd>
        </div>
        <div>
          <dt className="text-white/65">Published</dt>
          <dd className="display mt-0.5 text-lg text-white">Nothing</dd>
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
  const tint = 'color-mix(in oklab, #ffffff 22%, transparent)'

  if (reduceMotion) {
    return (
      <span
        className="rounded-[0.16em] px-[0.28em] py-[0.1em] text-white"
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
        style={{ color: '#ffffff' }}
        mainClassName="col-start-1 row-start-1 justify-self-start"
        effect="slide"
        staggerDuration={0.018}
        rotationInterval={2800}
      />
    </span>
  )
}
