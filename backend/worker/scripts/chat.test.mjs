import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildChatGrounding } from '../src/chatGrounding.ts';
import { buildHistory } from '../src/chatHistory.ts';
import { buildIdeaChatGrounding } from '../src/ideaChatGrounding.ts';

test('live worker subscribes to the tables required by chat evidence', () => {
  // The worker entry point connects on import; inspect its subscription contract
  // without starting a real worker or requiring credentials in a unit test.
  const worker = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const subscription = worker.match(/\.subscribe\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(subscription, 'worker must subscribe before consuming cached evidence');
  for (const table of ['run', 'company_profile', 'video', 'audience_member', 'audience_edge', 'decision', 'round_event', 'reference_reel', 'report', 'chat_message', 'idea_test', 'idea_chat_message']) {
    assert.ok(subscription.includes(`'SELECT * FROM ${table}'`), `chat evidence requires a subscription to ${table}`);
  }
});

function fixture(reportStatus = 'ready') {
  const metrics = { uniqueExposed: 2, watch: 1, likes: 1, comments: 0, shares: 1, rounds: 2, coverage: .2, missing: 1, spread: { p10: 1, p50: 2, p90: 3 }, byGroup: [] };
  const options = { seed: 42, audienceVersion: 2, seedExposure: .4, maxRounds: 6 };
  const run = { id: 1n, profileId: 'profile', videoId: 3n, status: 'complete', metrics, options };
  const people = Array.from({ length: 10 }, (_, memberId) => ({
    memberId, name: `Resident ${memberId}`, profileId: 'profile', audienceVersion: 2, groupId: 'everyone',
    persona: `Backstory ${memberId}`, interests: ['gardening'], hotButtons: ['community'], ignores: ['hype'],
    profileJson: JSON.stringify({ personality: { openness: .7 }, values: [`value-${memberId}`], goals: ['help neighbours'] }),
  }));
  people.push({ ...people[0], name: 'Other profile secret', profileId: 'different' }, { ...people[0], name: 'Old version secret', audienceVersion: 1 });
  const decisions = Array.from({ length: 9 }, (_, memberId) => ({
    runId: 1n, memberId, missing: memberId === 8, pWatch: .8, pLike: .5, pComment: .2, pShare: .1 + memberId * .01, explanation: `Reason ${memberId}`,
  }));
  decisions.push({ ...decisions[0], runId: 2n, explanation: 'Other run secret' });
  const report = reportStatus && { status: reportStatus, summary: 'Report summary', notes: [], hooks: [{ suggestion: 'Better hook' }], assumptions: ['Synthetic audience'], references: [{ title: 'Example', observed: { plays: 100n } }] };
  const conn = { db: {
    run: { id: { find: () => run } },
    companyProfile: { id: { find: () => ({ name: 'Business', pitch: 'Pitch', objective: 'engagement', tone: [], groups: [{ id: 'everyone', label: 'Everyone' }] }) } },
    video: { id: { find: () => ({ label: 'Video', summary: 'Summary', signals: { durationSec: 18, topics: [] }, analysisJson: JSON.stringify({ transcript: [], onScreenText: [], notes: [] }) }) } },
    audienceMember: { iter: () => people }, decision: { iter: () => decisions }, referenceReel: { iter: () => [] },
    report: { runId: { find: () => report } },
    roundEvent: { iter: () => [
      { runId: 1n, round: 0, exposed: [0, 8], acted: [{ memberId: 0, kinds: ['watch', 'share'] }], shares: [{ from: 0, to: [1] }], ignored: [8] },
      { runId: 2n, round: 99, exposed: [99], acted: [], shares: [], ignored: [] },
    ] },
    audienceEdge: { iter: () => [
      { profileId: 'profile', audienceVersion: 2, a: 0, b: 1 },
      { profileId: 'different', audienceVersion: 2, a: 0, b: 99 },
      { profileId: 'profile', audienceVersion: 1, a: 0, b: 98 },
    ] },
  } };
  return { conn, run };
}

test('chat receives every resident including middle-ranked and missing predictions, scoped to the run', () => {
  const { conn } = fixture();
  const text = buildChatGrounding(conn, 1n);
  for (let id = 0; id < 10; id++) {
    assert.ok(text.includes(`Resident ${id}`));
    assert.ok(text.includes(`value-${id}`));
  }
  assert.ok(text.includes('Reason 4'));
  assert.equal((text.match(/missing; do not treat as zero probability/g) ?? []).length, 2);
  assert.doesNotMatch(text, /Other profile secret|Old version secret|Other run secret/);
  assert.match(text, /"pLike":0.5,"pComment":0.2/);
});

test('actual events, graph, simulation options and complete report remain distinct evidence', () => {
  const { conn } = fixture();
  const text = buildChatGrounding(conn, 1n);
  assert.match(text, /"seed":42/);
  assert.match(text, /Missing predictions: 1/);
  assert.match(text, /"a":0,"b":1/);
  assert.doesNotMatch(text, /"b":99|"b":98|"round":99/);
  assert.match(text, /"kinds":\["watch","share"\]/);
  assert.match(text, /"assumptions":\["Synthetic audience"\]/);
  assert.match(text, /Better hook/);
  assert.match(text, /"plays":"100"/);
});

test('absent or unfinished reports and unavailable rounds are described explicitly', () => {
  for (const status of [undefined, 'writing', 'failed']) {
    const { conn } = fixture(status ?? null);
    conn.db.roundEvent.iter = () => [];
    const text = buildChatGrounding(conn, 1n);
    assert.match(text, /Report unavailable/);
    assert.match(text, /Round events are unavailable/);
    assert.doesNotMatch(text, /Report summary/);
  }
});

test('unfinished simulations cannot be used as finished chat evidence', () => {
  const { conn, run } = fixture();
  run.status = 'scoring';
  assert.throws(() => buildChatGrounding(conn, 1n), /not complete/);
});

const row = (id, role, status = 'done') => ({ id: BigInt(id), role, status, content: `${role}-${id}`, createdAt: { microsSinceUnixEpoch: BigInt(id) * 100n } });
test('history is ordered and excludes pending, failed and future messages', () => {
  const rows = [row(9, 'user'), row(4, 'assistant', 'failed'), row(3, 'user'), row(2, 'assistant'), row(1, 'user'), row(5, 'assistant', 'pending')];
  assert.deepEqual(buildHistory(rows, row(5, 'assistant', 'pending')), [
    { role: 'user', content: 'user-1' }, { role: 'assistant', content: 'assistant-2' }, { role: 'user', content: 'user-3' },
  ]);
  assert.throws(() => buildHistory([row(1, 'assistant')], row(2, 'assistant', 'pending')), /does not end with a user question/);
});

test('history window stays bounded and begins and ends with a user turn', () => {
  const rows = Array.from({ length: 31 }, (_, index) => row(index + 1, index % 2 ? 'assistant' : 'user'));
  const history = buildHistory(rows, row(32, 'assistant', 'pending'));
  assert.ok(history.length <= 20);
  assert.equal(history[0].role, 'user');
  assert.equal(history.at(-1).content, 'user-31');
});

test('history follows explicit idea sequence and legacy timestamps rather than auto-increment IDs', () => {
  const question = { ...row(99, 'user'), sequence: 1 };
  const answer = { ...row(1, 'assistant'), sequence: 2 };
  const followup = { ...row(75, 'user'), sequence: 3 };
  const target = { ...row(2, 'assistant', 'pending'), sequence: 4 };
  const future = { ...row(3, 'user'), sequence: 5 };
  assert.deepEqual(buildHistory([future, answer, followup, question], target).map((turn) => turn.content), ['user-99', 'assistant-1', 'user-75']);
  const legacyQuestion = { ...row(99, 'user'), createdAt: { microsSinceUnixEpoch: 1n } };
  const legacyAnswer = { ...row(1, 'assistant'), createdAt: { microsSinceUnixEpoch: 1n } };
  const legacyFollowup = { ...row(75, 'user'), createdAt: { microsSinceUnixEpoch: 2n } };
  const legacyTarget = { ...row(2, 'assistant', 'pending'), createdAt: { microsSinceUnixEpoch: 2n } };
  assert.deepEqual(buildHistory([legacyFollowup, legacyAnswer, legacyQuestion], legacyTarget).map((turn) => turn.content), ['user-99', 'assistant-1', 'user-75']);
});

function ideaFixture(version = 2) {
  const idea = {
    id: 1n, profileId: 'profile', audienceVersion: version, status: 'ready', prompt: 'Would a garden café work?', idea: 'Garden café',
    targetLabel: 'Adults', minAge: 18, maxAge: undefined, budgetUsd: 50, options: [{ name: 'Flyers', costUsd: 25 }],
    metrics: { scored: 2, inTarget: 2, interested: 1, interestedInTarget: 1, expectedVisits: 1.1, expectedShares: .5, optionVisits: [.4] },
    analysis: { recommendedCampaign: 'Flyers', evidence: ['Likes community gardens'], assumptions: ['Everyone hears once'], limitations: ['Small fictional town'] },
    plainJson: JSON.stringify({ answer: { text: 'Try a small pilot.', because: 'Interest is mixed.' } }),
    residents: [
      { memberId: 0, name: 'Resident A', age: 30, groupId: 'adults', inTarget: true, missing: false, pVisit: .7, pReturn: .4, pShare: .3, optionInterest: [.6], reason: 'Likes gardening' },
      { memberId: 1, name: 'Resident B', age: 40, groupId: 'adults', inTarget: true, missing: true, pVisit: 0, pReturn: 0, pShare: 0, optionInterest: [], reason: '' },
    ],
  };
  const person = { profileId: 'profile', audienceVersion: 2, memberId: 0, persona: 'A garden volunteer', interests: ['community'], hotButtons: ['local food'], ignores: ['hype'], profileJson: '{"personality":{"openness":0.8},"values":["kindness"]}' };
  // No run, video or round-event tables exist in this fixture: idea chat cannot
  // accidentally pass through video grounding and still satisfy the test.
  const conn = { db: {
    ideaTest: { id: { find: () => idea } },
    companyProfile: { id: { find: () => ({ name: 'Local café', pitch: 'Food and community' }) } },
    audienceMember: { iter: () => [person, { ...person, audienceVersion: 1, persona: 'Old version secret' }, { ...person, profileId: 'other', persona: 'Other profile secret' }] },
  } };
  return { conn, idea };
}

test('idea chat answers from a ready report and personalities without any video', () => {
  const { conn } = ideaFixture();
  const text = buildIdeaChatGrounding(conn, 1n);
  assert.match(text, /Garden café/);
  assert.match(text, /Flyers/);
  assert.match(text, /Try a small pilot/);
  assert.match(text, /kindness/);
  assert.match(text, /Likes gardening/);
  assert.match(text, /conditional on visiting once/);
  assert.match(text, /expectedShares = sum\(pVisit \* pShare\)/);
  assert.match(text, /missing; probabilities unknown/);
  assert.match(text, /No video analysis/);
  assert.doesNotMatch(text, /Old version secret|Other profile secret/);
});

test('historical idea report remains answerable without falsely attaching current personalities', () => {
  const { conn, idea } = ideaFixture();
  idea.audienceVersion = undefined;
  const text = buildIdeaChatGrounding(conn, 1n);
  assert.match(text, /Exact personality snapshots are unavailable/);
  assert.match(text, /Try a small pilot/);
  assert.doesNotMatch(text, /kindness|A garden volunteer/);
  idea.status = 'running';
  assert.throws(() => buildIdeaChatGrounding(conn, 1n), /not ready/);
});
