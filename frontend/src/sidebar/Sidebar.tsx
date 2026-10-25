import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GradualBlur from '@/components/reactbits/GradualBlur'
import { useAppStore, selectActiveCampaign, selectActiveRun } from '@/store/useAppStore'
import { useAuth } from '@/auth/AuthProvider'
import { chatSubject, chatTargetKey } from '@/data/chatSubject'
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
import { AssumptionsStrip } from './AssumptionsStrip'
import { ViewOptions } from './ViewOptions'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'report', label: 'Report' },
  { id: 'chat', label: 'Assistant' },
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
  const [chatMember, setChatMember] = useState<{ subjectKey: string; name: string } | null>(null)
  const profile = useAppStore((state) => state.profile)
  const run = useAppStore(selectActiveRun)
  const idea = useAppStore((state) => state.idea)
  const subject = chatSubject(idea, run)
  const subjectKey = subject ? chatTargetKey(subject) : ''
  const campaign = useAppStore(selectActiveCampaign)
  const selectedMemberId = useAppStore((state) => state.selectedMemberId)
  const selectedMember = useAppStore((state) => state.audience?.members.find((member) => member.id === state.selectedMemberId))
  const selectMember = useAppStore((state) => state.selectMember)
  const navigate = useNavigate()
  const source = useAppStore((state) => state.source)
  const { session, signOut } = useAuth()

  return (
    <aside className={
      'paper flex w-full shrink-0 flex-col border-ui-border bg-ui-panel lg:w-[384px] lg:border-l ' +
      (selectedMemberId === null && tab === 'chat' ? 'h-[85dvh] lg:h-auto' : '')
    }>
      <header className="border-b border-ui-border px-4 pb-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <button
            onClick={() => navigate('/campaigns')}
            className="-ml-1.5 rounded px-1.5 py-0.5 text-[12px] text-ui-faint transition-colors hover:text-ui-text"
          >
            ← Campaigns
          </button>
          <button
            onClick={() => void signOut()}
            title={session?.email ?? undefined}
            className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-ui-faint transition-colors hover:text-ui-text"
          >
            Sign out
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {!idea && campaign?.posterDataUrl && (
            <img
              src={campaign.posterDataUrl}
              alt=""
              className="h-[34px] w-[60px] shrink-0 rounded border border-ui-border bg-ui-well object-cover"
            />
          )}
          <div className="min-w-0">
            <h1 className="display truncate text-[17px] leading-tight text-ui-text">
              {idea ? (idea.result?.idea || 'Idea test') : (campaign?.title ?? 'No campaign open')}
            </h1>
            <p className="mt-0.5 truncate text-[12px] text-ui-muted">
              {profile?.name || 'Untitled organisation'}
            </p>
          </div>
        </div>
      </header>

      {selectedMemberId === null ? (
        <nav className="flex shrink-0 border-b border-ui-border px-2" aria-label="Panels">
          {TABS.map((entry) => {
            const active = tab === entry.id
            return (
              <button
                key={entry.id}
                onClick={() => setTab(entry.id)}
                aria-current={active ? 'page' : undefined}
                className={
                  'relative px-3 py-2.5 text-[13px] font-medium transition-colors ' +
                  (active ? 'text-ui-text' : 'text-ui-faint hover:text-ui-muted')
                }
              >
                {entry.label}
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ui-accent" />
                )}
              </button>
            )
          })}
        </nav>
      ) : (
        <nav className="flex shrink-0 border-b border-ui-border px-2" aria-label="Member report">
          <button
            onClick={() => selectMember(null)}
            className="px-3 py-2.5 text-[13px] font-medium text-ui-muted transition-colors hover:text-ui-text"
          >
            ← Everyone
          </button>
          <button
            onClick={() => {
              setChatMember(selectedMember && subject ? { subjectKey, name: selectedMember.name } : null)
              selectMember(null)
              setTab('chat')
            }}
            className="px-3 py-2.5 text-[13px] font-medium text-ui-muted transition-colors hover:text-ui-text"
          >
            Ask assistant
          </button>
        </nav>
      )}

      {/* The fade is positioned against this wrapper, not the scroller: an
          absolute child of the scroller would scroll away with the content. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {selectedMemberId === null && tab === 'chat' ? (
          <ChatPanel memberName={chatMember?.subjectKey === subjectKey ? chatMember?.name : undefined} />
        ) : (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            {selectedMemberId !== null ? (
              <MemberPanel memberId={selectedMemberId} />
            ) : (
              <>
                {idea && <IdeaPanel />}
                {!idea && tab === 'overview' && (
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
                {!idea && tab === 'report' && <ReportPanel />}
                {!idea && tab === 'compare' && <ComparePanel />}
              </>
            )}
          </div>
        )}
        {/*
          Shorter and weaker than it was on the dark panel. The fade is only
          meant to say "this scrolls"; at 4rem and full strength against white
          it smeared the last heading badly enough to look like a rendering
          fault rather than a hint.
        */}
        {(selectedMemberId !== null || tab !== 'chat') && (
          <GradualBlur
            position="bottom"
            target="parent"
            height="2.25rem"
            strength={0.45}
            tint="var(--color-ui-panel)"
            zIndex={10}
          />
        )}
      </div>

      <AssumptionsStrip run={idea ? undefined : run} />
    </aside>
  )
}
