import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { useAppStore } from './store/useAppStore'
import { LoginRoute } from './routes/LoginRoute'
import { OnboardingRoute } from './routes/OnboardingRoute'
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
  // Restores the saved profile for the signed-in user, and saves it on change.
  const restoring = useProfilePersistence(session?.userId)

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

  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingRoute />} />
      <Route
        path="/workspace"
        element={
          onboarded ? (
            <Suspense fallback={<Booting />}>
              <WorkspaceRoute />
            </Suspense>
          ) : (
            <Navigate to="/onboarding" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={onboarded ? '/workspace' : '/onboarding'} replace />} />
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
