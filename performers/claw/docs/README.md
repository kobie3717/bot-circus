# Claw Docs

- **ARCHITECTURE.md** — system design
- **COMMAND_REFERENCE.md** — all Telegram bot commands
- **QUICKSTART.md** — bring-up from scratch
- **DEPLOYMENT.md** — deploy + restart procedures

**Note:** Ported from legacy `/root/claude-telegram-bot/` on 2026-05-28. Paths adapted to bot-circus performer layout.

**Live code:** `/root/bot-circus/performers/claw/`

**PM2:** `claw-bot` (webhook mode, port 7710, https://whatshubb.co.za/webhook/claw)

**Key Changes from Legacy:**
- Webhook mode (replaces polling)
- Per-chat FIFO queue with `/pending` and `/stop` commands
- Telegram dedupe via `dedupe.mjs` (LRU+TTL 30s)
- Working directory: `/root/claw-workspace`
- PM2 logs: `/var/log/pm2/`
- Sessions DB: `/root/bot-circus/performers/claw/data/sessions.db`
- Part of bot-circus performer ecosystem

**Other Performers:**
- octo (GitHub ops)
- friday (proactive monitoring)
- 007 (security)
- wa-drone (WhatsApp automation)
- webbs (web scraping)

**Shared Libraries:** `/root/bot-circus/lib/`
