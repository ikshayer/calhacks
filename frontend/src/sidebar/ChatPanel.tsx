import { useRef, useState } from 'react'
import { useAppStore, selectActiveRun } from '@/store/useAppStore'
import type { ChatTurn } from '@/data/types'
import { Button, EmptyState, Input, Section } from '@/components/ui'

const SUGGESTIONS = [
  'Why would students share this?',
  'What is holding back the share count?',
  'Which group responded worst, and why?',
]

/**
 * Follow-up questions about the run.
 *
 * Grounded in this run only: the profile, the analysed video and the outcome.
 * It will not answer about anything it cannot see, which is the difference
 * between a useful assistant and a chatbot bolted onto a dashboard.
 */
export function ChatPanel() {
  const run = useAppStore(selectActiveRun)
  const source = useAppStore((state) => state.source)
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const ask = async (question: string) => {
    const message = question.trim()
    if (!message || !run || busy) return

    setDraft('')
    setError(null)
    setBusy(true)
    const asked: ChatTurn[] = [...history, { role: 'user', content: message }]
    setHistory(asked)

    try {
      const reply = await source.chat(run.id, history, message)
      setHistory([...asked, { role: 'assistant', content: reply }])
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : 'That question could not be answered. Try again.',
      )
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      })
    }
  }

  if (!run) {
    return (
      <Section title="Ask about this run">
        <EmptyState title="Nothing to ask about yet">
          Run a simulation first — answers are grounded in a specific run, not general advice.
        </EmptyState>
      </Section>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div ref={scrollRef} className="scroll-slim flex-1 space-y-3 px-4 py-4">
        {history.length === 0 && (
          <div>
            <p className="text-[12.5px] leading-relaxed text-ui-muted">
              Ask about the result and the answer is drawn from this run: the audience you
              confirmed, the video as analysed, and what happened in the cascade.
            </p>
            <div className="mt-3 space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void ask(suggestion)}
                  className="block w-full rounded-md border border-ui-border bg-ui-well px-3 py-2 text-left text-[12.5px] text-ui-muted transition-colors hover:border-ui-edge hover:text-ui-text"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === 'user'
                ? 'ml-6 rounded-lg rounded-br-sm bg-ui-raised px-3 py-2'
                : 'mr-2 rounded-lg rounded-bl-sm border border-ui-border bg-ui-well px-3 py-2.5'
            }
          >
            <p className="text-[12.5px] leading-relaxed text-ui-text">{turn.content}</p>
          </div>
        ))}

        {busy && <p className="text-[12px] text-ui-faint">Looking at the run…</p>}
        {error && (
          <p role="alert" className="text-[12.5px] text-ui-danger">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
        className="flex shrink-0 items-center gap-2 border-t border-ui-border px-4 py-3"
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this run"
          aria-label="Ask about this run"
        />
        <Button type="submit" disabled={!draft.trim() || busy}>
          Ask
        </Button>
      </form>
    </div>
  )
}
