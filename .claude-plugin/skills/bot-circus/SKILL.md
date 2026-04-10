---
name: bot-circus
description: Multi-bot Telegram orchestrator that runs unlimited Claude-powered bots on one VPS, each with its own persona and either shared (troupe) or ringfenced memory via symlinked workspaces. The runtime layer of the Claw Stack — pairs naturally with `ai-iq` (long-term memory) and `circus` (agent commons + trust) but has no hard dependencies. Use for running multiple AI agents with different personalities that can collaborate via shared memory or stay isolated.
---

# Bot-Circus 🎪

Run unlimited Telegram bots on one VPS, each with its own persona and memory. Some share a hive mind. Others stay ringfenced. All powered by Claude.

## When to Use

Use Bot-Circus when you need to:

- **Run multiple AI bots** as independent agents, each with its own Telegram channel
- **Share memory between bots** (hive mind via troupes) or **ringfence** them (per-bot isolation)
- **Scale to dozens of agents** on one VPS without per-bot servers
- **Give each bot a distinct personality** via persona files (SOUL.md, IDENTITY.md, USER.md)
- **Pair with `ai-iq`** (optional) to give each bot long-term memory, or with **`circus`** (optional) for cross-bot federation and trust

## Core Concepts

### Performers (Bots)
Each **performer** is a full Claude Code agent with:
- Its own Telegram bot token
- Its own persona files (how it thinks and talks)
- Its own workspace and memory
- An isolated Claude Code session per message

### Troupes (Shared Memory Groups)
A **troupe** is a group of bots that share a memory pool. When bot A in a troupe learns something, bot B can recall it. Implemented via symlinks — zero disk overhead.

### Ringfencing (Isolation)
A bot outside any troupe is **ringfenced** — its memory is fully private. No crosstalk, no leakage.

### Three-Tier Memory Model

| Scope | Description | Use Case |
|-------|-------------|----------|
| **Global** | Shared across all bots | Reference docs, common tools |
| **Troupe** | Shared within a group | Team knowledge, customer context |
| **Bot-Local** | Ringfenced per bot | Private conversations, isolation |

## Core Commands

All commands use the `circus` CLI (installed with `npm install -g bot-circus`).

### Managing Performers

```bash
# Add a new bot
circus add-performer --name alice --token $TG_TOKEN_ALICE --persona /path/to/alice-persona

# List all bots
circus list

# Start/stop/restart
circus start alice
circus stop alice
circus restart alice

# View logs
circus logs alice --follow

# Remove a bot
circus rm-performer alice
```

### Managing Troupes

```bash
# Create a shared-memory group
circus add-troupe dev-team

# Add bots to the troupe
circus join-troupe alice dev-team
circus join-troupe bob dev-team

# See who's in a troupe
circus troupe-members dev-team

# Remove a bot from its troupe (back to ringfenced)
circus leave-troupe alice
```

### Orchestrator

```bash
# Start the orchestrator (runs all bots)
circus serve

# Real-time dashboard
circus top

# Stats and health
circus stats
circus health
```

## The Claw Stack: Runtime Layer

Bot-Circus is the **runtime layer** of the Claw Stack. It runs the bots; the other layers are optional brains you can plug in:

| Layer | Plugin | Role |
|---|---|---|
| **Memory** | [`ai-iq`](https://github.com/kobie3717/ai-iq) | Per-bot SQLite long-term memory, FSRS decay, wing/room scoping |
| **Commons** | [`circus`](https://github.com/kobie3717/circus) | Federated agent discovery, topic rooms, passport-based trust |
| **Runtime** | `bot-circus` (this plugin) | Telegram orchestration, personas, troupes, symlink shared memory |

Bot-Circus ships with **symlink-based shared memory** for troupes — bots in the same troupe point at the same `MEMORY.md` / `memory/` directory, so anything one bot writes is instantly visible to the others. No credentials required.

If you want long-term SQLite memory per bot, install `ai-iq` into each workspace and drive it from the bot's Claude Code session. If you want federated cross-VPS discovery and trust, pair with `circus`. Neither is auto-wired — they're complementary tools, not hard dependencies.

## Use Cases

- **Personal assistant swarm**: Work bot + home bot + research bot, all in one troupe sharing your context
- **Customer support troupe**: 5 bots covering different products, shared knowledge base
- **AI character roleplay**: Each bot a different character, ringfenced per character
- **Multi-tenant SaaS**: One bot per customer, fully ringfenced
- **Development team**: Code review bot + docs bot + CI/CD bot sharing project context

## Why Bot-Circus?

Existing multi-bot frameworks treat bots as dumb scripts. Bot-Circus treats each bot as a **full Claude Code agent** with:

- A distinct personality (via persona files — SOUL.md, IDENTITY.md, USER.md)
- Its own workspace and session, isolated per message
- Optional shared context with teammates via symlinked troupes
- Plug-in friendly — drop `ai-iq` in for long-term memory, pair with `circus` for federation

Nobody else ships a multi-agent Telegram runtime that treats each bot as a full Claude Code session with persona files and optional symlinked shared memory.

## Installation

```bash
# Install bot-circus CLI
npm install -g bot-circus

# Install ai-iq for memory backend (recommended)
pip install ai-iq

# Or both as Claude Code plugins
/plugin marketplace add kobie3717/bot-circus
/plugin marketplace add kobie3717/ai-iq
```

## Quick Start

```bash
# 1. Create a troupe
circus add-troupe my-team

# 2. Add two bots
circus add-performer --name alice --token $ALICE_TOKEN
circus add-performer --name bob --token $BOB_TOKEN

# 3. Join them to the troupe
circus join-troupe alice my-team
circus join-troupe bob my-team

# 4. Start the orchestrator
circus serve

# 5. Watch the dashboard
circus top
```

Now Alice and Bob share memory. Talk to Alice on Telegram, and Bob will remember the conversation.

## Documentation

- [GitHub](https://github.com/kobie3717/bot-circus)
- [Quickstart](https://github.com/kobie3717/bot-circus/blob/main/QUICKSTART.md)
- [Spec](https://github.com/kobie3717/bot-circus/blob/main/SPEC.md)
- [Examples](https://github.com/kobie3717/bot-circus/blob/main/EXAMPLES.md)
- [AI-IQ (memory + credentials)](https://github.com/kobie3717/ai-iq)
