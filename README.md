# Bot-Circus 🎪

> Run unlimited Telegram bots on one VPS, each with its own persona and memory. Some share a hive mind. Others stay ringfenced. All independent.

**Status:** Spec phase — implementation coming soon.

## What is Bot-Circus?

Bot-Circus is a multi-bot Telegram orchestrator designed to run **up to 100 independent AI-powered bots** on a single VPS, each powered by [Claude Code CLI](https://claude.com/claude-code) or any LLM subprocess.

Each bot is a **performer** with its own:
- Telegram token and channel
- Persona files (SOUL.md, IDENTITY.md, USER.md)
- Workspace and memory
- Independent session — no crosstalk unless you want it

Bots can join **troupes** to share memory (hive mind), or stay **ringfenced** (fully isolated).

## Why?

Existing multi-bot frameworks treat bots as dumb scripts. Bot-Circus treats each bot as a **full AI agent** with persistent memory, a distinct personality, and optional shared context with teammates.

Use cases:
- Personal assistant swarm (work bot + home bot + research bot, all sharing your context)
- Customer support troupe (5 bots covering different products, shared knowledge base)
- AI character roleplay (each bot a different character, memory per character)
- Multi-tenant SaaS (one bot per customer, ringfenced)

## Three-Tier Memory Model

| Scope | Description | Use Case |
|-------|-------------|----------|
| **Global** | Shared across all bots | Reference docs, common tools |
| **Troupe** | Shared within a group | Team knowledge, customer context |
| **Bot-Local** | Ringfenced per bot | Private conversations, isolation |

## Architecture (at a glance)

```
┌─────────────────────────────────────────────┐
│          Bot-Circus Orchestrator            │
│          (Single Node.js process)           │
└──────────────────┬──────────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
  ┌───▼───┐   ┌───▼───┐    ┌───▼───┐
  │ Bot 1 │   │ Bot 2 │    │ Bot N │
  │@claw  │   │@paw   │    │@...   │
  └───┬───┘   └───┬───┘    └───┬───┘
      │           │            │
      └─────┬─────┘            │
            │                  │
       [troupe:A]         [ringfenced]
       shared memory       own memory
```

One orchestrator, N bot tokens, fair worker pool of Claude CLI subprocesses.

## Quick Start (planned)

```bash
# Install
npm install -g bot-circus

# Add your first performer
circus add-performer --name claw --token $BOT_TOKEN --persona ./personas/claw.md

# Add a troupe-mate that shares memory
circus add-performer --name paw --token $BOT_TOKEN_2 --troupe personal

# Start the circus
circus start

# Tail logs
circus logs claw
```

## Inspiration & Prior Art

Bot-Circus is inspired by patterns from:
- **[Ruflo](https://github.com/ruvnet/ruflo)** — 3-scope memory model
- **[OpenClaw](https://github.com/kobie3717/openclaw)** — workspace-per-session pattern
- **[multi-bot-telegram-system](https://github.com/kostola/multi-bot-telegram-system)** — clean JSON config

None of these combined Telegram multi-bot + Claude Code subprocess + grouped memory. So we built it.

## Roadmap

- [ ] **Phase 1 (MVP)** — 5 bots, global + bot-local memory, basic CLI
- [ ] **Phase 2** — Troupe memory groups, 20 bots
- [ ] **Phase 3** — Worker pool, rate limiting, 100 bots
- [ ] **Phase 4** — Admin dashboard, persona templates, hot-reload

See [SPEC.md](./SPEC.md) for the full technical spec.

## License

MIT

## Author

Built by [Kobus](https://github.com/kobie3717) with [Claw](https://github.com/kobie3717) 🦀

Part of the kobie3717 open-source ecosystem:
- [WaSP](https://www.npmjs.com/package/wasp-protocol) — WhatsApp Session Protocol
- [baileys-antiban](https://github.com/kobie3717/baileys-antiban) — Anti-ban for Baileys
- [PayBridge](https://www.npmjs.com/package/paybridge) — Unified payments SDK
- [AI-IQ](https://github.com/kobie3717/ai-iq) — SQLite-backed AI memory
- **Bot-Circus** — You are here 🎪
