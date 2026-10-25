import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatSession, getChatSession } from '../src/store/chatSessions.ts'
import { chatSubject, chatTargetKey } from '../src/data/chatSubject.ts'

test('chat survives remounts and is isolated by source, signed-in user, profile and run', () => {
  const source = {}
  const session = getChatSession(source, 'user', 'profile', { kind: 'run', id: 'run' })
  session.setDraft('A question in progress')
  assert.equal(getChatSession(source, 'user', 'profile', { kind: 'run', id: 'run' }), session)
  assert.equal(getChatSession(source, 'user', 'profile', { kind: 'run', id: 'run' }).getSnapshot().draft, 'A question in progress')
  for (const other of [
    getChatSession({}, 'user', 'profile', { kind: 'run', id: 'run' }),
    getChatSession(source, 'other', 'profile', { kind: 'run', id: 'run' }),
    getChatSession(source, 'user', 'other', { kind: 'run', id: 'run' }),
    getChatSession(source, 'user', 'profile', { kind: 'run', id: 'other' }),
  ]) assert.deepEqual(other.getSnapshot(), { history: [], draft: '', busy: false, error: null })
})

test('pending replies cannot overwrite another run and duplicate sends are blocked', async () => {
  let finish
  let calls = 0
  const source = { chat: async () => { calls++; return new Promise((resolve) => { finish = resolve }) } }
  const first = getChatSession(source, 'user', 'profile', { kind: 'run', id: 'first' })
  const second = getChatSession(source, 'user', 'profile', { kind: 'run', id: 'second' })
  const request = first.ask(source, { kind: 'run', id: 'first' }, 'Why?')
  assert.equal(first.getSnapshot().busy, true)
  await first.ask(source, { kind: 'run', id: 'first' }, 'Duplicate')
  assert.equal(calls, 1)
  second.setDraft('Another run')
  finish('Because of the recorded result.')
  await request
  assert.deepEqual(first.getSnapshot().history, [
    { role: 'user', content: 'Why?' }, { role: 'assistant', content: 'Because of the recorded result.' },
  ])
  assert.equal(first.getSnapshot().busy, false)
  assert.deepEqual(second.getSnapshot().history, [])
  assert.equal(second.getSnapshot().draft, 'Another run')
})

test('errors preserve the question for retry and length validation avoids a backend call', async () => {
  const session = new ChatSession()
  let calls = 0
  const source = { chat: async () => { calls++; throw new Error('Worker unavailable') } }
  await session.ask(source, { kind: 'run', id: 'run' }, '  Explain the report  ')
  assert.equal(session.getSnapshot().draft, 'Explain the report')
  assert.equal(session.getSnapshot().error, 'Worker unavailable')
  assert.equal(session.getSnapshot().busy, false)
  await session.ask(source, { kind: 'run', id: 'run' }, 'x'.repeat(2001))
  await session.ask(source, { kind: 'run', id: 'run' }, ' ')
  assert.equal(calls, 1)
  assert.match(session.getSnapshot().error, /2000/)
})

test('follow-ups send only the completed conversation before the new question', async () => {
  const session = new ChatSession()
  const calls = []
  const source = { chat: async (...args) => { calls.push(args); return 'Reply' } }
  await session.ask(source, { kind: 'run', id: 'run' }, 'Question one')
  await session.ask(source, { kind: 'run', id: 'run' }, 'Question two')
  assert.deepEqual(calls[1], ['run', [
    { role: 'user', content: 'Question one' }, { role: 'assistant', content: 'Reply' },
  ], 'Question two'])
})

test('idea reports need no video and take precedence over a stale completed video run', () => {
  const idea = { status: 'ready', input: { prompt: 'Open a garden café', options: [] }, result: { id: '1', status: 'ready', idea: 'Garden café' } }
  const run = { id: '1', label: 'Old video', status: 'complete' }
  assert.deepEqual(chatSubject(idea, undefined), { kind: 'idea', id: '1', label: 'Garden café', ready: true, failed: false })
  assert.equal(chatTargetKey(chatSubject(idea, run)), 'idea:1')
  assert.equal(chatTargetKey(chatSubject(null, run)), 'run:1')
  assert.equal(chatSubject({ ...idea, status: 'running', result: undefined }, run).ready, false)
  assert.equal(chatSubject(null, undefined), undefined)
})

test('same numeric idea and run IDs have separate histories and route to separate APIs', async () => {
  const calls = []
  const source = {
    chat: async (...args) => { calls.push(['video', ...args]); return 'Video reply' },
    chatIdea: async (...args) => { calls.push(['idea', ...args]); return 'Idea report reply' },
  }
  const runTarget = { kind: 'run', id: '1' }
  const ideaTarget = { kind: 'idea', id: '1' }
  const run = getChatSession(source, 'user', 'profile', runTarget)
  const idea = getChatSession(source, 'user', 'profile', ideaTarget)
  assert.notEqual(run, idea)
  await idea.ask(source, ideaTarget, 'What does the report recommend?')
  assert.equal(calls[0][0], 'idea')
  assert.deepEqual(run.getSnapshot().history, [])
  await run.ask(source, runTarget, 'What happened in the video?')
  assert.equal(calls[1][0], 'video')
  assert.equal(idea.getSnapshot().history.at(-1).content, 'Idea report reply')
  assert.equal(run.getSnapshot().history.at(-1).content, 'Video reply')
})
