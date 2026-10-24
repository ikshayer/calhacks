import { useEffect, useRef, useState } from 'react'
import type { CompanyProfile } from '@/data/types'
import { useAppStore } from './useAppStore'

const keyFor = (userId: string) => `gardenlab.profile.${userId}`

function isProfile(value: unknown): value is CompanyProfile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.groups)
  )
}

/**
 * Keeps the company profile in localStorage, per signed-in user.
 *
 * The profile is the one thing that must survive a reload: re-running
 * onboarding before every demo would be absurd. It is scoped by user id so two
 * accounts in the same browser cannot read each other's profile, which is the
 * minimum the privacy requirement asks of the client.
 *
 * Returns true while the stored profile is being read, so routes can hold off
 * redirecting to onboarding.
 */
export function useProfilePersistence(userId: string | undefined): boolean {
  const profile = useAppStore((state) => state.profile)
  const setProfile = useAppStore((state) => state.setProfile)
  /**
   * Which user's profile has actually been read off disk.
   *
   * Derived rather than a separate "loading" flag: the session arrives a render
   * after mount, so a flag initialised at mount is still false on the render
   * where `userId` first appears — and the route guard would redirect a
   * returning user back into onboarding before the restore effect ever ran.
   */
  const [restoredFor, setRestoredFor] = useState<string | null>(null)
  const loadedFor = useRef<string | null>(null)
  const restoring = Boolean(userId) && restoredFor !== userId

  useEffect(() => {
    if (!userId) return
    if (loadedFor.current === userId) return
    loadedFor.current = userId

    try {
      const raw = localStorage.getItem(keyFor(userId))
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (isProfile(parsed)) setProfile(parsed)
        else localStorage.removeItem(keyFor(userId))
      }
    } catch (cause: unknown) {
      // A bad stored profile sends the user through onboarding again rather
      // than leaving the workspace in a half-configured state.
      console.warn('Discarding unreadable stored profile.', cause)
    } finally {
      setRestoredFor(userId)
    }
  }, [userId, setProfile])

  useEffect(() => {
    if (!userId || !profile || restoring) return
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(profile))
    } catch (cause: unknown) {
      console.warn('Could not save the profile; it will not survive a reload.', cause)
    }
  }, [userId, profile, restoring])

  return restoring
}
