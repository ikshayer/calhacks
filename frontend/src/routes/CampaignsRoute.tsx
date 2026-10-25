import { Link, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/auth/AuthProvider'
import type { CampaignId } from '@/data/types'
import { LobbyShell } from '@/components/LobbyShell'
import { CampaignDropzone } from '@/campaigns/CampaignDropzone'
import { IdeaTestCard } from '@/campaigns/IdeaTestCard'
import { CampaignHistory } from '@/campaigns/CampaignHistory'
import { Reveal } from '@/components/Reveal'

/**
 * The campaign hub: the screen between onboarding and the island.
 *
 * A campaign is one video and everything simulated against it, so this is
 * where the user chooses what to test — drop a video, describe an idea that
 * has no video yet, or reopen an earlier analysis. It shares onboarding's
 * paper shell so the hand-off between them is not a change of scenery; the
 * dark instrument panel only arrives with the island, where it has a job.
 */
export function CampaignsRoute() {
  const navigate = useNavigate()
  const profile = useAppStore((state) => state.profile)
  const openCampaign = useAppStore((state) => state.openCampaign)
  const { session, signOut } = useAuth()

  // `createCampaign` has already made the new campaign current, so only the
  // reopened ones need the store call.
  const enter = () => navigate('/workspace')
  const reopen = (id: CampaignId) => {
    openCampaign(id)
    enter()
  }

  return (
    <LobbyShell
      title={profile?.name || 'Untitled organisation'}
      subtitle="Test a campaign before you publish it."
      actions={
        <nav aria-label="Account" className="flex items-center gap-4 text-[14px]">
          <Link
            to="/onboarding"
            className="rounded text-subtle transition-colors hover:text-title"
          >
            Edit profile
          </Link>
          <button
            onClick={() => void signOut()}
            title={session?.email ?? undefined}
            className="rounded text-subtle transition-colors hover:text-title"
          >
            Sign out
          </button>
        </nav>
      }
    >
      {/*
        Two ways in, side by side rather than stacked: a video to test and an
        idea with no video yet are alternatives, and stacking them made the
        second look like an afterthought below the "real" one.
      */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal className="h-full">
          <CampaignDropzone onCreated={enter} />
        </Reveal>
        <Reveal className="h-full" delay={0.08}>
          <IdeaTestCard />
        </Reveal>
      </div>

      <Reveal className="mt-12 border-t border-rule pt-8" delay={0.16}>
        <CampaignHistory onOpen={reopen} />
      </Reveal>
    </LobbyShell>
  )
}
