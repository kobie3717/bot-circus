---
name: circus
description: Multi-bot Telegram orchestrator with per-bot persona, shared/ringfenced memory, and passport-gated access control. Use for running multiple AI agents with different personalities that can collaborate via shared memory or stay isolated.
---

# Bot-Circus 🎪

Run unlimited Telegram bots on one VPS, each with its own persona and memory. Some share a hive mind. Others stay ringfenced. All powered by Claude.

## When to Use

Use Bot-Circus when you need to:

- **Run multiple AI bots** as independent agents, each with its own Telegram channel
- **Share memory between bots** (hive mind via troupes) or **ringfence** them (per-bot isolation)
- **Gate access** to sensitive memory by requiring passport credentials (pairs with `ai-iq`)
- **Scale to dozens of agents** on one VPS without per-bot servers
- **Give each bot a distinct personality** via persona files (SOUL.md, IDENTITY.md, USER.md)

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

## The Claw Stack: Memory → Credential → Access

Bot-Circus is the **access-control layer** of a larger pipeline. When paired with [`ai-iq`](https://github.com/kobie3717/ai-iq), you get:

```
1. Bot Alice does work → AI-IQ stores memories → validated via dream mode
2. AI-IQ's Passport issues Alice a "code:expert" credential (W3C VC, Ed25519-signed)
3. Bot Bob presents Alice's credential → gains read access to Alice's code namespace
4. Bob answers a question using Alice's earned knowledge
5. All access is capability-based, deny-by-default, logged and auditable
```

### Wing/Room Namespaces

Memory lives in **wings** (broad) and **rooms** (specific). Bot-Circus uses the same wing/room model as AI-IQ, so memories stored by one bot can be scoped-access by another.

```bash
# Bot Alice stores code-expert memories in the "code.internal" wing/room
MEMORY_PASSPORT="<alice_credential>" memory-tool add learning \
  "Auth service uses JWT rotation every 15 min" \
  --wing code --room internal

# Bot Bob with a valid "code:expert" passport can read them
MEMORY_PASSPORT="<bob_credential>" memory-tool search "JWT rotation" \
  --wing code --room internal
```

### Predefined Access Rules (from AI-IQ)

| Wing / Room | Who Can Access |
|---|---|
| `finance.payments` | Requires `finance:expert` credential |
| `security.secrets` | Requires `security:expert` credential |
| `devops.production` | Requires `devops:expert` credential |
| `code.internal` | Requires `code:expert` credential |
| `general.public` | No credential required (default) |

## Use Cases

- **Personal assistant swarm**: Work bot + home bot + research bot, all in one troupe sharing your context
- **Customer support troupe**: 5 bots covering different products, shared knowledge base, access-gated sensitive procedures
- **AI character roleplay**: Each bot a different character, ringfenced per character
- **Multi-tenant SaaS**: One bot per customer, fully ringfenced
- **Development team**: Code review bot + docs bot + CI/CD bot sharing project context, with security-scoped secrets

## Why Bot-Circus?

Existing multi-bot frameworks treat bots as dumb scripts. Bot-Circus treats each bot as a **full AI agent** with:

- Persistent memory (via `ai-iq`)
- A distinct personality (via persona files)
- Optional shared context with teammates (troupes)
- Verifiable trust boundaries (passport-gated access)

Nobody else ships multi-agent orchestration with **capability-based memory access control** built in.

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
