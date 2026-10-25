import { useState } from 'react'
import type { Campaign } from '@/data/types'
import { Button } from '@/components/ui'

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
 * The headline metrics are local chips, not `Pill`: its `sun` tone is marigold
 * text, which fails contrast on white, and its 11px size is too small for the
 * numbers this row exists to show.
 */
const METRIC_PILL = 'inline-block rounded-full px-2.5 py-0.5 text-[13px] font-medium'

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
    <li className="flex items-center gap-4 rounded-xl bg-card p-3.5 ring-1 ring-black/10 transition-shadow hover:ring-black/25">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left">
        {campaign.posterDataUrl ? (
          <img
            src={campaign.posterDataUrl}
            alt=""
            className="h-[68px] w-[120px] shrink-0 rounded-md bg-ui-raised object-cover ring-1 ring-black/10"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-[68px] w-[120px] shrink-0 place-items-center rounded-md bg-ui-raised text-[12px] text-subtle ring-1 ring-black/10"
          >
            No preview
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="display block truncate text-[17px] text-graphite">{campaign.title}</span>
          <span className="mt-0.5 block text-[13.5px] text-subtle">
            {formatDate(campaign.createdAt)} · {formatDuration(campaign.durationSec)} ·{' '}
            {plural(runIds.length, 'run')}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            {headline ? (
              <>
                <span className={`${METRIC_PILL} bg-primary/10 text-primary`}>
                  {headline.uniqueExposed} reached
                </span>
                <span className={`${METRIC_PILL} bg-ui-raised text-subtle`}>
                  {plural(headline.likes, 'like')}
                </span>
                <span className={`${METRIC_PILL} bg-ui-raised text-subtle`}>
                  {plural(headline.shares, 'share')}
                </span>
              </>
            ) : (
              <span className="text-[13px] text-subtle">Not simulated yet</span>
            )}
            {!campaign.videoAvailable && (
              <span className="text-[13px] text-subtle">video not stored</span>
            )}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {confirming ? (
          <>
            <span className="max-w-[18ch] text-right text-[13px] leading-snug text-subtle">
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
