import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { useAppStore } from './store/useAppStore'
import { LoginRoute } from './routes/LoginRoute'
import { CampaignsRoute } from './routes/CampaignsRoute'
import { OnboardingRoute } from './routes/OnboardingRoute'
import { useCampaignPersistence } from './store/useCampaignPersistence'
import { useProfilePersistence } from './store/useProfilePersistence'

// three.js and the island models are the bulk of the bundle and are needed only
// once someone reaches the workspace, so they load after sign-in rather than
// delaying the login screen.
const WorkspaceRoute = lazy(() =>
  import('./routes/WorkspaceRoute').then((module) => ({ default: module.WorkspaceRoute })),
)

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}

function Shell() {
  const { session, loading } = useAuth()
  const profile = useAppStore((state) => state.profile)
  const activeCampaignId = useAppStore((state) => state.activeCampaignId)
  const ideaActive = useAppStore((state) => state.idea !== null)
  // Restores the saved profile for the signed-in user, and saves it on change.
  const restoringProfile = useProfilePersistence(session?.userId)
  // Same contract for the campaign history, so the hub does not flash empty.
  const restoringCampaigns = useCampaignPersistence(session?.userId)
  const restoring = restoringProfile || restoringCampaigns

  // Never redirect while a stored session or profile is still being read, or a
  // returning user gets bounced to the login screen on every reload.
  if (loading || restoring) return <Booting />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  const onboarded = profile !== null && profile.name.trim().length > 0
  // An idea test (no video) also opens the workspace, so the island can show the verdicts.
  const hasCampaign = activeCampaignId !== null || ideaActive

  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingRoute />} />
      <Route
        path="/campaigns"
        element={onboarded ? <CampaignsRoute /> : <Navigate to="/onboarding" replace />}
      />
      <Route
        path="/workspace"
        element={
          !onboarded ? (
            <Navigate to="/onboarding" replace />
          ) : !hasCampaign ? (
            <Navigate to="/campaigns" replace />
          ) : (
            <Suspense fallback={<Booting />}>
              <WorkspaceRoute />
            </Suspense>
          )
        }
      />
      <Route path="*" element={<Navigate to={onboarded ? '/campaigns' : '/onboarding'} replace />} />
    </Routes>
  )
}

function Booting() {
  return (
    <div className="grid h-full place-items-center bg-ink">
      <p className="display text-lg text-muted">Opening the town…</p>
    </div>
  )
}
