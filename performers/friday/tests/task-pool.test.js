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
