# Webbs — Custom Runtime Justification

Webbs uses `runtime: "custom"` (not `shared`) because its runtime carries substantial bespoke logic that does not fit the orchestrator's shared dispatch model:

- **443-line `bot.mjs`** with grammy long-poll loop, per-user message queue (busy/queued state), session management, image-download flow, and command handlers.
- **`sessions.mjs`** — TTL-based session tracker with custom expiration cleanup.
- **`memory-bridge.mjs`** — ai-iq integration with automatic conversation storage and context retrieval.
- **`circus-bridge.mjs`** — registers webbs with the circus commons, joins rooms, polls task inbox, handles preferences (read from `bot-circus/lib/`).
- **Inline system prompt** (≈100 lines describing webbs as a frontend design specialist) — extracted to SOUL.md in chunk 2 and loaded at startup.

Refactoring webbs into the shared orchestrator's queue/dispatch model would require rewriting the runtime against a yet-unfinalized shared message-handling interface, plus replicating webbs-specific behaviors (image flow, design-mode commands, session TTL semantics) in shared code. That work is not in scope for the slice C migration; it is a candidate for a later refactor.

## Reviewer signoff

- Author: kobie3717
- Date: 2026-05-26
- Slice: C (first bot migration)
- Audit re-review: scheduled at slice D completion, when the other 5 bots have migrated and the shared runtime's surface area is clear enough to evaluate whether webbs could collapse into it.
