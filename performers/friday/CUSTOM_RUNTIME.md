# Friday — Custom Runtime Justification

Friday uses `runtime: "custom"` because the runtime carries substantial bespoke logic that does not fit the orchestrator's shared dispatch model:

- **52KB `bot.mjs`** — grammy long-poll loop, message routing, command parsing, response formatting, streaming updates, and integration with 15+ feature modules.
- **Multi-feature footprint** — email (SMTP/IMAP), inbox aggregation, voice transcription, WhatsApp bridge, action confirmation flow, dashboards, alerts, learning, MCP, task queue.
- **Inline system prompt** — extracted to SOUL.md in this chunk and loaded at startup.
- **Shared library imports** — `bot-circus/lib/` modules (dedupe, dispatch, mcp, learning, token-budget, proactive-alerts, queue, tasks, context, handoff, shell-guard, gem2-gateway) accessed via relative path; previously symlinked from `/root/agent-core/` (consolidated in slice D-F1).

Refactoring friday into the shared orchestrator's model would require rewriting against a yet-unfinalized shared interface and replicating friday-specific behaviors (email pipeline, WhatsApp bridge, action confirmation, dashboards). That work is not in scope for the slice D migration.

## Reviewer signoff

- Author: kobie3717
- Date: 2026-05-27
- Slice: D (friday is the second bot migrated)
- Audit re-review: at end of slice D when all 5 remaining bots have migrated.
