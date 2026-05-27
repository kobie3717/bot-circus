# Friday Parallel Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace friday's strict per-user serial gate (`busyUsers` Set + `userQueues` Map) with a 5-concurrent task pool, inline `queue/parallel` keyboard on busy, and control commands (`/p`, `/status`, `/cancel <id>`, `/cancel all`) with Telegram quote-reply threading.

**Architecture:** New `task-pool.mjs` module owns task metadata + concurrency limits + cancellation. friday's `bot.mjs` removes the serial gate, wires TaskPool, adds command handlers and a `callback_query` handler for the inline keyboard. The TaskPool delegates actual Claude CLI spawn to an injected `workerFactory(prompt, ctx) → { handle, promise }`. Tests use a `MockWorker` to verify pool behavior without spawning real subprocesses.

**Tech Stack:** Node 22 ESM, `node:test`, `grammy` (Telegram bot framework already in use), no new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-friday-parallel-tasks-design.md`

---

## File Structure

**Create:**

```
bot-circus/performers/friday/
├── task-pool.mjs                          # T1+
└── tests/
    ├── helpers.js                         # T0 — MockWorker
    └── task-pool.test.js                  # T1-T8 — unit tests
```

**Modify:**

```
bot-circus/performers/friday/bot.mjs       # T9-T13 — remove serial gate, wire TaskPool, add handlers
bot-circus/performers/friday/package.json  # T0 — add test script
```

---

## Task 0: Test scaffolding + MockWorker helper

**Files:**
- Create: `bot-circus/performers/friday/tests/helpers.js`
- Modify: `bot-circus/performers/friday/package.json` — add `"test"` script

- [ ] **Step 1: Create MockWorker helper**

Create `bot-circus/performers/friday/tests/helpers.js`:
```js
// MockWorker: stand-in for the Claude CLI subprocess.
// Returns { handle, promise } matching the workerFactory contract.
// Test harness controls resolve/reject/kill via the returned controls object.

export function makeMockWorker() {
  let resolveFn, rejectFn;
  let killed = false;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const handle = {
    kill(signal) {
      killed = true;
      rejectFn(new Error('cancelled'));
    },
    get killed() { return killed; }
  };
  return {
    handle,
    promise,
    controls: {
      resolve: (v) => resolveFn(v),
      reject: (e) => rejectFn(e),
      killed: () => killed
    }
  };
}

export function mockWorkerFactory() {
  const created = [];
  function factory(prompt, ctx) {
    const m = makeMockWorker();
    created.push({ prompt, ctx, ...m });
    return { handle: m.handle, promise: m.promise };
  }
  factory.created = created;
  return factory;
}
```

- [ ] **Step 2: Add test script to package.json**

Edit `bot-circus/performers/friday/package.json` `scripts` section to include:
```json
"test": "node --test --test-reporter=spec tests/*.test.js"
```

Read the file first to know what's already there. Don't overwrite other scripts; merge.

- [ ] **Step 3: Verify test runner works with empty suite**

Run:
```bash
cd /root/bot-circus/performers/friday && npm test 2>&1 | tail -5
```

Expected: `node --test` runs without test files yet (will say no tests found or fail with no match — that's fine).

- [ ] **Step 4: Commit**

```bash
cd /root/bot-circus
git add performers/friday/tests/helpers.js performers/friday/package.json
git commit -m "feat(friday): test scaffolding + MockWorker helper (T0)"
```

---

## Task 1: TaskPool — sequential task IDs

**Files:**
- Create: `bot-circus/performers/friday/task-pool.mjs`
- Create: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Write failing test**

Create `bot-circus/performers/friday/tests/task-pool.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../task-pool.mjs'`.

- [ ] **Step 3: Write minimal TaskPool**

Create `bot-circus/performers/friday/task-pool.mjs`:
```js
export class TaskPool {
  constructor({ maxConcurrent = 5, workerFactory, logger, onResult, onError }) {
    this.maxConcurrent = maxConcurrent;
    this.workerFactory = workerFactory;
    this.logger = logger;
    this.onResult = onResult;
    this.onError = onError;
    this._tasks = new Map();
    this._nextId = 1;
  }

  spawn(prompt, ctx, replyToMessageId) {
    if (this._tasks.size >= this.maxConcurrent) {
      return { taskId: null, accepted: false };
    }
    const taskId = this._nextId++;
    const startedAt = Date.now();
    const { handle, promise } = this.workerFactory(prompt, ctx);
    const record = { id: taskId, prompt, ctx, replyToMessageId, startedAt, handle };
    this._tasks.set(taskId, record);

    promise.then(
      (result) => {
        this._tasks.delete(taskId);
        this.onResult?.(record, result);
      },
      (err) => {
        this._tasks.delete(taskId);
        this.onError?.(record, err);
      }
    );

    return { taskId, accepted: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add performers/friday/task-pool.mjs performers/friday/tests/task-pool.test.js
git commit -m "feat(friday): TaskPool sequential ids (T1)"
```

---

## Task 2: TaskPool — spawn rejects when full

**Files:**
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
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
```

- [ ] **Step 2: Run + verify pass (rejection logic already present from T1)**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/tests/task-pool.test.js
git commit -m "test(friday): TaskPool rejects when full (T2)"
```

---

## Task 3: TaskPool — cancel removes task + kills worker

**Files:**
- Modify: `bot-circus/performers/friday/task-pool.mjs`
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
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
  // Let onError microtask flush
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
```

- [ ] **Step 2: Run test → fails (`cancel` not defined, `runningCount` not defined)**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: FAIL with `pool.cancel is not a function`.

- [ ] **Step 3: Add `cancel` + `runningCount` to TaskPool**

Append inside the `TaskPool` class body in `task-pool.mjs`:
```js
  cancel(taskId) {
    const record = this._tasks.get(taskId);
    if (!record) return false;
    try { record.handle.kill('SIGTERM'); } catch { /* worker already gone */ }
    // onError fires via the rejected promise from MockWorker.kill; do not remove here.
    return true;
  }

  runningCount() {
    return this._tasks.size;
  }
```

- [ ] **Step 4: Run test → 4 tests pass**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add performers/friday/task-pool.mjs performers/friday/tests/task-pool.test.js
git commit -m "feat(friday): TaskPool cancel + runningCount (T3)"
```

---

## Task 4: TaskPool — cancelAll

**Files:**
- Modify: `bot-circus/performers/friday/task-pool.mjs`
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
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
```

- [ ] **Step 2: Run → fails (`cancelAll` not defined)**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: FAIL with `pool.cancelAll is not a function`.

- [ ] **Step 3: Add `cancelAll`**

Append inside the `TaskPool` class body:
```js
  cancelAll() {
    const ids = [...this._tasks.keys()];
    for (const id of ids) this.cancel(id);
    return ids.length;
  }
```

- [ ] **Step 4: Run → 5 tests pass**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add performers/friday/task-pool.mjs performers/friday/tests/task-pool.test.js
git commit -m "feat(friday): TaskPool cancelAll (T4)"
```

---

## Task 5: TaskPool — status with elapsed times

**Files:**
- Modify: `bot-circus/performers/friday/task-pool.mjs`
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
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
```

- [ ] **Step 2: Run → fails (`status` not defined)**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: FAIL with `pool.status is not a function`.

- [ ] **Step 3: Add `status` (+ `isFull` while here)**

Append inside the `TaskPool` class body:
```js
  status() {
    const now = Date.now();
    return [...this._tasks.values()].map(r => ({
      id: r.id,
      prompt: r.prompt,
      startedAt: r.startedAt,
      elapsedMs: now - r.startedAt
    }));
  }

  isFull() {
    return this._tasks.size >= this.maxConcurrent;
  }
```

- [ ] **Step 4: Run → 6 tests pass**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add performers/friday/task-pool.mjs performers/friday/tests/task-pool.test.js
git commit -m "feat(friday): TaskPool status + isFull (T5)"
```

---

## Task 6: TaskPool — worker resolve fires onResult + removes record

**Files:**
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
test('worker resolve fires onResult and removes record', async () => {
  const factory = mockWorkerFactory();
  let resultRecord = null;
  let resultValue = null;
  const pool = new TaskPool({
    maxConcurrent: 5,
    workerFactory: factory,
    onResult: (rec, val) => { resultRecord = rec; resultValue = val; }
  });
  const { taskId } = pool.spawn('do thing', {}, 1);
  factory.created[0].controls.resolve('all done');
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pool.runningCount(), 0);
  assert.strictEqual(resultRecord.id, taskId);
  assert.strictEqual(resultValue, 'all done');
});
```

- [ ] **Step 2: Run → passes (logic already present from T1)**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/tests/task-pool.test.js
git commit -m "test(friday): TaskPool onResult fires + removes record (T6)"
```

---

## Task 7: TaskPool — worker reject fires onError + removes record

**Files:**
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
test('worker reject fires onError and removes record', async () => {
  const factory = mockWorkerFactory();
  let errRecord = null;
  let errValue = null;
  const pool = new TaskPool({
    maxConcurrent: 5,
    workerFactory: factory,
    onError: (rec, err) => { errRecord = rec; errValue = err; }
  });
  const { taskId } = pool.spawn('broken thing', {}, 1);
  factory.created[0].controls.reject(new Error('claude crashed'));
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pool.runningCount(), 0);
  assert.strictEqual(errRecord.id, taskId);
  assert.match(errValue.message, /claude crashed/);
});
```

- [ ] **Step 2: Run → passes (logic already present from T1)**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/tests/task-pool.test.js
git commit -m "test(friday): TaskPool onError fires + removes record (T7)"
```

---

## Task 8: TaskPool — isFull reflects pool state across spawn/cancel cycles

**Files:**
- Modify: `bot-circus/performers/friday/tests/task-pool.test.js`

- [ ] **Step 1: Append failing test**

Append to `tests/task-pool.test.js`:
```js
test('isFull and runningCount reflect spawn/cancel cycles', async () => {
  const pool = new TaskPool({ maxConcurrent: 2, workerFactory: mockWorkerFactory(), onError: () => {} });
  assert.strictEqual(pool.isFull(), false);
  assert.strictEqual(pool.runningCount(), 0);
  const a = pool.spawn('a', {}, 1);
  pool.spawn('b', {}, 2);
  assert.strictEqual(pool.runningCount(), 2);
  assert.strictEqual(pool.isFull(), true);
  pool.cancel(a.taskId);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pool.runningCount(), 1);
  assert.strictEqual(pool.isFull(), false);
});
```

- [ ] **Step 2: Run → 9 tests pass**

Run: `cd /root/bot-circus/performers/friday && node --test tests/task-pool.test.js 2>&1 | tail -10`

Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/tests/task-pool.test.js
git commit -m "test(friday): TaskPool spawn/cancel cycle invariants (T8)"
```

---

## Task 9: Wire TaskPool into bot.mjs — remove serial gate

**Files:**
- Modify: `bot-circus/performers/friday/bot.mjs`

- [ ] **Step 1: Inspect current serial-gate code**

Run:
```bash
cd /root/bot-circus/performers/friday
grep -nE "busyUsers|userQueues|processNext|handleDesignRequest" bot.mjs | head -20
```

Note line numbers of `busyUsers`, `userQueues`, `processNext` (the per-user serial state) and the function that does the actual Claude CLI spawn for a user prompt.

- [ ] **Step 2: Identify the workerFactory shape**

The friday bot.mjs already has a function that takes (ctx, prompt) and spawns `claudeProcess = spawn(CLAUDE_CLI_PATH, ...)`. The factory wraps that: returns `{ handle: claudeProcess, promise: <resolves on close with full stdout> }`.

Find the existing spawn block (look around line 1158 `handleTextMessage` or the spawn at line 1219). It currently runs as `await ...` directly. The refactor: extract into a function `spawnClaudeWorker(prompt, ctx) → { handle, promise }`.

- [ ] **Step 3: Extract `spawnClaudeWorker`**

Locate the function that handles a single user message and runs Claude. Refactor so that the spawn+stream+resolve logic becomes:
```js
// In bot.mjs near other helpers
function spawnClaudeWorker(prompt, ctx) {
  const args = [/* existing claude CLI args */];
  const handle = spawn(CLAUDE_CLI_PATH, args, { cwd: WORKING_DIR });
  let stdout = '';
  const promise = new Promise((resolve, reject) => {
    handle.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // Optional: stream partial chunks back to Telegram with reply_parameters
    });
    handle.on('error', reject);
    handle.on('close', (code) => {
      if (code === 0 || code === null) resolve(stdout);
      else reject(new Error(`Claude CLI exited with code ${code}`));
    });
  });
  return { handle, promise };
}
```

This preserves the existing spawn behavior. The streaming + reply logic that previously lived inline can now also live inside `onResult`/streaming callbacks attached to the worker's stdout — but minimal refactor first: just return the final stdout and let `onResult` post the reply.

- [ ] **Step 4: Add TaskPool instantiation near top of bot.mjs**

After `const bot = new Bot(BOT_TOKEN);` add:
```js
import { TaskPool } from './task-pool.mjs';

const pool = new TaskPool({
  maxConcurrent: 5,
  workerFactory: spawnClaudeWorker,
  logger: console,
  onResult: (task, result) => {
    bot.api.sendMessage(task.ctx.chat.id, `#${task.id} ${result}`, {
      reply_parameters: { message_id: task.replyToMessageId }
    }).catch(err => console.error('[reply failed]', err.message));
  },
  onError: (task, err) => {
    const isCancel = /cancelled|SIGTERM/i.test(err.message || '');
    const msg = isCancel ? `🛑 #${task.id} cancelled` : `❌ #${task.id} failed: ${err.message}`;
    bot.api.sendMessage(task.ctx.chat.id, msg, {
      reply_parameters: { message_id: task.replyToMessageId }
    }).catch(e => console.error('[error reply failed]', e.message));
  }
});

const pendingPrompts = new Map(); // message_id → { ctx, text, ts }
```

- [ ] **Step 5: Remove `busyUsers` Set, `userQueues` Map, `processNext` function**

Delete:
- `const busyUsers = new Set();`
- `const userQueues = new Map();`
- `async function processNext(userId) { ... }`
- Any reference to `busyUsers.has`, `busyUsers.add`, `busyUsers.delete`, `userQueues.get`, `userQueues.set` inside message handlers.

Replace those references with the new TaskPool spawn flow (see T12 for the full handler).

- [ ] **Step 6: Verify syntax**

Run: `cd /root/bot-circus/performers/friday && node --check bot.mjs && echo "syntax OK"`

Expected: `syntax OK`.

If the syntax check fails, the refactor missed something. Read the cited line and adjust.

- [ ] **Step 7: Verify lint still clean**

Run: `cd /root/bot-circus && ./bin/circus-lint --performer friday --format text`

Expected: `OK friday (errors: 0, warnings: 0)`.

- [ ] **Step 8: Commit (NOTE: this commit is a refactor in progress; T12 finishes the handler rewrite)**

```bash
cd /root/bot-circus
git add performers/friday/bot.mjs
git commit -m "refactor(friday): extract spawnClaudeWorker, instantiate TaskPool, remove serial gate (T9)"
```

---

## Task 10: `/status` command handler

**Files:**
- Modify: `bot-circus/performers/friday/bot.mjs`

- [ ] **Step 1: Add the handler**

In the message-handling section of bot.mjs (likely `bot.on('message:text', ...)` or `handleTextMessage`), at the very TOP of the handler, add:
```js
const text = ctx.message?.text || '';

if (text === '/status') {
  const tasks = pool.status();
  if (tasks.length === 0) {
    return ctx.reply('📋 No tasks running.');
  }
  const lines = tasks.map(t => {
    const elapsed = formatElapsed(t.elapsedMs);
    return `  #${t.id}  ${elapsed}  ${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? '…' : ''}`;
  });
  return ctx.reply(`📋 Running tasks: ${tasks.length}/5\n${lines.join('\n')}`);
}

// Helper (declare once near top of file if not already present):
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r}s`;
}
```

- [ ] **Step 2: Smoke (manual)**

```bash
cd /root/bot-circus/performers/friday
node --check bot.mjs && echo "syntax OK"
```

Expected: syntax OK.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/bot.mjs
git commit -m "feat(friday): /status command lists running tasks (T10)"
```

---

## Task 11: `/cancel <id>` and `/cancel all` handlers

**Files:**
- Modify: `bot-circus/performers/friday/bot.mjs`

- [ ] **Step 1: Add cancel handler**

Below the `/status` handler in bot.mjs's message handler, add:
```js
if (text.startsWith('/cancel ')) {
  const arg = text.slice(8).trim();
  if (arg === 'all') {
    const n = pool.cancelAll();
    return ctx.reply(`🛑 Cancelled ${n} task${n === 1 ? '' : 's'}.`);
  }
  const id = parseInt(arg, 10);
  if (isNaN(id)) {
    return ctx.reply(`Usage: /cancel <id> or /cancel all`);
  }
  const ok = pool.cancel(id);
  return ctx.reply(ok ? `🛑 #${id} cancelled.` : `No task #${id}.`);
}
```

- [ ] **Step 2: Syntax check**

Run: `cd /root/bot-circus/performers/friday && node --check bot.mjs && echo "syntax OK"`

Expected: syntax OK.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/bot.mjs
git commit -m "feat(friday): /cancel <id> and /cancel all (T11)"
```

---

## Task 12: `/p` prefix bypass + inline keyboard for non-/p case

**Files:**
- Modify: `bot-circus/performers/friday/bot.mjs`

- [ ] **Step 1: Replace the main user-message routing block**

After the `/status` and `/cancel` handlers (which short-circuit before reaching here), the message-text handler should do the spawn-or-prompt logic. Add (or replace any leftover busy/queue logic with):

```js
const explicitParallel = text.startsWith('/p ');
const prompt = explicitParallel ? text.slice(3).trimStart() : text;

if (pool.runningCount() === 0 || explicitParallel) {
  if (pool.isFull()) {
    return ctx.reply(`⚠️ Bot at capacity (${pool.runningCount()}/5 running). Try /status or /cancel <id>.`);
  }
  const { taskId, accepted } = pool.spawn(prompt, ctx, ctx.message.message_id);
  if (!accepted) {
    return ctx.reply(`⚠️ Pool full.`);
  }
  await ctx.reply(
    `🌀 #${taskId} spawned: "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`,
    { reply_parameters: { message_id: ctx.message.message_id } }
  );
  return;
}

// Pool not empty and not explicit-parallel — ask
pendingPrompts.set(ctx.message.message_id, {
  ctx,
  text: prompt,
  ts: Date.now()
});

// Evict pendingPrompts entries older than 5 minutes
const cutoff = Date.now() - 5 * 60 * 1000;
for (const [mid, entry] of pendingPrompts) {
  if (entry.ts < cutoff) pendingPrompts.delete(mid);
}

return ctx.reply(
  `🤔 ${pool.runningCount()}/5 task(s) running. Queue this or run in parallel?`,
  { reply_markup: { inline_keyboard: [[
    { text: 'Queue (wait for current)', callback_data: `q:${ctx.message.message_id}` },
    { text: 'Parallel (spawn now)',     callback_data: `p:${ctx.message.message_id}` }
  ]] } }
);
```

- [ ] **Step 2: Syntax check**

Run: `cd /root/bot-circus/performers/friday && node --check bot.mjs && echo "syntax OK"`

Expected: syntax OK.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add performers/friday/bot.mjs
git commit -m "feat(friday): /p prefix + inline keyboard on busy (T12)"
```

---

## Task 13: `callback_query` handler + queue path

**Files:**
- Modify: `bot-circus/performers/friday/bot.mjs`

- [ ] **Step 1: Add a simple queue (for the [Queue] button path)**

In bot.mjs near the TaskPool instantiation, add:
```js
const queueWaiting = []; // { ctx, text }

function tryDrainQueue() {
  while (queueWaiting.length > 0 && !pool.isFull()) {
    const next = queueWaiting.shift();
    const { taskId } = pool.spawn(next.text, next.ctx, next.ctx.message.message_id);
    bot.api.sendMessage(next.ctx.chat.id, `🌀 #${taskId} (from queue) spawned: "${next.text.slice(0, 60)}${next.text.length > 60 ? '…' : ''}"`, {
      reply_parameters: { message_id: next.ctx.message.message_id }
    }).catch(err => console.error('[drain reply failed]', err.message));
  }
}
```

Wire `tryDrainQueue()` into the pool's `onResult` and `onError` callbacks (call after the reply send):
```js
onResult: (task, result) => {
  bot.api.sendMessage(...).catch(...);
  tryDrainQueue();
},
onError: (task, err) => {
  bot.api.sendMessage(...).catch(...);
  tryDrainQueue();
}
```

- [ ] **Step 2: Add `callback_query` handler**

After the existing `bot.on('message:text', ...)` handler, add:
```js
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  const [action, msgIdStr] = data.split(':');
  const msgId = Number(msgIdStr);
  const pending = pendingPrompts.get(msgId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: 'Prompt expired.' });
    return;
  }
  pendingPrompts.delete(msgId);

  if (action === 'q') {
    queueWaiting.push({ ctx: pending.ctx, text: pending.text });
    await ctx.answerCallbackQuery({ text: 'Queued.' });
  } else if (action === 'p') {
    if (pool.isFull()) {
      await ctx.answerCallbackQuery({ text: 'Pool full.' });
    } else {
      const { taskId } = pool.spawn(pending.text, pending.ctx, pending.ctx.message.message_id);
      await pending.ctx.reply(
        `🌀 #${taskId} spawned: "${pending.text.slice(0, 60)}${pending.text.length > 60 ? '…' : ''}"`,
        { reply_parameters: { message_id: pending.ctx.message.message_id } }
      );
      await ctx.answerCallbackQuery({ text: 'Spawned.' });
    }
  } else {
    await ctx.answerCallbackQuery({ text: 'Unknown action.' });
  }

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch { /* message already removed */ }
});
```

- [ ] **Step 3: Update `/status` to show queue depth**

Edit the `/status` handler (added in T10) to also list `queueWaiting`:
```js
if (text === '/status') {
  const tasks = pool.status();
  let out = tasks.length === 0
    ? '📋 No tasks running.'
    : `📋 Running tasks: ${tasks.length}/5\n` + tasks.map(t => {
        const elapsed = formatElapsed(t.elapsedMs);
        return `  #${t.id}  ${elapsed}  ${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? '…' : ''}`;
      }).join('\n');
  if (queueWaiting.length > 0) {
    out += `\n\nQueued: ${queueWaiting.length}\n` + queueWaiting.map(q => `  → "${q.text.slice(0, 60)}${q.text.length > 60 ? '…' : ''}"`).join('\n');
  }
  return ctx.reply(out);
}
```

- [ ] **Step 4: Syntax + lint + tests**

Run:
```bash
cd /root/bot-circus/performers/friday && node --check bot.mjs && npm test 2>&1 | tail -5
cd /root/bot-circus && ./bin/circus-lint --performer friday --format text
```

Expected: syntax OK, 9 tests pass, lint clean.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add performers/friday/bot.mjs
git commit -m "feat(friday): callback_query handler + queue drain + /status queue depth (T13)"
```

---

## Task 14: PM2 cutover + manual smoke

**Files:** (none — runtime swap + verification)

- [ ] **Step 1: Final lint + tests**

```bash
cd /root/bot-circus
./bin/circus-lint --performer friday --format text
cd performers/friday && npm test 2>&1 | tail -10
```

Expected: lint clean, 9/9 tests pass.

- [ ] **Step 2: PM2 reload**

```bash
pm2 reload friday-bot 2>&1 | tail -5
sleep 8
pm2 describe friday-bot 2>&1 | grep -E "status|restart|uptime" | head
pm2 logs friday-bot --err --lines 15 --nostream 2>&1 | tail -20
pm2 logs friday-bot --out --lines 15 --nostream 2>&1 | tail -20
```

Expected: friday-bot online, 0 unstable restarts, recent out log shows boot. No SyntaxError or import error.

- [ ] **Step 3: Persist PM2**

```bash
pm2 save 2>&1 | tail -3
```

- [ ] **Step 4: Manual smoke checklist (user-driven via Telegram)**

Send these messages to friday and verify each behavior:

- [ ] Single message ("hello") → `🌀 #1 spawned:` then `#1 ...` quote-reply
- [ ] Second message while #1 still running → inline keyboard appears
- [ ] Tap **Parallel** → `🌀 #2 spawned`
- [ ] Tap **Queue** on a third → `Queued.` ack, spawn auto when slot frees
- [ ] `/p draft email` while running → spawns immediately, no keyboard
- [ ] `/status` → shows running + queued
- [ ] `/cancel 1` → `🛑 #1 cancelled.`
- [ ] `/cancel all` → ack with count
- [ ] 6 rapid `/p` prompts → 6th gets `⚠️ at capacity`

For each behavior, note PASS or FAIL.

- [ ] **Step 5: Rollback path if anything broken**

If any check fails:
```bash
git checkout master -- performers/friday/bot.mjs
pm2 reload friday-bot
pm2 save
```

This reverts bot.mjs to pre-feature state without losing TaskPool module + tests.

- [ ] **Step 6: Tag the feature complete (if all checks PASS)**

```bash
cd /root/bot-circus
git tag -a friday-parallel-v1 -m "Friday parallel tasks v1 (5-concurrent + commands)"
git log --oneline -5
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Implementing task(s) |
|---|---|
| §2 goals 1 (5 concurrent) | T1, T2, T8 (cap enforcement) |
| §2 goal 2 (inline keyboard) | T12, T13 |
| §2 goal 3 (`/p` shortcut) | T12 |
| §2 goal 4 (`/status`, `/cancel`) | T10, T11, T13 |
| §2 goal 5 (Telegram reply-quote) | T9 (onResult), T12 (spawn reply), T13 (queue drain reply) |
| §2 goal 6 (task IDs) | T1, all reply paths |
| §5 architecture | T9 |
| §6.1 task-pool.mjs API | T1–T8 |
| §6.2 bot.mjs changes | T9–T13 |
| §6.3 `/status` output | T10, T13 |
| §6.4 `/cancel` | T11 |
| §6.5 reply formatting | T9 |
| §7 data flow | exercised by T14 manual smoke |
| §8 error handling | T9 (onError), T11 (unknown id), T12 (pool-full), T13 (expired pending) |
| §9 testing — 8 unit tests | T1–T8 (9 actually shipped, one extra) |
| §9 manual smoke | T14 |
| §9 acceptance | T14 |

No gaps.

**2. Placeholder scan:** No "TBD", "implement later", or "add appropriate handling" — every step shows the actual code.

**3. Type/name consistency:**

- `TaskPool({ maxConcurrent, workerFactory, logger, onResult, onError })` — consistent across all tasks
- `spawn(prompt, ctx, replyToMessageId) → { taskId, accepted }` — consistent
- `cancel(taskId) → boolean`, `cancelAll() → number`, `status() → Array<...>`, `runningCount()`, `isFull()` — consistent
- `mockWorkerFactory()` returns a factory function with `.created` array — consistent in T1, T3, T4, T6, T7, T8
- `pendingPrompts: Map<message_id, { ctx, text, ts }>` — consistent in T9, T12, T13
- `queueWaiting: Array<{ ctx, text }>` — consistent in T13
- Callback data format `"q:<msgId>"` / `"p:<msgId>"` — consistent T12 + T13

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-friday-parallel-tasks.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
