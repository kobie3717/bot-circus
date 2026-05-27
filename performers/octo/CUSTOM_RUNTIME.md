# Octo — Custom Runtime Justification

Octo uses `runtime: "custom"` because:

- Largest bot.mjs of the migrated set (over 9000 lines total across workspace) with extensive feature surface.
- Dual-mode runtime: grammy long-poll AND a webhook HTTP server (uses `http` + `webhookCallback` from grammy).
- Multi-feature footprint: email, inbox, dashboards, learning, proactive alerts, action confirmation, voice, WhatsApp bridge, task scheduler, queue, handoff, context tracking.
- System prompt loaded at runtime from WORKSPACE-relative files (SOUL.md, IDENTITY.md, USER.md, AGENTS.md, MEMORY.md, TOOLS.md, HEARTBEAT.md).

Refactoring into shared orchestrator is out of scope for slice D.

## Reviewer signoff
- Author: kobie3717
- Date: 2026-05-27
- Slice: D (4th bot migrated, after webbs/friday/wa-drone)
