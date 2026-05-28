# Claw Telegram Bot - Complete Command Reference v2

## New Commands (v2 Upgrades)

### Proactive Alerts

#### `/alerts`
View recent alerts and statistics.

**Example**:
```
/alerts
```

**Output**:
```
🚨 Alert Statistics

Total: 12
Critical: 3
Last 24h: 5
Queued: 0

Recent Alerts:

🚨 Task "docker-health" triggered alert: whatsauction-backend not running (15m ago)
⚠️ Task "disk-check" triggered alert: Disk usage at 87% (45m ago)
```

---

#### `/mute <minutes>`
Suppress alerts temporarily (max 1440 minutes / 24 hours).

**Example**:
```
/mute 30
```

**Output**:
```
🔕 Alerts muted for 30 minutes
```

---

### Job Queue

#### `/queue <description> | <command>`
Enqueue a background job for non-blocking execution.

**Format**: `/queue <description> | <shell command>`

**Examples**:
```
/queue run tests | cd /root/whatsauction && npm test

/queue backup database | pg_dump -U vpn_user vpn_business > /tmp/backup-$(date +%Y%m%d).sql

/queue deploy frontend | cd /root/whatsauction && npm run build && pm2 restart whatsauction
```

**Output**:
```
✅ Job #42 queued: run tests

Use /jobs to see status
```

**Notes**:
- Jobs run one at a time (max 1 concurrent)
- 10 minute timeout
- Results sent when complete
- Can detect "[QUEUE]" in Claude responses to auto-queue

---

#### `/jobs`
List recent jobs with status.

**Example**:
```
/jobs
```

**Output**:
```
📋 Recent Jobs

✅ #42 (done) - run tests
  Created: 5m ago
  Exit code: 0

🔄 #43 (running) - backup database
  Created: 2m ago

⏳ #44 (queued) - deploy frontend
  Created: 1m ago

Queue: 1 | Running: 1
```

---

#### `/job <id>`
Get detailed output for specific job.

**Example**:
```
/job 42
```

**Output**:
```
✅ Job #42

Description: run tests
Status: done
Created: 2026-04-09T10:15:00.000Z
Started: 2026-04-09T10:15:01.000Z
Completed: 2026-04-09T10:15:45.000Z
Duration: 44s
Exit code: 0

Output:
```
PASS  tests/auth.test.js
PASS  tests/routes.test.js
Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total
```
```

---

### Message Queue

#### `/pending`
Check pending messages in queue.

**Example**:
```
/pending
```

**Output**:
```
📋 Queue Status

Messages queued: 2
Currently processing: "Deploy WhatsAuction"
Pending:
1. "Run tests"
2. "Check logs"
```

---

#### `/stop`
Cancel all queued messages (current message continues).

**Example**:
```
/stop
```

**Output**:
```
🛑 Cancelled 2 queued messages
Current message will complete normally
```

---

## Existing Commands (v1)

### Core

- `/start` - Wake up the bot
- `/clear` - Clear session and start fresh (now auto-snapshots for handoff)
- `/session` - View current session info
- `/status` - Quick health check (docker, pm2, APIs, disk)

### Memory

- `/memory search <query>` - Search AI-IQ memory
- `/memory add <content>` - Add manual memory
- `/memory recent` - Show recent Claw memories
- `/memory stats` - Memory statistics
- `/remember <text>` - Quick remember (alias for add)
- `/recall <query>` - Quick recall (alias for search)
- `/forget <query>` - Search memories to delete
- `/forget-confirm <id>` - Confirm deletion

### Inbox & Communication

- `/inbox` - Inbox summary
- `/wa` - WhatsApp unread messages
- `/email` - Email unread messages
- `/biz` - Business dashboard (signups, API health)

### Tasks

- `/task list` - List all tasks
- `/task add <name> <interval> <command>` - Add new task
- `/task stop <name>` - Disable task
- `/task start <name>` - Enable task
- `/task remove <name>` - Delete task

### Other

- `/heartbeat` - Manual heartbeat check
- `/scavenge <github-url>` - Extract patterns from GitHub repo
- `/analyze` - Send photo to analyze

---

## Automatic Features (No Command Needed)

### Proactive Alerts

**Auto-registered monitoring tasks**:
- `docker-health` - Every 10 minutes
- `api-health` - Every 5 minutes  
- `disk-check` - Every 30 minutes
- `heartbeat` - Every 30 minutes

**Alert triggers**:
- Error keywords: error, failed, down, critical, not running, offline, timeout, unavailable, crash
- Non-zero exit codes
- Disk usage >85%
- Docker containers not "Up"
- API health check failures

**Alert behavior**:
- Deduplication: same alert within 30min = suppressed
- Quiet hours (23:00-08:00 SAST): non-critical queued for morning
- Critical keywords (database, payment, critical, down) bypass quiet hours
- Queued alerts flushed at 08:00 SAST

---

### Session Handoff

**Auto-captures on**:
- `/clear` command
- Session timeout
- Session error/crash

**Snapshot includes**:
- Last topic discussed
- Key points (TODO, decided, fixed, deployed, created)
- Last response snippet

**Auto-loads on**:
- New session creation
- Provides continuity between sessions

---

### Background Learning

**Auto-stored**:
- User preferences ("remember X")
- Completed actions (created, deployed, fixed)
- Issue resolutions (error → fixed)

**Feedback detection**:
- Reaction emojis (👍 👎 ✅ ❌)
- Text signals (perfect, wrong, better, worse)
- Auto-improves responses over time

---

### Telegram Dedupe

**Automatic deduplication**:
- LRU cache (max 200 entries)
- 30 second TTL window
- Prevents duplicate message processing
- Implemented in `dedupe.mjs`

---

## Tips

### Queue Long Tasks
If a command might take >2 minutes, use `/queue`:
```
# Instead of asking Claude to run tests directly:
/queue run tests | cd /root/whatsauction && npm test

# Instead of long builds:
/queue rebuild app | cd /root/flashvault-mobile && npm run build
```

### Check Queue Status
Before sending multiple requests:
```
/pending   # See what's already queued
/stop      # Cancel queued messages if needed
```

### Mute During Maintenance
Before planned maintenance:
```
/mute 60
# Do maintenance work
# Alerts resume after 1 hour
```

### Check Alerts Regularly
```
# Morning routine
/alerts
/jobs
/inbox
```

### Use Handoff for Complex Tasks
```
# Session 1: "Deploy WhatsAuction backend"
> ...deployment happening...
/clear

# Session 2 (later):
> [Previous session context loaded automatically]
> "Deployment from last session succeeded"
```

---

## Database Locations

- Tasks: `/root/bot-circus/performers/claw/data/tasks.db`
- Sessions: `/root/bot-circus/performers/claw/data/sessions.db`
- Alerts: `/root/bot-circus/performers/claw/data/proactive-alerts.db`
- Queue: `/root/bot-circus/performers/claw/data/queue.db`

## Logs

- Bot logs: `/var/log/pm2/claw-bot-*.log`
- Heartbeat: `/var/log/pm2/claw-bot-heartbeat.log`

## Service Management

```bash
# Via PM2 (recommended)
pm2 restart claw-bot
pm2 logs claw-bot
pm2 monit

# Direct
cd /root/bot-circus/performers/claw
node bot.mjs
```

---

## Architecture

```
User (Telegram) 
  ↓
Claw Bot (Grammy - webhook mode, port 7710)
  ↓
├─ Per-chat FIFO queue (/pending, /stop)
├─ Telegram dedupe (LRU+TTL 30s)
├─ Claude Code CLI (--session management, cwd=/root/claw-workspace)
├─ Proactive Alerts (monitors tasks)
├─ Job Queue (background jobs)
├─ Session Handoff (context continuity)
├─ Task Scheduler (periodic checks)
├─ Memory Bridge (AI-IQ integration)
└─ Learning System (feedback loops)
```

**Webhook:** https://whatshubb.co.za/webhook/claw (port 7710)

**Performer Ecosystem:** Part of bot-circus (octo, friday, 007, wa-drone, webbs)

---

## Security

- Only authorized user (ALLOWED_USER_ID) can send commands
- All commands validated before execution
- Queue jobs sandboxed with bash -c
- No arbitrary code execution from untrusted sources
- Alert deduplication prevents spam
- Telegram dedupe prevents duplicate processing

---

## Version

**v2** - 2026-04-09 - Critical upgrades complete
- ✅ Proactive alerts with auto-monitoring
- ✅ Session handoff with context continuity
- ✅ Non-blocking job queue
- ✅ Memory tool verified and working
- ✅ Webhook mode (replaces polling)
- ✅ Per-chat FIFO queue (replaces drop-on-busy)
- ✅ Telegram dedupe (LRU+TTL 30s)
