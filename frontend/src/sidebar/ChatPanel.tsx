import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import { getChatSession, MAX_CHAT_LENGTH } from '@/store/chatSessions'
import { chatSubject } from '@/data/chatSubject'
import { useAuth } from '@/auth/AuthProvider'
import { EmptyState, Section } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const SUGGESTIONS = [
  'Summarize the report and the simulation results.',
  'How do the residents’ personalities influence their reactions?',
  'What held back sharing, and what could I improve?',
  'How does the simulation work, and what are its limits?',
]

const IDEA_SUGGESTIONS = [
  'Summarize this idea report and its results.',
  'How do the residents’ personalities influence their interest?',
  'Which campaign option fits the budget, and why?',
  'What are the assumptions and limits of these predictions?',
]

export function ChatPanel({ memberName }: { memberName?: string }) {
  const run = useAppStore(selectActiveRun)
  const idea = useAppStore((state) => state.idea)
  const subject = chatSubject(idea, run)
  const source = useAppStore((state) => state.source)
  const profileId = useAppStore((state) => state.profile?.id ?? '')
  const { session: user } = useAuth()
  const session = getChatSession(source, user?.userId ?? '', profileId, subject ?? { kind: 'run', id: '' })
  const { history, draft, busy, error } = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const scrollRef = useRef<HTMLDivElement>(null)
  const ready = subject?.ready ?? false

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [history, busy, error, session])

  const ask = (question: string) => {
    if (ready && subject) void session.ask(source, subject, question)
  }

  if (!ready) {
    return (
      <Section title="AI assistant">
        <EmptyState title={!subject ? 'Start with a report' : subject.failed ? 'This simulation failed' : 'Simulation in progress'}>
          {!subject ? 'Test an idea or complete a video simulation to ask about its report, residents and results. An idea report needs no video.'
            : subject.failed ? 'Try the simulation again to give the assistant a complete result.'
              : `The assistant will be ready once the ${subject.kind === 'idea' ? 'idea report' : 'simulation'} finishes.`}
        </EmptyState>
      </Section>
    )
  }

  return (
    <section aria-label="AI assistant" className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-ui-border px-4 py-3">
        <h2 className="display text-[15px] text-ui-text">AI assistant</h2>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ui-muted" title={subject?.label}>
          {subject?.kind === 'idea' ? 'Idea report' : 'Video simulation'}: {subject?.label}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">
          Ask about the report, results, or residents and their personalities.
        </p>
        <p className="mt-1 text-[11px] text-ui-faint">
          {source.kind === 'mock' ? 'Demo replies · scripted, not live AI' : 'AI replies · grounded in this simulation'}
          {' · Synthetic results'}
        </p>
      </header>

      <div ref={scrollRef} role="log" aria-label="Conversation" aria-live="polite" aria-busy={busy}
        className="scroll-slim min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {memberName && (
          <Button variant="outline" type="button" disabled={busy} onClick={() => ask(`How do ${memberName}'s personality and preferences relate to their predicted ${subject?.kind === 'idea' ? 'interest in this idea' : 'reactions and actual actions in this run'}?`)}
            className="h-auto w-full justify-start whitespace-normal text-left text-[12px]">
            Ask about {memberName}
          </Button>
        )}
        {history.length === 0 && (
          <div className="space-y-2">
            <p className="text-[12.5px] leading-relaxed text-ui-muted">Explore the result or start with a question:</p>
            {(subject?.kind === 'idea' ? IDEA_SUGGESTIONS : SUGGESTIONS).map((suggestion) => (
              <Button variant="outline" key={suggestion} type="button" disabled={busy} onClick={() => ask(suggestion)}
                className="h-auto w-full justify-start whitespace-normal text-left text-[12.5px] font-normal">
                {suggestion}
              </Button>
            ))}
          </div>
        )}
        {history.map((turn, index) => (
          <div key={index} className={turn.role === 'user'
            ? 'ml-6 rounded-lg rounded-br-sm bg-ui-raised px-3 py-2'
            : 'mr-2 rounded-lg rounded-bl-sm border border-ui-border bg-ui-well px-3 py-2.5'}>
            <p className="mb-1 text-[10px] font-medium text-ui-faint">{turn.role === 'user' ? 'You' : 'Assistant'}</p>
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ui-text">{turn.content}</p>
          </div>
        ))}
        {busy && <p role="status" className="text-[12px] text-ui-faint">Reading the simulation…</p>}
        {error && <p role="alert" className="break-words text-[12.5px] text-ui-danger">{error}</p>}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); ask(draft) }}
        className="shrink-0 space-y-2 border-t border-ui-border bg-ui-panel px-4 py-3">
        <Textarea value={draft} onChange={(event) => session.setDraft(event.target.value)}
          rows={2} maxLength={MAX_CHAT_LENGTH} disabled={busy}
          placeholder="Ask about the report or a resident…" aria-label="Question for the AI assistant" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-ui-faint">{draft.length} / {MAX_CHAT_LENGTH}</span>
          <Button type="submit" disabled={!draft.trim() || draft.trim().length > MAX_CHAT_LENGTH || busy}>Send</Button>
        </div>
      </form>
    </section>
  )
}
