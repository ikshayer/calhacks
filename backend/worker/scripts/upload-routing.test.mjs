import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { createJobRunner } from '../src/jobRunner.ts';
import { videoJobEligibility } from '../src/videoJobEligibility.ts';

const name = '6725cc3e-2700-4c76-a2a2-235ddf38f674.mp4';
const job = (id = 1, kind = 'analyse_video') => ({ id: BigInt(id), kind, targetId: '31', status: 'queued' });

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'calhacks-upload-routing-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function fixture(t, sourceUrl = `upload:${name}`) {
  let video = { sourceUrl };
  const calls = { claims: 0, finished: 0, failures: [], handled: 0 };
  const conn = {
    db: { video: { id: { find: () => video } } },
    reducers: {
      claimJob: async () => { calls.claims++; },
      finishJob: async () => { calls.finished++; },
      failJob: async ({ error }) => { calls.failures.push(error); },
    },
  };
  const handler = async () => { calls.handled++; };
  t.mock.method(console, 'error', () => {});
  return { conn, calls, handler, setVideo: (value) => { video = value; } };
}

test('a worker without the local upload never claims or fails it; the receiving worker processes it', async (t) => {
  const other = await directory(t), owner = await directory(t);
  await writeFile(join(owner, name), 'video');
  const { conn, calls, handler } = fixture(t);
  const wrongWorker = createJobRunner({ analyse_video: handler }, (conn, job) => videoJobEligibility(conn, job, other));
  await wrongWorker(conn, job());
  assert.deepEqual(calls, { claims: 0, finished: 0, failures: [], handled: 0 });
  const owningWorker = createJobRunner({ analyse_video: handler }, (conn, job) => videoJobEligibility(conn, job, owner));
  await owningWorker(conn, job());
  assert.deepEqual(calls, { claims: 1, finished: 1, failures: [], handled: 1 });
});

test('video cache arrival and a later local file can make an unclaimed job eligible', async (t) => {
  const root = await directory(t);
  const { conn, calls, handler, setVideo } = fixture(t);
  const run = createJobRunner({ analyse_video: handler }, (conn, job) => videoJobEligibility(conn, job, root));
  setVideo(undefined);
  await run(conn, job());
  setVideo({ sourceUrl: `upload:${name}` });
  await run(conn, job());
  assert.equal(calls.claims, 0);
  await writeFile(join(root, name), 'video');
  await run(conn, job());
  assert.equal(calls.claims, 1);
  assert.equal(calls.finished, 1);
});

test('malformed upload sources fail promptly and never reach the paid analysis handler', async (t) => {
  const root = await directory(t);
  const { conn, calls, handler, setVideo } = fixture(t);
  const run = createJobRunner({ analyse_video: handler }, (conn, job) => videoJobEligibility(conn, job, root));
  for (const [index, sourceUrl] of ['upload:../outside.mp4', 'upload:', 'upload:.hidden'].entries()) {
    setVideo({ sourceUrl });
    await run(conn, job(index + 1));
  }
  assert.equal(calls.claims, 3);
  assert.equal(calls.failures.length, 3);
  assert.ok(calls.failures.every((message) => /Re-upload the original video/.test(message)));
  assert.equal(calls.handled, 0);
});

test('simultaneous asynchronous file preflights cannot claim or execute one job twice', async (t) => {
  const root = await directory(t);
  await writeFile(join(root, name), 'video');
  const { conn, calls, handler } = fixture(t);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let checks = 0;
  const run = createJobRunner({ analyse_video: handler }, async (conn, job) => {
    checks++;
    await waiting;
    return videoJobEligibility(conn, job, root);
  });
  const first = run(conn, job()), second = run(conn, job());
  assert.equal(checks, 2);
  release();
  await Promise.all([first, second]);
  assert.equal(calls.claims, 1);
  assert.equal(calls.handled, 1);
  assert.equal(calls.finished, 1);
});

test('demo videos and other job kinds preserve their existing claim behavior', async (t) => {
  const root = await directory(t);
  const { conn, calls, handler } = fixture(t, 'demo:original.mp4');
  const run = createJobRunner({ analyse_video: handler, score_run: handler }, (conn, job) => videoJobEligibility(conn, job, root));
  await run(conn, job());
  await run(conn, job(2, 'score_run'));
  assert.equal(calls.claims, 2);
  assert.equal(calls.handled, 2);
});

test('directories cannot masquerade as local upload files', async (t) => {
  const root = await directory(t);
  await mkdir(join(root, name));
  const { conn, calls, handler } = fixture(t);
  const run = createJobRunner({ analyse_video: handler }, (conn, job) => videoJobEligibility(conn, job, root));
  await run(conn, job());
  assert.equal(calls.claims, 0);
  assert.deepEqual(calls.failures, []);
});
