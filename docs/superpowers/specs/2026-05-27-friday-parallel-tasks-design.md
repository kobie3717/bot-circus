# Friday Parallel Tasks — Design

**Date:** 2026-05-27
**Status:** Approved for planning
**Scope:** Friday performer only (slice D-scope; other bots adopt later if pattern holds)
**Branch:** `feat/friday-parallel-tasks`

---

## 1. Problem

Friday processes user messages strictly serial per user — `busyUsers` Set + `userQueues` Map in `bot.mjs`. If the user sends a second prompt while the first is running, it queues behind it and waits. There is no way to run two independent tasks concurrently from a single user.

For a power-user workflow ("design a hero section AND draft an email at the same time"), this is a real bottleneck. Friday's worker pool (via `bot-circus/lib/dispatch.mjs`) already supports multiple concurrent Claude CLI subprocesses; the limitation is purely in the bot.mjs gate.

## 2. Goals

1. Allow up to **5 concurrent tasks** for the friday bot.
2. When a second message arrives while a task is running, ask the user inline: queue or parallel.
3. Provide explicit-parallel shortcut (`/p <prompt>`) for power-users to bypass the prompt.
4. Provide control commands: `/status`, `/cancel <id>`, `/cancel all`.
5. Telegram quote-reply on every bot response so the user sees which task each reply belongs to.
6. Task IDs (monotonic, per-process) prefixed on every reply for `/cancel` references.

## 3. Non-goals

- Other bots — friday only in this slice. Pattern can spread to webbs, 007, claw, octo, wa-drone after validation.
- Persistence across restart. Restart = clean slate.
- Token-quota accounting per task (separate concern; existing token-budget module covers global).
- Sub-task hierarchies (a task spawning another task counts as one slot).
- Cross-user concurrency tuning (friday is single-user via `ALLOWED_USER_ID`).
- Cancellation via Telegram callback button on each task message (could be future polish).

## 4. Locked decisions (from brainstorm)

| # | Decision | Choice |
|---|---|---|
| Q1 | Scope | **Friday only** for v1 |
| Q2 | Concurrency trigger | **Hybrid inline prompt** ("queue / parallel") on second message while busy. `/p <prompt>` is explicit-parallel bypass. |
| Q3 | Concurrency cap | **5 concurrent at the bot level** (not per-user — friday is single-allowed-user). |
| Q4 | Reply disambiguation | **Task ID prefix (`#N`) + Telegram reply-quote** to original prompt. |
| Q5 | Control commands | `/status`, `/cancel <id>`, `/cancel all`. (Skipped `/queue`, `/wait`.) |

## 5. Architecture

```
inbound Telegram message
     ↓
bot.on('message:text')
     ├── /status      → showStatus(ctx)
     ├── /cancel ...  → cancelHandler(ctx, text)
     ├── /p <prompt>  → spawnTask (bypass prompt)
     └── else         → if pool empty → spawnTask
                       else           → reply with inline keyboard (queue / parallel)

callback_query → action='q' → queueTask(original)
                action='p' → spawnTask(original.ctx, original.text)

TaskPool (lib/task-pool.mjs):
  spawn(prompt, ctx, replyToMessageId)
  cancel(taskId)
  cancelAll()
  status()
  runningCount() / isFull()
  internal: Map<taskId, TaskRecord>, monotonic counter, maxConcurrent
  delegates Claude CLI work to existing dispatch.mjs worker pool
```

**Single new file:** `bot-circus/performers/friday/task-pool.mjs` (~100 lines)
**Modified:** `bot-circus/performers/friday/bot.mjs` (remove serial gate, wire TaskPool, add command handlers and callback handler)

## 6. Components

### 6.1 `task-pool.mjs` — public API

```js
export class TaskPool {
  constructor({ maxConcurrent = 5, logger, onResult, onError })
  spawn(prompt, ctx, replyToMessageId) → { taskId, accepted: boolean }
  cancel(taskId) → boolean
  cancelAll() → number
  status() → Array<{ id, prompt, startedAt, elapsedMs, pid? }>
  runningCount() → number
  isFull() → boolean
}
```

Each `TaskRecord` holds: `id`, truncated `prompt` (first 60 chars for `/status`), `ctx`, `replyToMessageId`, `startedAt`, `worker` handle from `dispatch.mjs`, optional `pid` for SIGTERM on cancel.

The TaskPool **does not own** the Claude CLI subprocess directly. It delegates spawn/kill to the existing `dispatch.mjs` worker pool and adds task-level metadata + lifecycle on top.

### 6.2 `bot.mjs` changes

**Remove**: `busyUsers`, `userQueues`, `processNext` (the serial gate).

**Add**:
```js
import { TaskPool } from './task-pool.mjs';
const pool = new TaskPool({
  maxConcurrent: 5,
  logger,
  onResult: (task, result) => sendReply(task, result),
  onError: (task, err) => sendError(task, err)
});
const pendingPrompts = new Map(); // message_id → { ctx, text, ts }
// Auto-evict pendingPrompts entries older than 5 min.
```

**Inbound text handler** (replaces existing busy/queue logic):
```js
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text === '/status')          return showStatus(ctx);
  if (text.startsWith('/cancel ')) return cancelHandler(ctx, text);

  const explicitParallel = text.startsWith('/p ');
  const prompt = explicitParallel ? text.slice(3).trimStart() : text;

  if (pool.runningCount() === 0 || explicitParallel) {
    if (pool.isFull()) {
      return ctx.reply(`⚠️ Bot at capacity (${pool.runningCount()}/5). Try /status or /cancel one first.`);
    }
    return spawnTask(ctx, prompt);
  }

  // Pool not empty and user did not /p — ask
  pendingPrompts.set(ctx.message.message_id, { ctx, text, ts: Date.now() });
  return ctx.reply(
    `🤔 ${pool.runningCount()}/5 task(s) running. Queue this or run in parallel?`,
    { reply_markup: { inline_keyboard: [[
      { text: 'Queue (wait for current)', callback_data: `q:${ctx.message.message_id}` },
      { text: 'Parallel (spawn now)',     callback_data: `p:${ctx.message.message_id}` }
    ]] } }
  );
});
```

**Callback handler** (new):
```js
bot.on('callback_query', async (ctx) => {
  const [action, msgIdStr] = ctx.callbackQuery.data.split(':');
  const msgId = Number(msgIdStr);
  const original = pendingPrompts.get(msgId);
  if (!original) return ctx.answerCallbackQuery({ text: 'Prompt expired.' });
  pendingPrompts.delete(msgId);

  if (action === 'q') {
    queueTask(original.ctx, original.text);
    await ctx.answerCallbackQuery({ text: 'Queued.' });
  } else if (action === 'p') {
    if (pool.isFull()) {
      await ctx.answerCallbackQuery({ text: 'Pool full.' });
    } else {
      spawnTask(original.ctx, original.text);
      await ctx.answerCallbackQuery({ text: 'Spawned.' });
    }
  }
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
});
```

**`spawnTask`**:
```js
function spawnTask(ctx, prompt) {
  const { taskId, accepted } = pool.spawn(prompt, ctx, ctx.message.message_id);
  if (!accepted) {
    return ctx.reply(`⚠️ Pool full.`, { reply_parameters: { message_id: ctx.message.message_id } });
  }
  ctx.reply(
    `🌀 #${taskId} spawned: "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`,
    { reply_parameters: { message_id: ctx.message.message_id } }
  );
}
```

### 6.3 `/status` output format

```
📋 Running tasks: 3/5
  #42  3m12s  build hero section with parallax …
  #43  47s    write follow-up email to Acme
  #45  12s    /p draft README for new repo

Queued: 1
  → "now make that mobile-first"
```

### 6.4 `/cancel` semantics

- `/cancel 42` → calls `pool.cancel(42)`. If task exists: SIGTERM subprocess via `dispatch.mjs` cancel hook, reply-quote the task's original message: `🛑 #42 cancelled`. If not: `No task #42.`
- `/cancel all` → `pool.cancelAll()`, sends summary: `🛑 Cancelled 3 tasks (#42, #43, #45).`

### 6.5 Reply formatting

All task replies use Telegram `reply_parameters: { message_id: <original> }` to quote-reply. ID prefix `#N` on streaming chunks AND final results so user can `/cancel N` mid-stream.

## 7. Data flow

| Scenario | Path |
|---|---|
| Cold path (pool empty) | msg → spawnTask → record → dispatch → stream chunks → reply-quote with `#N` |
| Hot path (busy) | msg → inline keyboard → user picks → spawnTask OR queueTask |
| Explicit parallel | `/p ...` → bypass keyboard → spawnTask immediately |
| Pool full | reply: `⚠️ at capacity`; user must `/cancel` or wait |
| `/status` | `pool.status()` + `pendingQueue` → format text → reply |
| `/cancel N` | `pool.cancel(N)` → SIGTERM via dispatch → onError fires cancellation reply |
| Bot restart | in-process state lost; user re-submits |

## 8. Error handling

| Failure | Response |
|---|---|
| Claude CLI subprocess crash | `onError` → quote-reply: `❌ #42 failed: <err.message>` → record removed |
| Subprocess hangs > CLAUDE_TIMEOUT | dispatch.mjs handles → propagates to onError |
| User cancels mid-stream | SIGTERM → no further chunks → cancellation message |
| Cancel non-existent task | `No task #999.` |
| `pendingPrompts` map grows | 5-minute TTL eviction on each insert |
| Two cards tapped on same msg | first wins; second sees expired |
| Queue grows large | no hard cap in v1; `/status` shows depth |
| Concurrent SQLite memory writes | better-sqlite3 WAL serializes append-only writes; no logical conflict |

Explicit non-behaviors:

- No retry on task failure.
- No cross-task communication.
- No per-user rate limit (single-user bot per ALLOWED_USER_ID).
- No persistence across restart.

## 9. Testing

### 9.1 Unit tests — `performers/friday/tests/task-pool.test.js`

Pure-JS tests against TaskPool. Mock dispatch.mjs with an injectable `workerFactory` constructor option so tests don't spawn real Claude subprocesses.

```
test('spawn returns sequential taskIds')
test('spawn rejects when pool full')
test('cancel removes task from running set + invokes worker.kill')
test('cancelAll removes all + returns count')
test('status returns running tasks with elapsed ms')
test('worker resolves → onResult fires + record removed')
test('worker rejects → onError fires + record removed')
test('runningCount and isFull reflect Map size')
```

8 tests. ~150 lines including a `MockWorker` helper.

### 9.2 Integration smoke (manual, post-cutover)

- [ ] Single message → `🌀 #1 spawned` → result `#1 …` quote-replies original
- [ ] Second message while #1 running → inline keyboard appears
- [ ] Tap **Parallel** → `🌀 #2 spawned`; #2 runs alongside #1
- [ ] Tap **Queue** on third → queued; spawns automatically when slot frees
- [ ] `/p draft email` while running → spawns immediately, no keyboard
- [ ] `/status` → shows running + queued with elapsed times
- [ ] `/cancel 2` → `🛑 #2 cancelled`
- [ ] `/cancel all` → all stopped
- [ ] 6 rapid `/p` prompts → 6th gets `⚠️ at capacity`

### 9.3 Acceptance

Done when:

1. `task-pool.mjs` module + 8 unit tests green.
2. `bot.mjs` uses TaskPool — old `busyUsers`/`userQueues` removed.
3. Inline keyboard appears on second-message-while-busy.
4. `/p`, `/status`, `/cancel <id>`, `/cancel all` all work end-to-end on the live bot.
5. Quote-reply threading correct (final + streaming chunks).
6. PM2 friday-bot runs stable for 10+ minutes with mixed serial + parallel traffic.
7. Contract lint still clean (no R-rule violations from new files).

## 10. Out-of-scope follow-ups

- Adopt the same pattern on other custom-runtime bots (webbs, claw, 007, octo, wa-drone) as their migrations land.
- Add per-task cancellation button as inline keyboard on each task's reply.
- Token-quota gating per task (interact with token-budget module).
- Persist active tasks across bot restart (SQLite-backed task table).
- Web UI for live task monitoring.

## 11. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Concurrent Claude subprocesses exceed token quota | Existing token-budget module covers global limits; 5-cap is conservative |
| User confused by interleaved responses | Quote-reply + `#N` prefix provides clear thread per task |
| `pendingPrompts` memory leak under spam | 5-min TTL + 1000-entry size cap; YAGNI on smarter eviction |
| dispatch.mjs cancel hook missing | Verify in implementation; if absent, add `kill()` to worker handle |
| User accidentally drains pool with `/p` spam | `isFull()` check rejects with friendly message |
| TaskPool state lost on restart | Documented behavior; rare event for stable bot |
