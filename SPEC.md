# Bot-Circus Technical Specification
**Version:** 1.0  
**Date:** 2026-04-05  
**Status:** Design Phase

---

## Executive Summary

**Bot-Circus** is a multi-bot Telegram orchestrator that runs up to 100 independent Telegram bots on a single VPS, each powered by Claude Code CLI with isolated personas and memory. Bots can share memory in "troupes" (groups) or run completely isolated ("ringfenced"). The system maximizes resource efficiency by sharing a single Node.js orchestrator process, worker pool, and Claude Max x20 OAuth quota across all performers.

**Core Innovation:** Unlike container-per-bot approaches (Memoh, tgbot-swarm), Bot-Circus uses a lightweight single-process orchestrator with per-bot workspaces and subprocess Claude CLI workers. This reduces overhead from ~100MB/bot (Docker) to ~5MB/bot (workspace files + queue state).

---

## Architecture Overview

### System Topology

```
Telegram API (100 bot tokens)
    ↓ (long polling or webhooks)
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
│  - Streaming stdout → Telegram      │
│  - Rate limiting + quota fairness   │
└─────────────────────────────────────┘
    ↓ (reads workspace files)
┌─────────────────────────────────────┐
│  Per-Bot Workspaces                 │
│  /root/bot-circus/performers/       │
│  ├─ bot-001/                        │
│  │  ├─ SOUL.md (persona)            │
│  │  ├─ IDENTITY.md (config)         │
│  │  ├─ USER.md (behavior rules)     │
│  │  ├─ MEMORY.md → troupe symlink   │
│  │  └─ memory/ (SQLite DB)          │
│  └─ bot-002/ ...                    │
└─────────────────────────────────────┘
```

### Three Memory Scopes (Ruflo-Inspired)

| Scope | Location | Sharing | Use Case |
|-------|----------|---------|----------|
| **Global** | `/root/bot-circus/global/` | All bots read | Reference docs, tool manuals, company policies |
| **Troupe** | `/root/bot-circus/troupes/<name>/MEMORY.md` | Troupe members share | Customer support team, sales team, domain experts |
| **Bot-Local** | `/root/bot-circus/performers/<id>/memory/` | Single bot only | Ringfenced bots, sensitive contexts, experimental agents |

**Key Pattern:** Troupe memory implemented via symlinks. When bot joins troupe "customer-support", its `MEMORY.md` becomes a symlink to `/root/bot-circus/troupes/customer-support/MEMORY.md`. Claude Code CLI loads this as part of workspace context.

---

## Directory Structure

```bash
/root/bot-circus/
├── bin/                          # CLI tool
│   └── circus                    # Main executable
├── lib/                          # Orchestrator code
│   ├── orchestrator.js           # Main process (token router)
│   ├── worker-pool.js            # Claude CLI subprocess manager
│   ├── message-queue.js          # Per-bot FIFO queue
│   ├── rate-limiter.js           # Quota protection
│   ├── memory-manager.js         # Symlink setup/teardown
│   └── telegram-client.js        # Telegram Bot API wrapper
├── performers/                   # Individual bot workspaces
│   ├── bot-001/
│   │   ├── config.json           # Bot-specific config
│   │   ├── SOUL.md               # Persona definition
│   │   ├── IDENTITY.md           # Name, role, capabilities
│   │   ├── USER.md               # Behavior rules
│   │   ├── MEMORY.md             # Symlink or local file
│   │   └── memory/               # SQLite DB + tool cache
│   │       └── memories.db
│   └── bot-002/ ...
├── troupes/                      # Shared memory groups
│   ├── customer-support/
│   │   ├── MEMORY.md             # Shared knowledge base
│   │   ├── memories.db           # Shared SQLite DB
│   │   └── members.json          # List of bot IDs in troupe
│   └── sales-team/ ...
├── global/                       # Global reference docs
│   ├── TOOLS.md                  # Available Claude tools
│   ├── COMPANY.md                # Company context
│   └── POLICIES.md               # Behavior policies
├── logs/                         # Per-bot logs
│   ├── bot-001.log
│   └── orchestrator.log
├── templates/                    # Persona templates
│   ├── customer-support.soul.md
│   ├── sales-agent.soul.md
│   └── dev-helper.soul.md
└── circus.config.json            # Global settings
```

---

## Configuration Schemas

### Per-Bot Config (`performers/<id>/config.json`)

```json
{
  "id": "bot-001",
  "name": "SupportBot Alpha",
  "token": "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ",
  "troupe": "customer-support",
  "persona_file": "SOUL.md",
  "rate_limits": {
    "messages_per_minute": 20,
    "max_queue_size": 100
  },
  "claude_config": {
    "model": "claude-sonnet-4-5",
    "timeout_ms": 120000,
    "streaming": true
  },
  "telegram_config": {
    "polling_interval": 1000,
    "allowed_users": ["@admin"],
    "respond_to_groups": true
  },
  "enabled": true,
  "created_at": "2026-04-05T10:00:00Z"
}
```

### Global Config (`circus.config.json`)

```json
{
  "worker_pool": {
    "max_workers": 10,
    "idle_timeout_ms": 60000
  },
  "global_rate_limits": {
    "claude_requests_per_minute": 100,
    "telegram_messages_per_second": 30
  },
  "memory": {
    "global_docs_path": "./global/",
    "auto_link_global": true
  },
  "logging": {
    "level": "info",
    "rotation": "daily",
    "retention_days": 30
  },
  "telemetry": {
    "enable_metrics": true,
    "metrics_port": 9090
  }
}
```

---

## Core Implementation Patterns

### 1. Symlink-Based Memory Sharing

```javascript
// lib/memory-manager.js
class MemoryManager {
  async joinTroupe(botId, troupeName) {
    const botMemoryPath = `performers/${botId}/MEMORY.md`;
    const troupeMemoryPath = `troupes/${troupeName}/MEMORY.md`;
    
    // Backup existing local memory
    if (fs.existsSync(botMemoryPath) && !fs.lstatSync(botMemoryPath).isSymbolicLink()) {
      await fs.promises.rename(botMemoryPath, `${botMemoryPath}.backup`);
    }
    
    // Create symlink
    await fs.promises.symlink(
      path.resolve(troupeMemoryPath),
      botMemoryPath,
      'file'
    );
    
    // Update troupe membership
    const membersFile = `troupes/${troupeName}/members.json`;
    const members = JSON.parse(await fs.promises.readFile(membersFile));
    members.push(botId);
    await fs.promises.writeFile(membersFile, JSON.stringify(members, null, 2));
  }
  
  async leaveTroupe(botId, troupeName) {
    const botMemoryPath = `performers/${botId}/MEMORY.md`;
    
    // Remove symlink, restore backup or create empty
    if (fs.lstatSync(botMemoryPath).isSymbolicLink()) {
      await fs.promises.unlink(botMemoryPath);
      
      const backupPath = `${botMemoryPath}.backup`;
      if (fs.existsSync(backupPath)) {
        await fs.promises.rename(backupPath, botMemoryPath);
      } else {
        await fs.promises.writeFile(botMemoryPath, '# Local Memory\n\n');
      }
    }
    
    // Remove from troupe members
    const membersFile = `troupes/${troupeName}/members.json`;
    const members = JSON.parse(await fs.promises.readFile(membersFile));
    await fs.promises.writeFile(
      membersFile,
      JSON.stringify(members.filter(id => id !== botId), null, 2)
    );
  }
}
```

### 2. Worker Pool with Fairness Queue

```javascript
// lib/worker-pool.js
class ClaudeWorkerPool {
  constructor(maxWorkers = 10) {
    this.maxWorkers = maxWorkers;
    this.activeWorkers = new Map(); // botId → subprocess
    this.queue = []; // {botId, message, resolve, reject}
  }
  
  async execute(botId, message) {
    // Add to queue
    return new Promise((resolve, reject) => {
      this.queue.push({botId, message, resolve, reject, queuedAt: Date.now()});
      this.processQueue();
    });
  }
  
  async processQueue() {
    if (this.activeWorkers.size >= this.maxWorkers || this.queue.length === 0) {
      return;
    }
    
    // Fair scheduling: prioritize bots with fewer active workers
    const botCounts = new Map();
    this.activeWorkers.forEach((_, botId) => {
      botCounts.set(botId, (botCounts.get(botId) || 0) + 1);
    });
    
    const task = this.queue.sort((a, b) => {
      const aCount = botCounts.get(a.botId) || 0;
      const bCount = botCounts.get(b.botId) || 0;
      return aCount - bCount || a.queuedAt - b.queuedAt;
    }).shift();
    
    if (!task) return;
    
    const {botId, message, resolve, reject} = task;
    const workerId = `${botId}-${Date.now()}`;
    
    try {
      const workspace = `performers/${botId}`;
      const proc = spawn('claude', ['--cwd', workspace], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      this.activeWorkers.set(workerId, proc);
      
      let output = '';
      proc.stdout.on('data', chunk => {
        output += chunk.toString();
      });
      
      proc.on('close', code => {
        this.activeWorkers.delete(workerId);
        resolve(output);
        this.processQueue(); // Process next in queue
      });
      
      proc.stdin.write(message + '\n');
      proc.stdin.end();
      
    } catch (error) {
      reject(error);
      this.processQueue();
    }
  }
}
```

### 3. Per-Bot Message Queue with Rate Limiting

```javascript
// lib/message-queue.js
class BotMessageQueue {
  constructor(botId, rateLimits) {
    this.botId = botId;
    this.queue = [];
    this.processing = false;
    this.messagesPerMinute = rateLimits.messages_per_minute || 20;
    this.maxQueueSize = rateLimits.max_queue_size || 100;
    this.messageTimestamps = [];
  }
  
  enqueue(message) {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(`Queue full for bot ${this.botId}`);
    }
    this.queue.push(message);
    this.process();
  }
  
  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    // Rate limit check
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter(
      ts => now - ts < 60000
    );
    
    if (this.messageTimestamps.length >= this.messagesPerMinute) {
      const oldestTimestamp = this.messageTimestamps[0];
      const waitMs = 60000 - (now - oldestTimestamp);
      setTimeout(() => this.process(), waitMs);
      return;
    }
    
    this.processing = true;
    const message = this.queue.shift();
    this.messageTimestamps.push(now);
    
    try {
      await this.handleMessage(message);
    } catch (error) {
      console.error(`Error processing message for ${this.botId}:`, error);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.process();
      }
    }
  }
}
```

---

## CLI Tool Design

### Commands

```bash
# Add new performer
circus add-performer \
  --name "SupportBot Alpha" \
  --token "1234567890:ABC..." \
  --troupe customer-support \
  --persona templates/customer-support.soul.md

# List all performers
circus list
# Output:
# ID       NAME              TROUPE           STATUS   QUEUE   UPTIME
# bot-001  SupportBot Alpha  customer-support online   3       4h 23m
# bot-002  SalesBot Beta     sales-team       online   0       2h 15m
# bot-003  DevHelper Gamma   (ringfenced)     paused   0       -

# Manage lifecycle
circus start [bot-id]           # Start specific bot or all
circus stop [bot-id]            # Stop specific bot or all
circus restart [bot-id]         # Restart specific bot or all
circus pause bot-001            # Pause (stop processing queue)
circus resume bot-001           # Resume

# View logs
circus logs bot-001             # Tail logs for bot
circus logs bot-001 --follow    # Stream logs
circus logs --orchestrator      # Orchestrator logs

# Troupe management
circus add-troupe customer-support
circus list-troupes
circus join-troupe bot-001 customer-support
circus leave-troupe bot-001
circus troupe-members customer-support

# Remove performer
circus rm-performer bot-001
circus rm-performer bot-001 --keep-workspace  # Keep files

# Stats & health
circus stats                    # Show worker pool, queue sizes, rate limits
circus health                   # Check all bots, worker pool, memory usage
circus top                      # Real-time dashboard (like htop)
```

### CLI Implementation Stub

```javascript
#!/usr/bin/env node
// bin/circus

const {program} = require('commander');
const Orchestrator = require('../lib/orchestrator');

program
  .name('circus')
  .description('Bot-Circus: Multi-bot Telegram orchestrator')
  .version('1.0.0');

program
  .command('add-performer')
  .requiredOption('--name <name>', 'Bot display name')
  .requiredOption('--token <token>', 'Telegram bot token')
  .option('--troupe <name>', 'Join troupe (memory group)')
  .option('--persona <file>', 'Persona template file')
  .action(async (options) => {
    const orch = new Orchestrator();
    await orch.addPerformer(options);
    console.log(`Added performer: ${options.name}`);
  });

program
  .command('start [bot-id]')
  .description('Start bot(s)')
  .action(async (botId) => {
    const orch = new Orchestrator();
    await orch.start(botId);
  });

program.parse();
```

---

## Key Design Decisions

### 1. Single Orchestrator vs Docker-per-Bot

**Chosen:** Single Node.js orchestrator  
**Why:**  
- **RAM:** 100 Docker containers = ~10GB. Single process = ~500MB base + 5MB/bot = ~1GB total.
- **Complexity:** No Docker networking, volumes, or docker-compose. Just systemd service.
- **Startup:** All bots start in <5s vs ~30s for Docker Compose stack.
- **Debugging:** Single process logs, no container SSH needed.

**Trade-off:** Less isolation. Mitigated by subprocess sandboxing for Claude CLI workers.

### 2. Memory Symlinks (Not File Copying)

**Why:**  
- **Real-time sync:** Troupe members see updates immediately.
- **Disk efficiency:** One MEMORY.md file vs N copies.
- **Atomicity:** Symlink creation/deletion is atomic (no half-written files).

**Risk:** Concurrent writes. **Mitigation:** Use append-only logs for troupe memory, or WAL mode in SQLite.

### 3. Message Queue per Bot (Not Global Queue)

**Why:**  
- **Fairness:** One spammy bot can't block others.
- **Rate limiting:** Per-bot limits without complex accounting.
- **Debugging:** Clear queue size per bot.

**Implementation:** Each bot has FIFO queue, worker pool pulls from all queues with fair scheduling.

### 4. Worker Pool Sizing (10 Concurrent)

**Math:**  
- Claude API: ~2s response time  
- 10 workers = 300 requests/min max throughput  
- 100 bots × 20 msg/min rate limit = 2000 msg/min demand  
- **Bottleneck:** Need 67 workers for full demand, but Claude quota limits to ~100/min  

**Strategy:** Start with 10 workers (Phase 1), tune based on real usage. Add priority queue in Phase 3.

### 5. Streaming Output → Telegram

**Pattern:**  
Claude CLI outputs streaming JSON. Parse chunks, send Telegram messages incrementally for long responses (>4096 chars).

```javascript
proc.stdout.on('data', chunk => {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (line.includes('"type":"message"')) {
      const msg = JSON.parse(line);
      telegram.sendMessage(chatId, msg.content);
    }
  }
});
```

### 6. OAuth Quota Sharing Strategy

**Problem:** Claude Max x20 = ~100 requests/min shared quota.  
**Solution:**  
- Global rate limiter tracks total requests/min across all bots.
- Fair scheduling: rotate through bots round-robin.
- Backpressure: when quota exhausted, queue messages, send "Bot busy, retrying in 30s" to users.

### 7. Hot-Reload of Bot Configs

**Implementation:**  
- `fs.watch()` on `performers/*/config.json`
- On change: reload config, update rate limiter, restart Telegram client (no full orchestrator restart)
- Use `botId` as stable key, allow token/name/troupe changes without downtime

---

## Phased Rollout

### Phase 1: MVP (5 Bots, 1 Week)

**Scope:**  
- 5 bots (3 ringfenced, 2 in one troupe)
- Global + bot-local memory only
- Basic CLI (`add-performer`, `start`, `stop`, `list`, `logs`)
- Single worker (no pool yet)
- Polling-based Telegram (no webhooks)

**Files to Build:**  
- `lib/orchestrator.js` (80 lines)
- `lib/telegram-client.js` (50 lines)
- `lib/memory-manager.js` (60 lines)
- `bin/circus` (40 lines)
- `templates/default.soul.md`

**Success Criteria:**  
- All 5 bots respond to `/start` command
- Troupe members share MEMORY.md
- No crashes after 24h uptime

### Phase 2: Troupe Memory (20 Bots, 1 Week)

**Add:**  
- Troupe memory with SQLite WAL mode
- `join-troupe`, `leave-troupe` commands
- 3 troupes: customer-support, sales, dev-helpers
- 20 total bots

**Files to Build:**  
- `lib/message-queue.js` (message queues per bot)
- CLI commands for troupe management

**Success Criteria:**  
- Bots in same troupe see each other's memory updates within 5s
- No memory corruption after 100 concurrent writes

### Phase 3: Worker Pool (100 Bots, 2 Weeks)

**Add:**  
- Worker pool (10 concurrent Claude CLI subprocesses)
- Per-bot + global rate limiting
- Priority queue (admin messages first)
- Metrics (Prometheus endpoint on :9090)

**Files to Build:**  
- `lib/worker-pool.js`
- `lib/rate-limiter.js`
- `lib/metrics.js`

**Success Criteria:**  
- 100 bots online simultaneously
- <5s P95 response time under load
- No Claude quota violations

### Phase 4: Production Hardening (2 Weeks)

**Add:**  
- Admin dashboard (web UI at `circus.whatshubb.co.za`)
- Bot templates library (15 personas)
- Hot-reload for all config changes
- Webhook mode for Telegram (nginx reverse proxy)
- Auto-restart on crash (systemd)
- Daily backups of all workspaces

**Files to Build:**  
- `dashboard/` (React SPA)
- `lib/webhook-server.js`
- `systemd/bot-circus.service`

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Claude quota exhaustion** | All bots stop responding | Global rate limiter (100/min), queue backpressure, user notifications |
| **Memory file conflicts** | Troupe memory corruption | SQLite WAL mode, append-only logs, file locking |
| **One bot crashes orchestrator** | All bots go down | Isolate each bot in async boundary with try/catch, restart loop |
| **Telegram rate limits** | Bots get banned | Respect 30msg/sec per token, add delays between bulk sends |
| **Worker pool starvation** | Long messages block others | Timeout (2min), kill slow workers, priority queue |
| **Disk space (100 bots × 50MB)** | 5GB disk usage | Log rotation (7d retention), compress old memories |
| **Symlink loops** | MEMORY.md circular reference | Validate symlink targets before creation, detect loops |

---

## Next Steps

1. **Prototype Phase 1** (3 days): Build orchestrator core, test with 3 bots locally
2. **Test Claude CLI subprocess** (1 day): Verify stdin/stdout IPC works for streaming output
3. **Deploy to VPS** (1 day): Run on actual VPS, test with real Telegram tokens
4. **Scale test** (2 days): Load test with 20 bots, measure RAM/CPU, tune worker pool
5. **Document persona templates** (1 day): Create 5 starter SOUL.md files (support, sales, dev, meme, researcher)
6. **Phase 2 planning** (1 day): Design troupe SQLite schema, write migration from MEMORY.md to DB

**Target:** Phase 1 MVP deployed by April 12, 2026 (7 days from now).

---

## References

- **Ruflo:** Three-scope memory (Project/Local/User) → adapted as Global/Troupe/Bot-Local
- **multi-bot-telegram-system:** JSON config pattern, multiprocessing approach
- **OpenClaw:** Workspace-per-session pattern, SOUL.md persona files
- **Scavenge Report:** `/root/.openclaw/reference/hive-scavenge-report.md`

**Author:** Claude Code (Sonnet 4.5)  
**Spec Review:** Pending (share with Kobus for feedback before Phase 1 build)
