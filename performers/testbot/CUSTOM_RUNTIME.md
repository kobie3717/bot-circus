# TestBot — Custom Runtime Justification

TestBot uses `runtime: "custom"` because:

- Specialist bot with hardcoded disk monitoring logic (no shared orchestrator needed)
- No Claude CLI dependency — pure Node.js + grammy
- Minimal footprint: single bot.mjs with disk/memory reporting and 30-min proactive alerts

## Reviewer signoff
- Author: kobie3717
- Date: 2026-06-07
