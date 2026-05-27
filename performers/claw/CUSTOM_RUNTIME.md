# Claw — Custom Runtime + Sidecar Justification

Claw runs in `runtime: "sidecar"` mode because:

- 1919-line `bot.mjs` is the main Telegram bot loop with Claw 🦀 persona ("AI super assistant. Cool, calculated, concise.").
- Three sidecar processes run alongside the main bot, each as its own PM2 entry:
  - `email` (email-reader.mjs) — IMAP polling for inbox
  - `monitor` (monitor.mjs) — system health monitoring
  - `whatsapp` (whatsapp.mjs) — Baileys WhatsApp bridge listener
- All sidecars share the workspace cwd, .env, and data/ directory.
- bot.mjs imports shared library modules from `bot-circus/lib/` via `../../lib/`.

Refactoring into shared orchestrator is out of scope for slice D. Sidecar mode is the cleanest fit for claw's multi-process architecture.

## Reviewer signoff
- Author: kobie3717
- Date: 2026-05-27
- Slice: D (6th and final bot migrated, after webbs/friday/wa-drone/octo/007)
