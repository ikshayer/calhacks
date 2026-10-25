import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore, selectActiveCampaign, selectActiveRun } from '@/store/useAppStore'
import { useAuth } from '@/auth/AuthProvider'
import { chatSubject, chatTargetKey } from '@/data/chatSubject'
import { Button } from '@/components/ui/button'
import { SignalsPanel } from './SignalsPanel'
import { MemberPanel } from './MemberPanel'
import { IdeaPanel } from './IdeaPanel'
import { RunPanel } from './RunPanel'
import { MetricsPanel } from './MetricsPanel'
import { GroupsPanel } from './GroupsPanel'
import { MiniGraph } from './MiniGraph'
import { ChatPanel } from './ChatPanel'
import { AssumptionsStrip } from './AssumptionsStrip'
import { ViewOptions } from './ViewOptions'

type TabId = 'overview' | 'chat'
const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'chat', label: 'Assistant' }] as const

/** Two persistent destinations: visual results and the full report conversation. */
export function Sidebar({ shadows, onShadowsChange, playing }: {
  shadows: boolean; onShadowsChange(value: boolean): void; playing: boolean
}) {
  const [activeTab, setTab] = useState<TabId>('overview')
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
  const source = useAppStore((state) => state.source)
  const navigate = useNavigate()
  const { session, signOut } = useAuth()
  // Clicking a resident on the island always opens their Overview card.
  const tab = selectedMemberId === null ? activeTab : 'overview'
  const openAssistant = () => {
    if (selectedMember && subject) setChatMember({ subjectKey, name: selectedMember.name })
    selectMember(null)
    setTab('chat')
  }

  return (
    <aside className={'paper flex w-full min-w-0 shrink-0 flex-col border-ui-border bg-ui-panel lg:w-[384px] lg:border-l ' + (tab === 'chat' ? 'h-[85dvh] lg:h-auto' : '')}>
      <header className="border-b border-ui-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" className="-ml-2 text-[11px]" onClick={() => navigate('/campaigns')}>← Campaigns</Button>
          <Button variant="ghost" size="sm" className="text-[11px]" onClick={() => void signOut()} title={session?.email ?? undefined}>Sign out</Button>
        </div>
        <div className="mt-1 flex items-center gap-3">
          {!idea && campaign?.posterDataUrl && <img src={campaign.posterDataUrl} alt="" className="h-[28px] w-[50px] shrink-0 rounded border border-ui-border object-cover" />}
          <div className="min-w-0">
            <h1 className="display truncate text-[16px] text-ui-text" title={idea ? (idea.result?.idea || 'Idea test') : campaign?.title}>
              {idea ? (idea.result?.idea || 'Idea test') : (campaign?.title ?? 'Simulation')}
            </h1>
            <p className="truncate text-[11px] text-ui-faint">{profile?.name || 'Untitled organisation'}</p>
          </div>
        </div>
      </header>
      <nav role="tablist" aria-label="Simulation panels" className="flex shrink-0 border-b border-ui-border px-2"
        onKeyDown={(event) => {
          let next: TabId
          if (event.key === 'Home') next = 'overview'
          else if (event.key === 'End') next = 'chat'
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tab === 'overview' ? 'chat' : 'overview'
          else return
          event.preventDefault()
          if (next === 'chat') openAssistant()
          else setTab('overview')
          document.getElementById(`tab-${next}`)?.focus()
        }}>
        {TABS.map((entry) => <Button key={entry.id} role="tab" variant="ghost" aria-selected={tab === entry.id}
          id={`tab-${entry.id}`} tabIndex={tab === entry.id ? 0 : -1} aria-controls={`panel-${entry.id}`} onClick={entry.id === 'chat' ? openAssistant : () => setTab('overview')}
          className={'h-10 flex-1 rounded-none border-b-2 text-[13px] ' + (tab === entry.id ? 'border-ui-accent text-ui-text' : 'border-transparent text-ui-faint')}>
          {entry.label}
        </Button>)}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" tabIndex={0} id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'chat' ? <ChatPanel memberName={chatMember?.subjectKey === subjectKey ? chatMember.name : undefined} /> : (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            {selectedMemberId !== null ? <MemberPanel memberId={selectedMemberId} onAsk={openAssistant} onBack={() => { setTab('overview'); selectMember(null) }} />
              : idea ? <IdeaPanel onAsk={openAssistant} /> : <>
                {run?.status === 'complete' && <MetricsPanel />}
                <RunPanel />
                <SignalsPanel />
                {run && run.status !== 'complete' && <MetricsPanel />}
                <GroupsPanel />
                <MiniGraph />
                <div className="flex justify-end px-4 py-2"><Button variant="outline" size="sm" onClick={openAssistant}>Ask assistant</Button></div>
              </>}
            <ViewOptions shadows={shadows} onShadowsChange={onShadowsChange} sourceLabel={source.label} playing={playing} />
          </div>
        )}
      </div>
      <AssumptionsStrip run={idea ? undefined : run} />
    </aside>
  )
}
