import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { allocateGroups, buildMillbrookAudience, fetchMillbrookWorld, validateMillbrookWorld } from '../src/data/millbrook.ts'
import { sameRunAudience } from '../src/data/runCompatibility.ts'
import { runCascade, scoreAudience } from '../src/data/mock/scriptedCascade.ts'
import { residentAppearance, RESIDENT_IDS } from '../src/island/residentAppearance.ts'
import { MockDataSource } from '../src/data/mock/MockDataSource.ts'

const source = JSON.parse(readFileSync(new URL('../public/millbrook-50/data/personas.json', import.meta.url), 'utf8'))
const group = (id, share) => ({ id, share, label: id, color: '#779988', blurb: '', interests: ['community', 'gardening'] })
const profile = {
  id: 'test-profile', name: 'Test garden', pitch: 'Grow together', objective: 'engagement', tone: [],
  inspirationAccounts: [], audienceVersion: 1,
  groups: [group('students', .22), group('families', .20), group('retirees', .16), group('foodies', .16), group('sustainability', .14), group('community', .12)],
}
const optionsFor = (audience) => ({ seed: 1337, audienceVersion: audience.version, audienceKey: audience.key, seedExposure: .1, maxRounds: 6 })

test('supplied snapshot has 50 complete residents with valid households and links', () => {
  validateMillbrookWorld(source)
  const audience = buildMillbrookAudience(source, profile)
  assert.equal(audience.members.length, 50)
  assert.equal(source.households.length, 19)
  assert.equal(new Set(audience.members.map((member) => member.millbrook.persona.id)).size, 50)
  audience.members.forEach((member, index) => {
    assert.equal(member.id, index)
    assert.ok(member.onIsland)
    assert.equal(member.name, member.millbrook.persona.name)
    assert.equal(member.persona, member.millbrook.persona.backstory)
    assert.ok(member.millbrook.household.memberIds.includes(member.millbrook.persona.id))
    assert.deepEqual(member.interests, profile.groups.find((group) => group.id === member.groupId).interests)
    assert.ok(RESIDENT_IDS.includes(residentAppearance(member, 'any-context')))
    assert.equal(residentAppearance(member, 'old-context'), residentAppearance(member, 'new-context'))
  })
  assert.ok(audience.members.some((member) => member.millbrook.persona.age === 0))
})

test('validation rejects malformed fields and inconsistent identities, memberships and relationships', () => {
  const invalid = [
    (world) => { world.schemaVersion = 2 },
    (world) => { world.personas.pop() },
    (world) => { world.personas[1].id = world.personas[0].id },
    (world) => { world.personas[0].personality.extraversion = 2 },
    (world) => { world.personas[0].age = -1 },
    (world) => { world.personas[0].money = NaN },
    (world) => { world.personas[0].beliefs = 'bad' },
    (world) => { world.personas[0].memories = [{ id: 'm', tick: 0, text: 'memory', importance: 2, tags: [] }] },
    (world) => { world.households[0].memberIds.push(world.households[0].memberIds[0]) },
    (world) => { world.households[0].memberIds.pop() },
    (world) => { world.personas[0].family.agent_02 = 'sibling' },
    (world) => { world.personas[0].family.agent_99 = 'parent' },
    (world) => { world.personas[0].friends.agent_99 = .5 },
    (world) => { world.personas[0].friends.agent_01 = .5 },
    (world) => { world.personas[0].friends.agent_05 = -2 },
  ]
  for (const mutate of invalid) {
    const world = structuredClone(source)
    mutate(world)
    assert.throws(() => validateMillbrookWorld(world), /Invalid Millbrook persona data/)
  }
})

test('loader fetches only JSON and surfaces HTTP, JSON and schema failures', async () => {
  const requests = []
  const world = await fetchMillbrookWorld(async (url) => {
    requests.push(url)
    return new Response(JSON.stringify(source))
  })
  assert.deepEqual(requests, ['/millbrook-50/data/personas.json'])
  assert.deepEqual(world, source)
  await assert.rejects(fetchMillbrookWorld(async () => new Response('', { status: 404 })), /HTTP 404/)
  await assert.rejects(fetchMillbrookWorld(async () => new Response('not json')), SyntaxError)
  await assert.rejects(fetchMillbrookWorld(async () => new Response('{}')), /Invalid Millbrook/)
  await assert.rejects(fetchMillbrookWorld(async () => { throw new Error('Offline') }), /Offline/)
})

test('largest remainders allocate exactly 50, including uneven, zero and tiny shares', () => {
  assert.deepEqual(allocateGroups(profile.groups), [11, 10, 8, 8, 7, 6])
  assert.deepEqual(allocateGroups([group('a', 1), group('b', 1), group('c', 1)]), [17, 17, 16])
  assert.deepEqual(allocateGroups([group('b', 1), group('a', 1), group('c', 1)]), [17, 17, 16])
  assert.deepEqual(allocateGroups([group('zero', 0), group('tiny', .00001), group('rest', 2)]), [0, 0, 50])
  assert.deepEqual(allocateGroups([group('only', 7)]), [50])
  assert.equal(allocateGroups(Array.from({ length: 70 }, (_, index) => group(`g${index}`, 1))).reduce((a, b) => a + b), 50)
  for (const groups of [[], [group('a', 0)], [group('a', -1)], [group('a', Infinity)], [group('a', 1), group('a', 1)]]) {
    assert.throws(() => allocateGroups(groups), /Millbrook audience/)
  }
})

test('identities, avatars and groups are stable after reload, source reordering and profile edits', () => {
  const before = JSON.stringify(source)
  const first = buildMillbrookAudience(source, profile)
  assert.deepEqual(first, buildMillbrookAudience(structuredClone(source), structuredClone(profile)))
  const reordered = { ...source, personas: [...source.personas].reverse() }
  const changed = buildMillbrookAudience(reordered, { ...profile, audienceVersion: 2, groups: [group('all', 1)] })
  assert.deepEqual(first.members.map((member) => [member.id, member.name, member.model]), changed.members.map((member) => [member.id, member.name, member.model]))
  assert.equal(JSON.stringify(source), before)
  assert.notEqual(first.key, changed.key)
  assert.equal(first.key, buildMillbrookAudience(source, { ...profile, groups: [...profile.groups].reverse() }).key)
  assert.notEqual(first.key, buildMillbrookAudience(source, { ...profile, groups: profile.groups.map((group) => ({ ...group, interests: ['different'] })) }).key)
  const newWorld = structuredClone(source)
  newWorld.personas[0].mood = 'happy'
  assert.notEqual(first.key, buildMillbrookAudience(newWorld, profile).key)
})

test('sharing graph is exactly the deduplicated family/friend union with reciprocal adjacency', () => {
  const audience = buildMillbrookAudience(source, profile)
  const numeric = new Map(audience.members.map((member) => [member.millbrook.persona.id, member.id]))
  const expected = new Set()
  for (const persona of source.personas) {
    for (const target of [...Object.keys(persona.family), ...Object.keys(persona.friends)]) {
      const a = numeric.get(persona.id), b = numeric.get(target)
      expected.add(`${Math.min(a, b)}:${Math.max(a, b)}`)
    }
  }
  assert.deepEqual(new Set(audience.edges.map(({ a, b }) => `${a}:${b}`)), expected)
  assert.equal(audience.edges.length, expected.size)
  for (const { a, b } of audience.edges) {
    assert.ok(a < b && a >= 0 && b < 50)
    assert.ok(audience.adjacency[a].includes(b))
    assert.ok(audience.adjacency[b].includes(a))
  }
  assert.equal(audience.adjacency.flat().length, expected.size * 2)
})

test('50-resident cascade is deterministic, follows supplied edges and leaves persona state untouched', () => {
  const audience = buildMillbrookAudience(source, profile)
  const before = JSON.stringify(audience)
  const decisions = audience.members.map((member) => ({ memberId: member.id, pWatch: 1, pLike: 1, pComment: 1, pShare: 1, explanation: 'Forced for graph traversal test.' }))
  const options = optionsFor(audience)
  const result = runCascade(audience, decisions, options)
  assert.deepEqual(result, runCascade(audience, decisions, options))
  assert.equal(result.rounds[0].exposed.length, 5)
  assert.ok(result.metrics.uniqueExposed > 5 && result.metrics.uniqueExposed <= 50)
  const exposed = result.rounds.flatMap((round) => round.exposed)
  assert.equal(new Set(exposed).size, exposed.length)
  for (const round of result.rounds) for (const share of round.shares) {
    for (const to of share.to) assert.ok(audience.adjacency[share.from].includes(to))
  }
  assert.equal(JSON.stringify(audience), before)
  const content = { hookStrength: .8, clarityOfAsk: .9, pacing: .7, warmth: .6, topics: ['community'], durationSec: 20 }
  const scored = scoreAudience(audience, content, options.seed, 0)
  const displayOnlyChange = structuredClone(audience)
  displayOnlyChange.members[0].millbrook.persona.personality.extraversion = 1
  displayOnlyChange.members[0].millbrook.persona.values = ['other']
  assert.deepEqual(scored, scoreAudience(displayOnlyChange, content, options.seed, 0))
})

test('comparison requires dataset identity and matching settings, including after persistence', () => {
  const options = optionsFor(buildMillbrookAudience(source, profile))
  assert.ok(sameRunAudience(options, JSON.parse(JSON.stringify(options))))
  for (const change of [{ audienceKey: undefined }, { audienceKey: 'another-dataset' }, { audienceVersion: 2 }, { seed: 9 }, { seedExposure: .3 }, { maxRounds: 3 }]) {
    assert.equal(sameRunAudience(options, { ...options, ...change }), false)
  }
  const legacy = { ...options, audienceKey: undefined }
  assert.equal(sameRunAudience(legacy, legacy), false)
})

test('data source shares reads, retries failures and keeps reports tied to their original audience and video', async (t) => {
  let reads = 0
  t.mock.method(globalThis, 'fetch', async () => {
    reads++
    return new Response(reads === 1 ? '' : JSON.stringify(source), { status: reads === 1 ? 503 : 200 })
  })
  const driver = new MockDataSource()
  await assert.rejects(driver.loadAudience(profile), /HTTP 503/)
  const [audience, repeated] = await Promise.all([driver.loadAudience(profile), driver.loadAudience(profile)])
  assert.strictEqual(audience, repeated)
  assert.equal(reads, 2)
  assert.strictEqual(audience, await driver.loadAudience(profile))
  const video = await driver.analyseVideo('campaign', { name: 'Community garden.mp4', durationSec: 20 }, 'Original')
  const options = optionsFor(audience)
  await assert.rejects(driver.startRun('campaign', video.id, 'Wrong audience', { ...options, audienceKey: 'other' }), /audience changed/)
  const run = await driver.startRun('campaign', video.id, 'Original', options)
  const report = await driver.getReport(run)
  const reply = await driver.chat(run, [], 'What happened?')
  assert.equal((await driver.getDecisions(run)).length, 50)
  await driver.loadAudience({ ...profile, audienceVersion: 2, groups: [group('replacement', 1)] })
  await driver.reviseSignals(video.id, { ...video.signals, hookStrength: 0, clarityOfAsk: 0, topics: ['other'] })
  assert.deepEqual(await driver.getReport(run), report)
  assert.equal(await driver.chat(run, [], 'What happened?'), reply)
})
