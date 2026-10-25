import { useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { CampaignId } from '@/data/types'
import { EmptyState } from '@/components/ui'
import { CampaignCard } from './CampaignCard'
import { Stagger } from '@/components/Reveal'

/**
 * Previous analyses, newest first.
 *
 * Subscribes to the `campaigns` record and sorts here: the store's
 * `selectCampaignHistory` allocates a new array per call, and handing that
 * straight to `useAppStore` would re-render on every store write.
 */
export function CampaignHistory({ onOpen }: { onOpen(id: CampaignId): void }) {
  const campaigns = useAppStore((state) => state.campaigns)
  const deleteCampaign = useAppStore((state) => state.deleteCampaign)
  const history = useMemo(
    () => Object.values(campaigns).sort((a, b) => b.createdAt - a.createdAt),
    [campaigns],
  )

  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="display text-[20px] text-title">
        Previous analyses
      </h2>
      <div className="mt-3">
        {history.length === 0 ? (
          <EmptyState title="Nothing here yet">
            Your first upload will appear here, with its runs, so you can come back to it.
          </EmptyState>
        ) : (
          <Stagger className="space-y-2.5">
            {history.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                onOpen={() => onOpen(campaign.id)}
                onDelete={() => deleteCampaign(campaign.id)}
              />
            ))}
          </Stagger>
        )}
      </div>
    </section>
  )
}
