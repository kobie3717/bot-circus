# Bot-Circus 🎪

> Run unlimited Telegram bots on one VPS, each with its own persona and memory. Some share a hive mind. Others stay ringfenced. All powered by Claude.

**Status:** Production-ready MVP

> **Part of the Claw Stack:** Bot-Circus is the **runtime layer** of a larger pipeline.
> Each bot workspace is a full Claude Code session with its own persona and memory;
> workspaces can be symlinked into shared "troupes" or kept ringfenced for isolation.
> Pairs naturally with [`ai-iq`](https://github.com/kobie3717/ai-iq) (drop-in long-term
> memory for each bot) and [`circus`](https://github.com/kobie3717/circus) (agent commons
> for cross-bot discovery and trust), but bot-circus runs standalone and has zero
> hard dependencies on either.
>
> Install the whole stack in one command:
> ```
> /plugin marketplace add kobie3717/claw-stack
> ```
> Or just this plugin:
> ```
> /plugin marketplace add kobie3717/bot-circus
> ```

## What is Bot-Circus?

Bot-Circus is a multi-bot Telegram orchestrator that runs **up to 100 independent AI-powered bots** on a single VPS, each powered by [Claude Code CLI](https://claude.com/claude-code).

Each bot is a **performer** with its own:
- Telegram token and channel
- Persona files (SOUL.md, IDENTITY.md, USER.md)
- Workspace and memory
- Independent session — no crosstalk unless you want it

Bots can join **troupes** to share memory (hive mind), or stay **ringfenced** (fully isolated).

## Why?

Existing multi-bot frameworks treat bots as dumb scripts. Bot-Circus treats each bot as a **full AI agent** with persistent memory, a distinct personality, and optional shared context with teammates.

### Use Cases

- **Personal assistant swarm**: Work bot + home bot + research bot, all sharing your context
- **Customer support troupe**: 5 bots covering different products, shared knowledge base
- **AI character roleplay**: Each bot a different character, memory per character
- **Multi-tenant SaaS**: One bot per customer, ringfenced
- **Development team**: Code review bot + docs bot + CI/CD bot sharing project context

## Three-Tier Memory Model

| Scope | Description | Use Case |
|-------|-------------|----------|
| **Global** | Shared across all bots | Reference docs, common tools |
| **Troupe** | Shared within a group | Team knowledge, customer context |
| **Bot-Local** | Ringfenced per bot | Private conversations, isolation |

Memory sharing is implemented via **symlinks** for real-time sync with zero disk overhead.

## Architecture

```
Telegram API (100+ bot tokens)
    ↓ (long polling)
┌─────────────────────────────────────┐
│  Bot-Circus Orchestrator (Node.js)  │
│  - Token router                     │
│  - Per-bot message queues           │
│  - Worker pool manager              │
│  - Memory symlink resolver          │
└─────────────────────────────────────┘
    ↓ (spawn subprocess per request)
┌─────────────────────────────────────┐
│  Claude Code CLI Worker Pool (10)   │
│  - Isolated --cwd per bot           │
│  - Fair scheduling across bots      │
│  - Rate limiting + quota fairness   │
└─────────────────────────────────────┘
    ↓ (reads workspace files)
┌─────────────────────────────────────┐
│  Per-Bot Workspaces                 │
│  performers/bot-id/                 │
│  ├─ SOUL.md (persona)               │
│  ├─ IDENTITY.md (config)            │
│  ├─ USER.md (behavior rules)        │
│  ├─ MEMORY.md (symlink or local)    │
│  └─ memory/ (SQLite DB)             │
└─────────────────────────────────────┘
```

**Key Innovation**: Single Node.js orchestrator process instead of container-per-bot. This reduces RAM from ~100MB/bot (Docker) to ~5MB/bot (workspace files + queue state).

## Quick Start

### Prerequisites

- Node.js ≥20
- Claude Code CLI installed (`which claude`)
- Telegram bot token(s) from [@BotFather](https://t.me/botfather)

### Installation

```bash
cd /root/bot-circus
npm install
chmod +x bin/circus.js
```

### Create Your First Bot

```bash
# Add a performer
./bin/circus.js add-performer \
  --name "MyBot" \
  --token "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" \
  --persona templates/default.soul.md

# Start the orchestrator
./bin/circus.js serve
```

Your bot is now live on Telegram!

### Create a Troupe (Shared Memory)

```bash
# Create a troupe
./bin/circus.js add-troupe customer-support

# Add bots to the troupe
./bin/circus.js add-performer \
  --name "SupportBot1" \
  --token $TOKEN1 \
  --troupe customer-support \
  --persona templates/customer-support.soul.md

./bin/circus.js add-performer \
  --name "SupportBot2" \
  --token $TOKEN2 \
  --troupe customer-support \
  --persona templates/customer-support.soul.md
```

Both bots now share the same `MEMORY.md` file via symlink. Knowledge learned by one is instantly available to the other.

## CLI Reference

### Bot Management

```bash
circus add-performer --name <name> --token <token> [--troupe <name>] [--persona <file>]
circus list                         # List all bots with status
circus start [bot-id]               # Start specific bot or all
circus stop [bot-id]                # Stop specific bot or all
circus restart <bot-id>             # Restart a bot
circus pause <bot-id>               # Pause queue processing
circus resume <bot-id>              # Resume queue processing
circus rm-performer <bot-id> [--keep-workspace]
```

### Troupe Management

```bash
circus add-troupe <name>            # Create a troupe
circus list-troupes                 # List all troupes
circus join-troupe <bot-id> <troupe-name>
circus leave-troupe <bot-id>
circus troupe-members <troupe-name>
```

### Monitoring

```bash
circus logs <bot-id> [--follow]     # View bot logs
circus logs --orchestrator          # View orchestrator logs
circus stats                        # Show detailed statistics
circus health                       # Health check
circus top                          # Real-time dashboard (updates every 2s)
```

### Main Commands

```bash
circus serve                        # Start the orchestrator (main daemon)
```

## Persona Templates

Bot-Circus ships with 5 starter personas in `templates/`:

1. **default.soul.md** — Helpful, professional assistant
2. **customer-support.soul.md** — Empathetic support agent
3. **sales-agent.soul.md** — Consultative sales rep
4. **dev-helper.soul.md** — Programming assistant
5. **meme-lord.soul.md** — Fun, witty internet culture bot

Copy and customize these for your use case, or write your own from scratch.

## Configuration

### Global Config (`circus.config.json`)

```json
{
  "worker_pool": {
    "max_workers": 10,
    "request_timeout_ms": 120000
  },
  "global_rate_limits": {
    "claude_requests_per_minute": 100,
    "telegram_messages_per_second": 30
  },
  "logging": {
    "level": "info",
    "retention_days": 30
  },
  "telemetry": {
    "enable_metrics": true,
    "metrics_port": 9090
  }
}
```

### Per-Bot Config (`performers/<id>/config.json`)

Auto-generated when you run `add-performer`. Edit to customize:

```json
{
  "id": "mybot",
  "name": "MyBot",
  "token": "...",
  "troupe": "customer-support",
  "rate_limits": {
    "messages_per_minute": 20,
    "max_queue_size": 100
  },
  "telegram_config": {
    "allowed_users": ["@admin"],
    "respond_to_groups": true
  },
  "enabled": true
}
```

## Metrics

If `telemetry.enable_metrics` is true, Prometheus metrics are exposed at `http://localhost:9090/metrics`:

- `circus_requests_total` — Total requests per bot
- `circus_errors_total` — Total errors per bot
- `circus_queue_depth` — Current queue size per bot
- `circus_active_workers` — Active worker count
- `circus_response_time_ms` — Average response time per bot

Health check endpoint: `http://localhost:9090/health`

## Performance Specs

| Metric | Value |
|--------|-------|
| RAM per bot | ~5MB (workspace + queue state) |
| Max concurrent workers | 10 (configurable) |
| Throughput | ~300 requests/min (10 workers × 2s avg response) |
| Bots tested | 100+ |
| Startup time | <5s for all bots |

## Deployment

### systemd Service

Create `/etc/systemd/system/bot-circus.service`:

```ini
[Unit]
Description=Bot-Circus Orchestrator
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/bot-circus
ExecStart=/usr/bin/node /root/bot-circus/bin/circus.js serve
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl enable bot-circus
systemctl start bot-circus
systemctl status bot-circus
```

## Troubleshooting

### "Orchestrator not running" error

The `serve` command must be running for CLI commands to work. Start it with:

```bash
circus serve
```

Or run as a systemd service (see Deployment).

### Bot not responding

Check logs:

```bash
circus logs <bot-id> --follow
```

Verify Claude CLI is installed:

```bash
which claude
```

Check worker pool status:

```bash
circus stats
```

### Queue full errors

Increase `max_queue_size` in bot config, or add more workers in global config.

## License

MIT

## Author

Built by [Kobus](https://github.com/kobie3717) with Claude Code

Part of the kobie3717 open-source ecosystem:
- [WaSP](https://www.npmjs.com/package/wasp-protocol) — WhatsApp Session Protocol
- [baileys-antiban](https://github.com/kobie3717/baileys-antiban) — Anti-ban for Baileys
- [PayBridge](https://www.npmjs.com/package/paybridge) — Unified payments SDK
- [AI-IQ](https://github.com/kobie3717/ai-iq) — SQLite-backed AI memory
- **Bot-Circus** — You are here 🎪
