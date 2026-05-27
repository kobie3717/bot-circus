# WA Drone — Custom Runtime Justification

WA Drone uses `runtime: "custom"` because its runtime carries bespoke logic:

- 36KB `bot.mjs` — grammy long-poll loop with WhatsApp bridge integration, email handling, message routing, and command parsing.
- Multi-feature footprint — email (SMTP/IMAP), inbox aggregation, voice transcription, WhatsApp Baileys bridge, action confirmation, dashboards.
- Shared library imports — `bot-circus/lib/` modules (dedupe, dispatch, mcp, learning, token-budget, proactive-alerts, queue, tasks, context, handoff, shell-guard) via relative path.

Refactoring into the shared orchestrator is out of scope for slice D. Audit re-review at end of slice D.

## Reviewer signoff
- Author: kobie3717
- Date: 2026-05-27
- Slice: D (wa-drone is the third bot migrated, after webbs and friday)
