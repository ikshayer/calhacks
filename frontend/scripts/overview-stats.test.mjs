import assert from 'node:assert/strict'
import test from 'node:test'
import { ideaResponse, nonnegative, probability, recommendedOption, visibleGroupResults, visibleRunResults } from '../src/data/overviewStats.ts'

test('idea chart uses shared verdict thresholds and excludes missing or invalid predictions', () => {
  const residents = [
    { pVisit: .5, missing: false }, { pVisit: .3, missing: false }, { pVisit: .2999, missing: false },
    { pVisit: .9, missing: true }, { pVisit: NaN, missing: false }, { pVisit: Infinity, missing: false },
  ]
  assert.deepEqual(ideaResponse(residents), { counts: { going: 1, maybe: 1, not: 1 }, scored: 3, missing: 3, total: 6 })
  assert.deepEqual(ideaResponse([]), { counts: { going: 0, maybe: 0, not: 0 }, scored: 0, missing: 0, total: 0 })
})

const metrics = { uniqueExposed: 12, watch: 8, likes: 5, comments: 2, shares: 3, byGroup: [
  { groupId: 'old-group', exposed: 12, watch: 8, likes: 5, comments: 2, shares: 3 },
] }

test('historical completed runs retain final totals and group results without a replay or current audience', () => {
  const run = { status: 'complete', rounds: [], metrics }
  assert.deepEqual(visibleRunResults(run, 0), { final: true, exposed: 12, watch: 8, likes: 5, comments: 2, shares: 3 })
  assert.deepEqual(visibleGroupResults(run, 0, new Map()), [{ groupId: 'old-group', exposed: 12, actions: 18 }])
})

test('playback counts independent actions and uses saved final metrics only when finished', () => {
  const rounds = [
    { round: 0, exposed: [1], acted: [{ memberId: 1, kinds: ['watch', 'like', 'share'] }], shares: [], ignored: [] },
    { round: 1, exposed: [2], acted: [{ memberId: 2, kinds: ['watch'] }], shares: [], ignored: [] },
  ]
  const run = { status: 'complete', rounds, metrics }
  assert.deepEqual(visibleRunResults(run, 0), { final: false, exposed: 0, watch: 0, likes: 0, comments: 0, shares: 0 })
  assert.deepEqual(visibleRunResults(run, 1), { final: false, exposed: 1, watch: 1, likes: 1, comments: 0, shares: 1 })
  assert.deepEqual(visibleGroupResults(run, 1, new Map([[1, 'group'], [2, 'group']])), [{ groupId: 'group', exposed: 1, actions: 3 }])
  assert.equal(visibleRunResults(run, 2).exposed, 12)
})

test('unknown numeric values remain unavailable while valid zero values are preserved', () => {
  for (const invalid of [undefined, NaN, Infinity, -1]) assert.equal(nonnegative(invalid), undefined)
  for (const invalid of [undefined, NaN, Infinity, -1, 1.1]) assert.equal(probability(invalid), undefined)
  assert.equal(nonnegative(0), 0)
  assert.equal(probability(0), 0)
  assert.equal(probability(1), 1)
})

test('recommendation labels require a unique actual option, rather than shortened analyst prose', () => {
  const options = [{ name: 'Campus flyers', costUsd: 0 }, { name: 'Market stall', costUsd: 25 }]
  assert.equal(recommendedOption(options, 'Campus flyers.'), 'Campus flyers')
  assert.equal(recommendedOption(options, 'Try campus flyers because the target residents spend time on campus.'), undefined)
  assert.equal(recommendedOption(options, undefined, 'market stall'), 'Market stall')
  assert.equal(recommendedOption([{ name: 'Flyers' }, { name: 'Flyers' }], 'Flyers'), undefined)
  assert.equal(recommendedOption([], 'Unknown campaign'), undefined)
})
