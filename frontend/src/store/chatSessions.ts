import type { SimDataSource } from '../data/SimDataSource.ts'
import type { ChatTarget, ChatTurn } from '../data/types.ts'

export const MAX_CHAT_LENGTH = 2000

interface ChatState {
  history: ChatTurn[]
  draft: string
  busy: boolean
  error: string | null
}

/** One conversation owns its pending request, even while another run is visible. */
export class ChatSession {
  private state: ChatState = { history: [], draft: '', busy: false, error: null }
  private listeners = new Set<() => void>()

  getSnapshot = (): ChatState => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  setDraft = (draft: string) => this.update({ draft })

  async ask(source: Pick<SimDataSource, 'chat' | 'chatIdea'>, target: ChatTarget, question: string): Promise<void> {
    const message = question.trim()
    if (!message || this.state.busy) return
    if (message.length > MAX_CHAT_LENGTH) {
      this.update({ error: `Keep your question to ${MAX_CHAT_LENGTH} characters or fewer.` })
      return
    }
    const history = this.state.history
    const asked: ChatTurn[] = [...history, { role: 'user', content: message }]
    this.update({ history: asked, draft: '', busy: true, error: null })
    try {
      const reply = target.kind === 'idea'
        ? await source.chatIdea(target.id, history, message)
        : await source.chat(target.id, history, message)
      this.update({ history: [...asked, { role: 'assistant', content: reply }] })
    } catch (cause: unknown) {
      this.update({ error: cause instanceof Error ? cause.message : 'The assistant could not answer. Try again.', draft: message })
    } finally {
      this.update({ busy: false })
    }
  }
}

const sources = new WeakMap<SimDataSource, Map<string, ChatSession>>()

/** Memory only; never stores conversations or API credentials in localStorage. */
export function getChatSession(source: SimDataSource, userId: string, profileId: string, target: ChatTarget): ChatSession {
  let sessions = sources.get(source)
  if (!sessions) {
    sessions = new Map()
    sources.set(source, sessions)
  }
  const key = JSON.stringify([userId, profileId, target.kind, target.id])
  let session = sessions.get(key)
  if (!session) {
    session = new ChatSession()
    sessions.set(key, session)
  }
  return session
}
