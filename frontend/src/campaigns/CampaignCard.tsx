import { useState } from 'react'
import type { Campaign } from '@/data/types'
import { Button, Pill } from '@/components/ui'

function formatDuration(totalSec: number): string {
  const whole = Math.max(0, Math.round(totalSec))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "1 share", not "1 shares". */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * One previous analysis.
 *
 * Delete is irreversible (the runs go with the campaign and the video is not
 * stored anywhere else), so it takes two deliberate clicks and the second one
 * names what is lost. The confirmation replaces the actions in place instead of
 * opening a modal: the row is where the user's attention already is, and
 * nothing is deleted until the second click.
 */
export function CampaignCard({
  campaign,
  onOpen,
  onDelete,
}: {
  campaign: Campaign
  onOpen(): void
  onDelete(): void
}) {
  const [confirming, setConfirming] = useState(false)
  const { headline, runIds } = campaign

  return (
    <li className="flex items-center gap-4 rounded-xl border border-line bg-panel/80 p-3 transition-colors hover:border-faint">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left">
        {campaign.posterDataUrl ? (
          <img
            src={campaign.posterDataUrl}
            alt=""
            className="h-[62px] w-[110px] shrink-0 rounded-md border border-line bg-ink object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-[62px] w-[110px] shrink-0 place-items-center rounded-md border border-line bg-ink text-[11px] text-faint"
          >
            No preview
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="display block truncate text-[15px] text-paper">{campaign.title}</span>
          <span className="mt-0.5 block text-[12px] text-muted">
            {formatDate(campaign.createdAt)} · {formatDuration(campaign.durationSec)} ·{' '}
            {plural(runIds.length, 'run')}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {headline ? (
              <>
                <Pill tone="sun">{headline.uniqueExposed} reached</Pill>
                <Pill>{plural(headline.likes, 'like')}</Pill>
                <Pill>{plural(headline.shares, 'share')}</Pill>
              </>
            ) : (
              <span className="text-[11.5px] text-faint">Not simulated yet</span>
            )}
            {!campaign.videoAvailable && (
              <span className="text-[11.5px] text-faint">video not stored</span>
            )}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {confirming ? (
          <>
            <span className="max-w-[16ch] text-right text-[11.5px] leading-snug text-muted">
              Delete this analysis and its runs?
            </span>
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onOpen}>
              Open
            </Button>
            <Button
              variant="ghost"
              aria-label={`Delete ${campaign.title}`}
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
