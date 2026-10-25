import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GradualBlur from '@/components/reactbits/GradualBlur'
import { useAppStore, selectActiveCampaign, selectActiveRun } from '@/store/useAppStore'
import { useAuth } from '@/auth/AuthProvider'
import { SignalsPanel } from './SignalsPanel'
import { MemberPanel } from './MemberPanel'
import { IdeaPanel } from './IdeaPanel'
import { RunPanel } from './RunPanel'
import { MetricsPanel } from './MetricsPanel'
import { GroupsPanel } from './GroupsPanel'
import { MiniGraph } from './MiniGraph'
import { ReportPanel } from './ReportPanel'
import { ChatPanel } from './ChatPanel'
import { ComparePanel } from './ComparePanel'
import { AbBar } from './AbBar'
import { AssumptionsStrip } from './AssumptionsStrip'
import { ViewOptions } from './ViewOptions'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'report', label: 'Report' },
  { id: 'chat', label: 'Ask' },
  { id: 'compare', label: 'Compare' },
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * The instrument panel.
 *
 * Deliberately dense and dark against the bright island: the canvas is where
 * you look, this is where you read. The assumptions strip is pinned to the
 * bottom rather than placed in a tab, because a disclosure you have to go
 * looking for is not a disclosure.
 *
 * It has two modes. With nobody selected it is the audience-wide report; once
 * a resident is selected the camera has committed the screen to them, so the
 * tab bar and its panels give way to that one member's report. The tab lives in
 * this component's state, which survives the switch because only the body is
 * swapped, so "Everyone" returns to the tab the user left rather than resetting
 * to Overview. The assumptions strip stays in both modes: who the audience is
 * assumed to be does not stop applying when you look at one person.
 */
export function Sidebar({
  shadows,
  onShadowsChange,
  playing,
}: {
  shadows: boolean
  onShadowsChange(value: boolean): void
  playing: boolean
}) {
  const [tab, setTab] = useState<TabId>('overview')
  const profile = useAppStore((state) => state.profile)
  const run = useAppStore(selectActiveRun)
  const campaign = useAppStore(selectActiveCampaign)
  const selectedMemberId = useAppStore((state) => state.selectedMemberId)
  const selectMember = useAppStore((state) => state.selectMember)
  const navigate = useNavigate()
  const source = useAppStore((state) => state.source)
  const { session, signOut } = useAuth()

  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-panel lg:w-[384px] lg:border-l">
      <header className="border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <button
            onClick={() => navigate('/campaigns')}
            className="-ml-1.5 rounded px-1.5 py-0.5 text-[12px] text-faint transition-colors hover:text-paper"
          >
            ← Campaigns
          </button>
          <button
            onClick={() => void signOut()}
            title={session?.email ?? undefined}
            className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-faint transition-colors hover:text-paper"
          >
            Sign out
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {campaign?.posterDataUrl && (
            <img
              src={campaign.posterDataUrl}
              alt=""
              className="h-[34px] w-[60px] shrink-0 rounded border border-line bg-ink object-cover"
            />
          )}
          <div className="min-w-0">
            <h1 className="display truncate text-[17px] leading-tight text-paper">
              {campaign?.title ?? 'No campaign open'}
            </h1>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {profile?.name || 'Untitled organisation'}
            </p>
          </div>
        </div>
      </header>

      <AbBar onCompare={() => setTab('compare')} />

      {selectedMemberId === null ? (
        <nav className="flex shrink-0 border-b border-line px-2" aria-label="Panels">
          {TABS.map((entry) => {
            const active = tab === entry.id
            return (
              <button
                key={entry.id}
                onClick={() => setTab(entry.id)}
                aria-current={active ? 'page' : undefined}
                className={
                  'relative px-3 py-2.5 text-[13px] font-medium transition-colors ' +
                  (active ? 'text-paper' : 'text-faint hover:text-muted')
                }
              >
                {entry.label}
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-sun" />
                )}
              </button>
            )
          })}
        </nav>
      ) : (
        <nav className="flex shrink-0 border-b border-line px-2" aria-label="Member report">
          <button
            onClick={() => selectMember(null)}
            className="px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:text-paper"
          >
            ← Everyone
          </button>
        </nav>
      )}

      {/* The fade is positioned against this wrapper, not the scroller: an
          absolute child of the scroller would scroll away with the content. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          {selectedMemberId !== null ? (
            <MemberPanel memberId={selectedMemberId} />
          ) : (
            <>
              <IdeaPanel />
              {tab === 'overview' && (
                <>
                  <SignalsPanel />
                  <RunPanel />
                  <MetricsPanel />
                  <GroupsPanel />
                  <MiniGraph />
                  <ViewOptions
                    shadows={shadows}
                    onShadowsChange={onShadowsChange}
                    sourceLabel={source.label}
                    playing={playing}
                  />
                </>
              )}
              {tab === 'report' && <ReportPanel />}
              {tab === 'chat' && <ChatPanel />}
              {tab === 'compare' && <ComparePanel />}
            </>
          )}
        </div>
        <GradualBlur
          position="bottom"
          target="parent"
          height="4rem"
          strength={1}
          tint="var(--color-panel)"
          zIndex={10}
        />
      </div>

      <AssumptionsStrip run={run} />
    </aside>
  )
}
