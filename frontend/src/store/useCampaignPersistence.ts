import { useEffect, useRef, useState } from 'react'
import type { Campaign, ContentSignals } from '@/data/types'
import { useAppStore, type StoredRun } from './useAppStore'

const keyFor = (userId: string) => `gardenlab.campaigns.${userId}`

/** Bump when the stored shape changes; an unknown version is discarded, not guessed at. */
const STORAGE_VERSION = 1

interface StoredCampaigns {
  version: typeof STORAGE_VERSION
  campaigns: Campaign[]
  runs: StoredRun[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function isSignals(value: unknown): value is ContentSignals {
  return (
    isRecord(value) &&
    typeof value.hookStrength === 'number' &&
    typeof value.clarityOfAsk === 'number' &&
    typeof value.pacing === 'number' &&
    typeof value.warmth === 'number' &&
    typeof value.durationSec === 'number' &&
    Array.isArray(value.topics)
  )
}

function isCampaign(value: unknown): value is Campaign {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.profileId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.videoId === 'string' &&
    typeof value.videoName === 'string' &&
    typeof value.durationSec === 'number' &&
    typeof value.videoAvailable === 'boolean' &&
    typeof value.summary === 'string' &&
    isSignals(value.signals) &&
    Array.isArray(value.runIds)
  )
}

function isStoredRun(value: unknown): value is StoredRun {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.campaignId === 'string' &&
    typeof value.label === 'string' &&
    typeof value.videoId === 'string' &&
    isRecord(value.options) &&
    (value.options.audienceKey === undefined || typeof value.options.audienceKey === 'string') &&
    typeof value.status === 'string'
  )
}

function isStoredCampaigns(value: unknown): value is StoredCampaigns {
  return (
    isRecord(value) &&
    value.version === STORAGE_VERSION &&
    Array.isArray(value.campaigns) &&
    value.campaigns.every(isCampaign) &&
    Array.isArray(value.runs) &&
    value.runs.every(isStoredRun)
  )
}

/**
 * The part of a campaign that is worth keeping.
 *
 * The file is never stored, so every campaign comes back with
 * `videoAvailable: false`. Only complete runs are kept: one caught mid-cascade
 * cannot be resumed after a reload, and a half-finished entry in the history
 * would read as a result.
 */
function project(
  campaigns: Record<string, Campaign>,
  runs: Record<string, StoredRun>,
): StoredCampaigns {
  const kept: StoredRun[] = []
  for (const run of Object.values(runs)) {
    if (run.status !== 'complete' || !(run.campaignId in campaigns)) continue
    // Store summaries rather than a full replay. The audience identity in
    // options survives so restored results cannot be mixed with another town.
    const { id, campaignId, label, videoId, options, status, metrics, report } = run
    kept.push({
      id,
      campaignId,
      label,
      videoId,
      options,
      status,
      metrics,
      report,
    })
  }
  const keptIds = new Set(kept.map((run) => run.id))
  return {
    version: STORAGE_VERSION,
    campaigns: Object.values(campaigns).map((campaign) => ({
      ...campaign,
      videoAvailable: false,
      runIds: campaign.runIds.filter((runId) => keptIds.has(runId)),
    })),
    runs: kept,
  }
}

/**
 * Keeps campaign history in localStorage, per signed-in user.
 *
 * Mirrors `useProfilePersistence`: the same per-user scoping, the same
 * validate-before-trust read, and the same returned `restoring` flag so routes
 * do not redirect to the campaign hub before the history has been read.
 *
 * Returns true while the stored history is being read.
 */
export function useCampaignPersistence(userId: string | undefined): boolean {
  const campaigns = useAppStore((state) => state.campaigns)
  const runs = useAppStore((state) => state.runs)
  const restoreCampaigns = useAppStore((state) => state.restoreCampaigns)
  /** Derived for the same reason as in `useProfilePersistence`: see there. */
  const [restoredFor, setRestoredFor] = useState<string | null>(null)
  const loadedFor = useRef<string | null>(null)
  const restoring = Boolean(userId) && restoredFor !== userId

  useEffect(() => {
    if (!userId) return
    if (loadedFor.current === userId) return
    loadedFor.current = userId

    // Whatever the previous user left in memory must not leak into this one's
    // history, so the slice is reset even when nothing is stored.
    restoreCampaigns([], [])
    try {
      const raw = localStorage.getItem(keyFor(userId))
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (isStoredCampaigns(parsed)) {
          restoreCampaigns(parsed.campaigns, parsed.runs)
        } else {
          console.warn('Discarding stored campaign history in an unknown format.')
          localStorage.removeItem(keyFor(userId))
        }
      }
    } catch (cause: unknown) {
      // History is a convenience: an unreadable copy starts the list empty
      // rather than blocking sign-in.
      console.warn('Discarding unreadable stored campaign history.', cause)
    } finally {
      setRestoredFor(userId)
    }
  }, [userId, restoreCampaigns])

  useEffect(() => {
    if (!userId || restoring) return
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(project(campaigns, runs)))
    } catch (cause: unknown) {
      const quota = cause instanceof DOMException && cause.name === 'QuotaExceededError'
      console.warn(
        quota
          ? 'Browser storage is full; campaign history will not survive a reload.'
          : 'Could not save campaign history; it will not survive a reload.',
        cause,
      )
    }
  }, [userId, campaigns, runs, restoring])

  return restoring
}
