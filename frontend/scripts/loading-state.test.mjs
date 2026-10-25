import assert from 'node:assert/strict'
import test from 'node:test'
import { simulationResultsLoading } from '../src/data/loadingState.ts'

const complete = { status: 'complete', metrics: {}, report: {} }
const check = (patch) => simulationResultsLoading({ run: complete, idea: null, preparing: false, ...patch })

test('a finished single-video result can be revealed', () => {
  assert.equal(check({}), false)
})

test('comparison preparation holds the curtain before runs exist or while older results are visible', () => {
  const comparisonPreparation = { status: 'preparing' }
  assert.equal(check({ run: undefined, comparisonPreparation }), true)
  assert.equal(check({ idea: { status: 'ready' }, comparisonPreparation }), true)
  assert.equal(check({ comparedRuns: [{ status: 'failed' }], comparisonPreparation }), true)
})

test('comparison preparation failure reveals recovery even with older unfinished results', () => {
  assert.equal(check({ run: { status: 'scoring' }, comparisonPreparation: { status: 'failed' } }), false)
})

test('scoring, missing reports and explicit recovery keep the curtain up', () => {
  assert.equal(check({ run: { status: 'scoring' } }), true)
  assert.equal(check({ run: { status: 'complete', metrics: {} } }), true)
  assert.equal(check({ run: undefined, preparing: true }), true)
})

test('a run or report failure reveals recovery instead of trapping the user in loading', () => {
  assert.equal(check({ run: { status: 'failed' } }), false)
  assert.equal(check({ run: { ...complete, error: 'Report unavailable' } }), false)
})

test('both comparison results must finish, including the other side’s report', () => {
  assert.equal(check({ comparedRuns: [complete, { status: 'scoring' }] }), true)
  assert.equal(check({ comparedRuns: [complete, { status: 'complete', metrics: {} }] }), true)
  assert.equal(check({ comparedRuns: [complete, complete] }), false)
})

test('either comparison failing reveals the screen even while the other side is pending', () => {
  assert.equal(check({ run: { status: 'scoring' }, comparedRuns: [{ status: 'scoring' }, { status: 'failed' }] }), false)
  assert.equal(check({ comparedRuns: [complete, { ...complete, error: 'Report unavailable' }] }), false)
})

test('idea loading takes precedence over an older video; completion and failure both reveal it', () => {
  assert.equal(check({ idea: { status: 'running' } }), true)
  assert.equal(check({ run: { status: 'scoring' }, idea: { status: 'ready' } }), false)
  assert.equal(check({ run: { status: 'scoring' }, idea: { status: 'failed' } }), false)
})
