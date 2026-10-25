import { verdictOf, VERDICT_THRESHOLDS } from '../../src/data/ideaVerdict.ts'

export const limits = {
  fresh: { agreement: .95, meanDrift: .03 },
  fixed: { agreement: .95, meanDrift: .03 },
  paraphrase: { agreement: .90, meanDrift: .05 },
  cache: { agreement: 1, meanDrift: 0 },
}
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] : null
const validProbability = (p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1
const validResident = (r) => r && r.missing === false && Array.isArray(r.optionInterest) && [r.pVisit, r.pReturn, r.pShare, ...r.optionInterest].every(validProbability)
const counts = (residents) => residents.reduce((out, r) => { const verdict = validResident(r) && verdictOf(r); if (verdict) out[verdict]++; return out }, { going: 0, maybe: 0, not: 0 })

/** Join on identity, never array position. Missing/duplicate identities cannot pass. */
export function compare(a, b, expectedIds) {
  const left = new Map((a?.result?.residents ?? []).map((r) => [r.memberId, r]))
  const right = new Map((b?.result?.residents ?? []).map((r) => [r.memberId, r]))
  const rows = []
  for (const memberId of expectedIds) {
    const x = left.get(memberId), y = right.get(memberId)
    if (!x || !y || !validResident(x) || !validResident(y) || x.optionInterest.length !== y.optionInterest.length) continue
    const from = verdictOf(x), to = verdictOf(y)
    rows.push({
      memberId, name: x.name, from, to, pVisitA: x.pVisit, pVisitB: y.pVisit,
      groupId: x.groupId, inTargetA: x.inTarget, inTargetB: y.inTarget,
      drift: Math.abs(x.pVisit - y.pVisit),
      returnDrift: Math.abs(x.pReturn - y.pReturn), shareDrift: Math.abs(x.pShare - y.pShare),
      optionDrifts: x.optionInterest.map((p, i) => Math.abs(p - y.optionInterest[i])),
      nearThreshold: [x.pVisit, y.pVisit].some((p) => Object.values(VERDICT_THRESHOLDS).some((t) => Math.abs(p - t) <= .05 + Number.EPSILON)),
      targetChanged: x.inTarget !== y.inTarget,
    })
  }
  const leftRows = a?.result?.residents ?? [], rightRows = b?.result?.residents ?? []
  const complete = rows.length === expectedIds.length && expectedIds.length > 0 && left.size === expectedIds.length && right.size === expectedIds.length && leftRows.length === left.size && rightRows.length === right.size
  const ca = counts(leftRows), cb = counts(rightRows)
  return {
    complete, matched: rows.length, expected: expectedIds.length,
    agreement: mean(rows.map((r) => Number(r.from === r.to))),
    meanDrift: mean(rows.map((r) => r.drift)),
    p95Drift: percentile(rows.map((r) => r.drift), .95),
    maxDrift: rows.length ? Math.max(...rows.map((r) => r.drift)) : null,
    meanReturnDrift: mean(rows.map((r) => r.returnDrift)), meanShareDrift: mean(rows.map((r) => r.shareDrift)),
    meanOptionDrift: mean(rows.flatMap((r) => r.optionDrifts)),
    countChanges: Object.fromEntries(Object.keys(ca).map((v) => [v, cb[v] - ca[v]])),
    rows,
  }
}

function aggregate(comparisons, kind, id, configuredLimits = limits) {
  const rows = comparisons.flatMap((c) => c.rows)
  const agreement = mean(rows.map((r) => Number(r.from === r.to)))
  const meanDrift = mean(rows.map((r) => r.drift))
  const tolerance = configuredLimits[kind]
  return {
    id, kind, comparisons: comparisons.length, matched: rows.length,
    agreement, meanDrift, p95Drift: percentile(rows.map((r) => r.drift), .95),
    maxDrift: rows.length ? Math.max(...rows.map((r) => r.drift)) : null,
    meanReturnDrift: mean(rows.map((r) => r.returnDrift)), meanShareDrift: mean(rows.map((r) => r.shareDrift)),
    meanOptionDrift: mean(rows.flatMap((r) => r.optionDrifts)),
    transitions: rows.reduce((out, r) => { const key = `${r.from}->${r.to}`; out[key] = (out[key] ?? 0) + 1; return out }, {}),
    maxCountChange: comparisons.length ? Math.max(...comparisons.flatMap((c) => Object.values(c.countChanges).map(Math.abs))) : null,
    targetChanges: rows.filter((r) => r.targetChanged).length,
    passed: comparisons.length > 0 && comparisons.every((c) => c.complete) && agreement >= tolerance.agreement && meanDrift <= tolerance.meanDrift + Number.EPSILON * 8,
  }
}

export function evaluate(manifest, records) {
  const issues = []
  const comparisons = [], groups = []
  const expectedIds = manifest.memberIds
  const configuredLimits = manifest.limits ?? limits
  if (manifest.verdictThresholds && JSON.stringify(manifest.verdictThresholds) !== JSON.stringify(VERDICT_THRESHOLDS)) issues.push('Verdict thresholds changed since the run; report requires its original verdict implementation')
  const byTask = new Map(records.map((r) => [r.taskId, r]))
  if (byTask.size !== records.length) issues.push('Duplicate task results')
  for (const task of manifest.tasks) {
    const record = byTask.get(task.taskId)
    if (!record || record.error || !record.result) { issues.push(`${task.taskId}: ${record?.error ?? 'not completed'}`); continue }
    const residents = record.result.residents
    if (residents.length !== expectedIds.length || new Set(residents.map((r) => r.memberId)).size !== expectedIds.length || expectedIds.some((id) => !residents.some((r) => r.memberId === id && validResident(r)))) issues.push(`${task.taskId}: incomplete or invalid predictions`)
    const fixture = manifest.cases.find((c) => c.id === task.caseId)
    if (!fixture) { issues.push(`${task.taskId}: unknown fixture`); continue }
    if (record.parsed?.minAge !== fixture.expectedAge.minAge || record.parsed?.maxAge !== fixture.expectedAge.maxAge) issues.push(`${task.taskId}: parsed age bounds changed`)
    for (const resident of residents) {
      const age = manifest.ages[resident.memberId]
      const { minAge, maxAge } = fixture.expectedAge
      const expected = minAge === null && maxAge === null || age !== undefined && (minAge === null || age >= minAge) && (maxAge === null || age <= maxAge)
      if (resident.inTarget !== expected) issues.push(`${task.taskId}: incorrect target membership for ${resident.memberId}`)
      if (resident.optionInterest.length !== fixture.options.length) issues.push(`${task.taskId}: wrong option count for ${resident.memberId}`)
    }
    if (task.mode === 'fresh' && record.cachedCount !== 0) issues.push(`${task.taskId}: fresh run used cached resident scores`)
  }
  if (records.some((r) => !manifest.tasks.some((t) => t.taskId === r.taskId))) issues.push('Unexpected task results')
  const make = (a, b, kind, label) => {
    const result = { ...compare(a, b, expectedIds), kind, label, taskA: a?.taskId, taskB: b?.taskId }
    comparisons.push(result)
    return result
  }
  for (const fixture of manifest.cases) {
    const tasks = manifest.tasks.filter((t) => t.mode === 'fresh' && t.caseId === fixture.id).sort((a, b) => a.repeat - b.repeat)
    const pairs = []
    for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) pairs.push(make(byTask.get(tasks[i].taskId), byTask.get(tasks[j].taskId), 'fresh', fixture.id))
    groups.push(aggregate(pairs, 'fresh', fixture.id, configuredLimits))
    if (fixture.variant === 'conversational' || fixture.variant === 'reordered') {
      const pairs = tasks.map((t) => {
        const original = manifest.tasks.find((o) => o.mode === 'fresh' && o.caseId === `${fixture.family}/original` && o.repeat === t.repeat)
        return make(byTask.get(original?.taskId), byTask.get(t.taskId), 'paraphrase', fixture.id)
      })
      groups.push(aggregate(pairs, 'paraphrase', fixture.id, configuredLimits))
    }
  }
  const fixedTasks = manifest.tasks.filter((t) => t.mode === 'fixed')
  if (fixedTasks.length) {
    const pairs = []
    for (let i = 0; i < fixedTasks.length; i++) for (let j = i + 1; j < fixedTasks.length; j++) pairs.push(make(byTask.get(fixedTasks[i].taskId), byTask.get(fixedTasks[j].taskId), 'fixed', 'Identical JEV payload'))
    groups.push(aggregate(pairs, 'fixed', 'Identical JEV payload', configuredLimits))
  }
  const warm = manifest.tasks.find((t) => t.mode === 'cache-warm'), replay = manifest.tasks.find((t) => t.mode === 'cache-replay')
  if (warm && replay) {
    const a = byTask.get(warm.taskId), b = byTask.get(replay.taskId)
    const group = aggregate([make(a, b, 'cache', 'Cached replay')], 'cache', 'Cached replay', configuredLimits)
    const exact = (r) => JSON.stringify({ ...r?.result, id: undefined })
    group.passed &&= exact(a) === exact(b) && b?.apiCalls === 0 && b?.cachedCount === expectedIds.length
    groups.push(group)
  }
  const contrasts = manifest.cases.filter((c) => c.variant === 'contrast').flatMap((c) => manifest.tasks.filter((t) => t.caseId === c.id && t.mode === 'fresh').map((t) => {
    const original = manifest.tasks.find((o) => o.caseId === `${c.family}/original` && o.mode === 'fresh' && o.repeat === t.repeat)
    return { family: c.family, repeat: t.repeat, ...compare(byTask.get(original?.taskId), byTask.get(t.taskId), expectedIds) }
  }))
  const worst = comparisons.flatMap((c) => c.rows.map((r) => ({ ...r, kind: c.kind, label: c.label, taskA: c.taskA, taskB: c.taskB }))).sort((a, b) => b.drift - a.drift).slice(0, 100)
  const inputSummaries = manifest.cases.map((fixture) => {
    const runs = manifest.tasks.filter((t) => t.mode === 'fresh' && t.caseId === fixture.id).sort((a, b) => a.repeat - b.repeat)
    const residents = expectedIds.map((memberId) => {
      const samples = runs.map((t) => byTask.get(t.taskId)?.result?.residents.find((r) => r.memberId === memberId)).filter(validResident)
      const values = samples.map((r) => r.pVisit), average = mean(values)
      const complete = values.length === runs.length
      return {
        memberId, name: samples[0]?.name, samples: values.length,
        mean: average, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
        stdDev: values.length ? Math.sqrt(mean(values.map((p) => (p - average) ** 2))) : null,
        verdictCounts: counts(samples),
        alwaysSameVerdict: complete && values.length > 0 && new Set(samples.map(verdictOf)).size === 1,
      }
    })
    return {
      id: fixture.id, expectedRepeats: runs.length,
      stableResidents: residents.filter((r) => r.alwaysSameVerdict).length, expectedResidents: expectedIds.length, residents,
      runs: runs.map((t) => {
        const r = byTask.get(t.taskId), rows = r?.result?.residents ?? []
        return { taskId: t.taskId, error: r?.error, scored: rows.filter(validResident).length, town: counts(rows), target: counts(rows.filter((p) => p.inTarget)) }
      }),
    }
  })
  const passed = issues.length === 0 && groups.length > 0 && groups.every((g) => g.passed)
  const complete = manifest.tasks.every((t) => byTask.has(t.taskId))
  const kinds = ['fresh', 'paraphrase', 'fixed', 'cache']
  const summary = {
    completedTasks: manifest.tasks.filter((t) => byTask.has(t.taskId)).length, expectedTasks: manifest.tasks.length,
    pipelineErrors: records.filter((r) => r.error).length,
    freshPredictions: records.filter((r) => r.mode === 'fresh').reduce((sum, r) => sum + (r.result?.residents.filter(validResident).length ?? 0), 0),
    expectedFreshPredictions: manifest.tasks.filter((t) => t.mode === 'fresh').length * expectedIds.length,
    checks: Object.fromEntries(kinds.map((kind) => {
      const selected = groups.filter((g) => g.kind === kind)
      const rows = comparisons.filter((c) => c.kind === kind).flatMap((c) => c.rows)
      return [kind, { passed: selected.filter((g) => g.passed).length, total: selected.length, verdictAgreement: mean(rows.map((r) => Number(r.from === r.to))), meanVisitDrift: mean(rows.map((r) => r.drift)) }]
    })),
  }
  const contrastSummaries = [...new Set(contrasts.map((c) => c.family))].map((family) => {
    const pairs = contrasts.filter((c) => c.family === family), rows = pairs.flatMap((c) => c.rows)
    return { family, completeComparisons: pairs.filter((p) => p.complete).length, comparisons: pairs.length,
      meanVisitChange: mean(rows.map((r) => r.pVisitB - r.pVisitA)), meanYesCountChange: mean(pairs.map((p) => p.countChanges.going)) }
  })
  return { passed, status: !complete ? 'incomplete' : passed ? 'passed' : 'failed', summary, limits: configuredLimits, issues, groups, comparisons, contrasts, contrastSummaries, worst, inputSummaries }
}

const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
export function renderReports(report) {
  const headers = ['id', 'kind', 'passed', 'agreement', 'meanDrift', 'p95Drift', 'maxDrift', 'meanReturnDrift', 'meanShareDrift', 'meanOptionDrift', 'maxCountChange', 'targetChanges', 'matched']
  const csv = [headers.join(','), ...report.groups.map((g) => headers.map((h) => cell(g[h])).join(','))].join('\n') + '\n'
  const pct = (p) => p === null ? 'n/a' : `${(p * 100).toFixed(1)}%`
  const markdown = [
    '# Idea consistency evaluation', '', `Result: **${report.passed ? 'PASS' : report.status === 'incomplete' ? 'INCOMPLETE' : 'FAIL'}**`, '',
    'Millbrook personas are fictional; these results measure repeatability, not observed customer accuracy. Fresh means application caches were bypassed; provider-side caching cannot be ruled out. Model aliases can change between evaluations.', '',
    `${report.summary.completedTasks}/${report.summary.expectedTasks} pipeline tasks recorded; ${report.summary.freshPredictions}/${report.summary.expectedFreshPredictions} fresh resident predictions; ${report.summary.pipelineErrors} pipeline errors. Scores recorded before an analyst failure are included in consistency comparisons; the failure still counts against the overall result.`, '',
    '| Check | Passing inputs | Pooled verdict agreement | Mean visit drift |', '|---|---:|---:|---:|',
    ...Object.entries(report.summary.checks).map(([kind, s]) => `| ${kind} | ${s.passed}/${s.total} | ${pct(s.verdictAgreement)} | ${pct(s.meanVisitDrift)} |`), '',
    'The pooled agreement is descriptive. Passing requires every individual input/pairing below to meet its own limits.', '',
    '| Input | Comparison | Pass | Verdict agreement | Mean visit drift | P95 drift | Largest count change |',
    '|---|---|---|---:|---:|---:|---:|',
    ...report.groups.map((g) => `| ${g.id} | ${g.kind} | ${g.passed ? 'yes' : 'no'} | ${pct(g.agreement)} | ${pct(g.meanDrift)} | ${pct(g.p95Drift)} | ${g.maxCountChange ?? 'n/a'} |`), '',
    '## Residents with the same verdict in every fresh repeat', '',
    '| Input | Stable residents | Expected repeats |', '|---|---:|---:|',
    ...report.inputSummaries.map((s) => `| ${s.id} | ${s.stableResidents}/${s.expectedResidents} | ${s.expectedRepeats} |`), '',
    '## Failures and incomplete coverage', '', ...(report.issues.length ? report.issues.map((s) => `- ${s}`) : ['No coverage or parsing failures.']), '',
    '## Largest individual differences', '',
    '| Input | Resident | Verdict transition | Visit probability | Drift | Near threshold |', '|---|---|---|---|---:|---|',
    ...report.worst.slice(0, 25).map((r) => `| ${r.label} | ${r.name} (${r.memberId}) | ${r.from} → ${r.to} | ${r.pVisitA.toFixed(4)} → ${r.pVisitB.toFixed(4)} | ${pct(r.drift)} | ${r.nearThreshold ? 'yes' : 'no'} |`), '',
    '## Price sensitivity diagnostics', '',
    '| Idea family | Complete repeat comparisons | Mean visit probability change | Mean yes-count change |', '|---|---:|---:|---:|',
    ...report.contrastSummaries.map((s) => `| ${s.family} | ${s.completeComparisons}/${s.comparisons} | ${pct(s.meanVisitChange)} | ${s.meanYesCountChange ?? 'n/a'} |`), '',
    'Price contrasts are diagnostic only. Full transitions, contrast effects, secondary probability drift, timings, token usage, request hashes, and raw results are in the JSON/JSONL artifacts.', '',
  ].join('\n')
  return { csv, markdown }
}
