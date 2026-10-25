import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Run the real driver in Node without Vite, a websocket, or credentials. The
// hook mirrors tsconfig's local @ alias and extensionless TypeScript imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = specifier.startsWith('@/')
      ? new URL(`../src/${specifier.slice(2)}`, import.meta.url)
      : (specifier.startsWith('.') && context.parentURL ? new URL(specifier, context.parentURL) : undefined)
    if (local) {
      for (const candidate of [`${local.href}.ts`, `${local.href}/index.ts`]) {
        if (existsSync(new URL(candidate))) return { url: candidate, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})

const { SpacetimeDataSource } = await import('../src/data/spacetime/SpacetimeDataSource.ts')
const { DbConnection } = await import('../src/module_bindings/index.ts')

function mockBuilder(t, synchronousError) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  })
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  const attempts = []
  t.mock.method(DbConnection, 'builder', () => {
    const attempt = { disconnects: 0, queries: [] }
    const subscription = {
      onApplied(callback) { attempt.onApplied = callback; return this },
      onError(callback) { attempt.onSubscriptionError = callback; return this },
      subscribe(queries) { attempt.queries = queries; return {} },
    }
    attempt.conn = {
      db: new Proxy({}, { get: () => ({ onInsert() {}, onUpdate() {} }) }),
      subscriptionBuilder: () => subscription,
      disconnect: () => { attempt.disconnects++ },
    }
    attempts.push(attempt)
    return {
      withUri() { return this },
      withDatabaseName() { return this },
      withToken() { return this },
      withAutomaticReconnect() { return this },
      onConnect(callback) { attempt.onConnect = callback; return this },
      onConnectError(callback) { attempt.onConnectError = callback; return this },
      build() {
        if (synchronousError) attempt.onConnectError({}, synchronousError)
        return attempt.conn
      },
    }
  })
  return attempts
}

function connected(attempt) {
  attempt.onConnect(attempt.conn, { toHexString: () => 'test-identity' }, 'test-token')
}

test('missing schema errors preserve server details, close the socket and allow a fresh retry', async (t) => {
  const attempts = mockBuilder(t)
  const source = new SpacetimeDataSource('ws://test.invalid', 'test-db')
  const first = source.connect()
  connected(attempts[0])
  assert.ok(attempts[0].queries.includes('SELECT * FROM idea_chat_message'), 'required evidence tables must not be silently dropped')
  const reason = new Error('no such table: idea_chat_message')
  attempts[0].onSubscriptionError({ event: reason })
  await assert.rejects(first, (error) => {
    assert.equal(error.cause, reason)
    assert.match(error.message, /test-db: no such table: idea_chat_message/)
    assert.match(error.message, /Publish the updated SpacetimeDB module/)
    return true
  })
  assert.equal(attempts[0].disconnects, 1)
  const retry = source.connect()
  assert.notEqual(retry, first)
  assert.equal(source.connect(), retry, 'concurrent callers share the new attempt')
  assert.equal(attempts.length, 2)

  // Delayed callbacks from the dead socket must neither invalidate the retry
  // nor satisfy it with stale data.
  attempts[0].onConnectError({}, new Error('late old socket failure'))
  attempts[0].onApplied()
  assert.equal(source.connect(), retry)
  connected(attempts[1])
  attempts[1].onApplied()
  assert.equal(await retry, attempts[1].conn)
})

test('non-schema subscription errors retain their actual cause without unrelated publish advice', async (t) => {
  const attempts = mockBuilder(t)
  const source = new SpacetimeDataSource('ws://test.invalid', 'private-db')
  const pending = source.connect()
  connected(attempts[0])
  attempts[0].onSubscriptionError({ event: new Error('permission denied for table report') })
  await assert.rejects(pending, (error) => {
    assert.match(error.message, /permission denied for table report/)
    assert.doesNotMatch(error.message, /Publish/)
    return true
  })
  assert.equal(attempts[0].disconnects, 1)
})

test('synchronous connection failures cannot cache a rejected promise or leak their handle', async (t) => {
  const attempts = mockBuilder(t, new Error('Connection refused'))
  const source = new SpacetimeDataSource('ws://test.invalid', 'test-db')
  const first = source.connect()
  await assert.rejects(first, /Connection refused/)
  assert.equal(attempts[0].disconnects, 1)
  const second = source.connect()
  assert.notEqual(second, first)
  await assert.rejects(second, /Connection refused/)
  assert.equal(attempts[1].disconnects, 1)
})

test('a thrown builder error is rejected with context and can be retried', async (t) => {
  let calls = 0
  t.mock.method(DbConnection, 'builder', () => { calls++; throw new Error('Invalid websocket URI') })
  const source = new SpacetimeDataSource('bad-uri', 'test-db')
  await assert.rejects(source.connect(), /Could not initialize SpacetimeDB at bad-uri: Invalid websocket URI/)
  await assert.rejects(source.connect(), /Invalid websocket URI/)
  assert.equal(calls, 2)
})

test('a subscription failing after initial success is discarded without invalidating its replacement', async (t) => {
  const attempts = mockBuilder(t)
  const source = new SpacetimeDataSource('ws://test.invalid', 'test-db')
  const first = source.connect()
  connected(attempts[0])
  attempts[0].onApplied()
  assert.equal(await first, attempts[0].conn)
  attempts[0].onSubscriptionError({ event: new Error('unknown table idea_chat_message') })
  assert.equal(attempts[0].disconnects, 1)
  const retry = source.connect()
  assert.notEqual(retry, first)
  connected(attempts[1])
  attempts[1].onApplied()
  assert.equal(await retry, attempts[1].conn)
  attempts[0].onSubscriptionError({ event: new Error('late subscription error') })
  attempts[0].onConnectError({}, new Error('late websocket error'))
  assert.equal(source.connect(), retry)
  assert.equal(attempts[1].disconnects, 0)
})
