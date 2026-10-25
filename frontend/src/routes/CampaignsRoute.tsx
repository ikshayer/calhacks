import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/auth/AuthProvider'
import type { CampaignId } from '@/data/types'
import DotGrid from '@/components/reactbits/DotGrid'
import { themeHex } from '@/lib/themeHex'
import { CampaignDropzone } from '@/campaigns/CampaignDropzone'
import { IdeaTestCard } from '@/campaigns/IdeaTestCard'
import { AbTestCard } from '@/campaigns/AbTestCard'
import { CampaignHistory } from '@/campaigns/CampaignHistory'

/**
 * The campaign hub: the screen between onboarding and the island.
 *
 * A campaign is one video and everything simulated against it, so this is
 * where the user chooses what to test, either by dropping a new video or by
 * reopening an earlier analysis. It reuses onboarding's column, backdrop and
 * header rhythm on purpose, so the two screens read as one product and the
 * hand-off from one to the other is not a change of scenery.
 */
export function CampaignsRoute() {
  const navigate = useNavigate()
  const profile = useAppStore((state) => state.profile)
  const openCampaign = useAppStore((state) => state.openCampaign)
  const { session, signOut } = useAuth()
  const reduceMotion = Boolean(useReducedMotion())
  const [dots] = useState(() => ({
    base: themeHex('--color-line', '#2e3b34'),
    active: themeHex('--color-sun', '#f2b53c'),
  }))

  // `createCampaign` has already made the new campaign current, so only the
  // reopened ones need the store call.
  const enter = () => navigate('/workspace')
  const reopen = (id: CampaignId) => {
    openCampaign(id)
    enter()
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <DotGrid
          dotSize={3}
          gap={26}
          baseColor={dots.base}
          activeColor={dots.active}
          opacity={0.28}
          fade={0.9}
          glow={0}
          mouseInteraction={false}
          clickShock={false}
          paused={reduceMotion}
        />
      </div>

      <main className="scroll-slim relative mx-auto flex h-full w-full max-w-[960px] flex-col overflow-y-auto px-6 py-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="display truncate text-[27px] leading-tight">
              {profile?.name || 'Untitled organisation'}
            </h1>
            <p className="mt-1.5 text-[13.5px] text-muted">Test a campaign before you publish it.</p>
          </div>
          <nav aria-label="Account" className="flex shrink-0 items-center gap-1 text-[12.5px]">
            <Link
              to="/onboarding"
              className="rounded px-1.5 py-0.5 text-faint transition-colors hover:text-paper"
            >
              Edit profile
            </Link>
            <button
              onClick={() => void signOut()}
              title={session?.email ?? undefined}
              className="rounded px-1.5 py-0.5 text-faint transition-colors hover:text-paper"
            >
              Sign out
            </button>
          </nav>
        </header>

        <div className="mt-7">
          <IdeaTestCard />
        </div>

        <div className="mt-5">
          <CampaignDropzone onCreated={enter} />
        </div>

        <div className="mt-5">
          <AbTestCard />
        </div>

        <div className="mt-9 border-t border-line pb-4 pt-6">
          <CampaignHistory onOpen={reopen} />
        </div>
      </main>
    </div>
  )
}
