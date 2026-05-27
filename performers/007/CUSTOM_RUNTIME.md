# 007 — Custom Runtime Justification

007 uses `runtime: "custom"` because:

- 848-line `bot.mjs` with intel-gathering specialist commands (/intel, /scavenge, /watch, /watchlist, /brief, /leads, /competitors, /mentions, /report).
- Inline system prompt with 007 persona ("AI intelligence agent. Cool, calculated, concise.") — extracted to SOUL.md.
- 13 symlinks to `/root/agent-core/` shared modules (now sourced from `bot-circus/lib/` via backward-compat symlinks; imports rewritten to `../../lib/` in this task).

Refactoring into shared orchestrator out of scope for slice D.

## Reviewer signoff
- Author: kobie3717
- Date: 2026-05-27
- Slice: D (5th bot migrated, after webbs/friday/wa-drone/octo)
