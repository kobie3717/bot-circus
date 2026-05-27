import { test } from 'node:test';
import assert from 'node:assert';
import { TaskPool } from '../task-pool.mjs';
import { mockWorkerFactory } from './helpers.js';

test('spawn returns sequential task IDs starting at 1', () => {
  const pool = new TaskPool({ maxConcurrent: 5, workerFactory: mockWorkerFactory() });
  const a = pool.spawn('first', { ctx: 1 }, 100);
  const b = pool.spawn('second', { ctx: 2 }, 101);
  const c = pool.spawn('third', { ctx: 3 }, 102);
  assert.strictEqual(a.taskId, 1);
  assert.strictEqual(b.taskId, 2);
  assert.strictEqual(c.taskId, 3);
  assert.strictEqual(a.accepted, true);
});

test('spawn rejects when pool full', () => {
  const pool = new TaskPool({ maxConcurrent: 2, workerFactory: mockWorkerFactory() });
  const a = pool.spawn('a', {}, 1);
  const b = pool.spawn('b', {}, 2);
  const c = pool.spawn('c', {}, 3);
  assert.strictEqual(a.accepted, true);
  assert.strictEqual(b.accepted, true);
  assert.strictEqual(c.accepted, false);
  assert.strictEqual(c.taskId, null);
});

test('cancel removes task and kills worker', async () => {
  const factory = mockWorkerFactory();
  let cancelledRecord = null;
  let cancelErr = null;
  const pool = new TaskPool({
    maxConcurrent: 5,
    workerFactory: factory,
    onError: (rec, err) => { cancelledRecord = rec; cancelErr = err; }
  });
  const { taskId } = pool.spawn('hello', {}, 1);
  const ok = pool.cancel(taskId);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(ok, true);
  assert.strictEqual(pool.runningCount(), 0);
  assert.strictEqual(factory.created[0].handle.killed, true);
  assert.strictEqual(cancelledRecord.id, taskId);
  assert.match(cancelErr.message, /cancelled/i);
});

test('cancel returns false for unknown taskId', () => {
  const pool = new TaskPool({ maxConcurrent: 5, workerFactory: mockWorkerFactory() });
  assert.strictEqual(pool.cancel(999), false);
});

test('cancelAll removes everything and returns count', async () => {
  const factory = mockWorkerFactory();
  const pool = new TaskPool({ maxConcurrent: 5, workerFactory: factory, onError: () => {} });
  pool.spawn('a', {}, 1);
  pool.spawn('b', {}, 2);
  pool.spawn('c', {}, 3);
  const n = pool.cancelAll();
  await new Promise(r => setImmediate(r));
  assert.strictEqual(n, 3);
  assert.strictEqual(pool.runningCount(), 0);
  assert.strictEqual(factory.created.every(w => w.handle.killed), true);
});

test('status returns running tasks with elapsed ms', async () => {
  const pool = new TaskPool({ maxConcurrent: 5, workerFactory: mockWorkerFactory(), onError: () => {} });
  pool.spawn('build hero section', { user: 'u1' }, 100);
  await new Promise(r => setTimeout(r, 25));
  pool.spawn('draft email', { user: 'u1' }, 101);
  const s = pool.status();
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].id, 1);
  assert.match(s[0].prompt, /build hero/);
  assert.ok(s[0].elapsedMs >= 20, `expected >=20, got ${s[0].elapsedMs}`);
  assert.ok(s[1].elapsedMs < s[0].elapsedMs);
});
