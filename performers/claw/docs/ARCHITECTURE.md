# Architecture Documentation

## System Overview

```
┌─────────────────┐
│  Telegram User  │ (ID: 6531675960)
│  @Theclawbotbot │
└────────┬────────┘
         │
         │ (1) Send message
         ▼
┌─────────────────────────────────────────┐
│        Claw Telegram Bot                │
│      (Grammy Framework)                 │
│                                         │
│  - Webhook mode (port 7710)             │
│  - User authorization check             │
│  - Typing indicators                    │
│  - Message splitting                    │
│  - Error handling                       │
│  - Per-chat FIFO queue                  │
│  - Telegram dedupe (30s LRU+TTL)        │
└────────┬────────────────────────────────┘
         │
         │ (2) Spawn process
         ▼
┌─────────────────────────────────────────┐
│      Claude Code CLI Process            │
│   /root/.local/share/claude/            │
│        versions/2.1.76                  │
│                                         │
│  --print                                │
│  --output-format text                   │
│  --model opus                           │
│  --permission-mode bypassPermissions    │
│                                         │
│  Working Dir: /root/claw-workspace      │
│  Timeout: 120 seconds                   │
└────────┬────────────────────────────────┘
         │
         │ (3) Response (stdout)
         ▼
┌─────────────────────────────────────────┐
│        Response Handler                 │
│                                         │
│  - Collect stdout                       │
│  - Split into chunks (<4096 chars)      │
│  - Send to Telegram API                 │
└────────┬────────────────────────────────┘
         │
         │ (4) Send response
         ▼
┌─────────────────┐
│  Telegram User  │
│  (receives msg) │
└─────────────────┘
```

## Component Details

### 1. Telegram Bot (Grammy)

**File:** `bot.mjs`

**Responsibilities:**
- Receive messages via webhook at https://whatshubb.co.za/webhook/claw (port 7710)
- Check user authorization (only ID 6531675960)
- Handle `/start` and `/clear` commands
- Show typing indicators every 4 seconds
- Queue messages per chat (FIFO) - no drop-on-busy
- Deduplicate incoming Telegram messages (30s window, LRU cache)
- Spawn Claude CLI process for each message
- Collect and format responses
- Split long messages into chunks
- Error handling and timeouts

**Technology:** Grammy framework (grammy@1.41.0)

**Webhook Mode:**
- Endpoint: https://whatshubb.co.za/webhook/claw
- Port: 7710
- Replaces legacy long polling mode

**Concurrent Message Handling:**
- Per-chat FIFO queue (no messages dropped)
- Use `/pending` to check queue status
- Use `/stop` to cancel queued messages
- Replaces legacy `processingChats` drop-on-busy

**Telegram Dedupe:**
- Implemented in `dedupe.mjs`
- LRU cache + TTL (30s window)
- Max 200 entries
- Prevents duplicate message processing

### 2. Claude Code CLI

**Executable:** `/root/.local/share/claude/versions/2.1.76`

**Launch Configuration:**
```bash
claude \
  --print \                        # Print mode (non-interactive)
  --output-format text \           # Text output (not JSON)
  --model opus \                   # Use Claude Opus model
  --permission-mode bypassPermissions  # Auto-approve all actions
```

**Process Management:**
- Spawned with `child_process.spawn()`
- Input: User message via stdin
- Output: Response via stdout
- Errors: Via stderr
- Timeout: 120 seconds (SIGTERM kill)

**Working Directory:** `/root/claw-workspace` (isolated from bot code)

### 3. PM2 Process Manager

**File:** `ecosystem.config.cjs`

**Configuration:**
- **Name:** `claw-bot`
- **Script:** `bot.mjs`
- **Interpreter:** `node`
- **Auto-restart:** Yes
- **Max Memory:** 500MB restart threshold
- **Logs:** `/var/log/pm2/` (PM2-managed)

**Features:**
- Auto-restart on crash
- Log rotation
- Process monitoring
- Graceful shutdown
- Startup on boot (optional)

## Data Flow

### Message Flow (User → Claude → User)

```
1. USER SENDS MESSAGE
   ├─> Telegram API receives message
   └─> Webhook POST to https://whatshubb.co.za/webhook/claw

2. DEDUPE CHECK
   ├─> Check if message ID seen in last 30s
   ├─> If duplicate: ignore (return 200 OK)
   └─> If new: continue

3. AUTHORIZATION CHECK
   ├─> Extract user ID from message
   ├─> Compare to ALLOWED_USER_ID (6531675960)
   ├─> If not match: send "not authorized" message
   └─> If match: continue

4. QUEUE MESSAGE
   ├─> Add to per-chat FIFO queue
   ├─> If queue empty: process immediately
   └─> Else: wait for previous messages to complete

5. TYPING INDICATOR
   ├─> Send initial "typing" action
   └─> Set interval (every 4s) for continuous typing

6. SPAWN CLAUDE
   ├─> Build command args array
   ├─> Spawn child process (cwd: /root/claw-workspace)
   ├─> Pipe user message to stdin
   └─> Close stdin

7. COLLECT RESPONSE
   ├─> Listen to stdout data events
   ├─> Accumulate in buffer
   ├─> Listen to stderr (for errors)
   └─> Wait for process exit

8. TIMEOUT HANDLING
   ├─> Set 120-second timeout
   ├─> If timeout: SIGTERM to Claude process
   └─> If timeout: send error to user

9. PROCESS RESPONSE
   ├─> Clear typing interval
   ├─> Trim stdout buffer
   ├─> Split into 4096-char chunks
   └─> Find natural split points (newlines/spaces)

10. SEND TO USER
    ├─> For each chunk:
    │   └─> Send via Telegram API
    └─> Log success

11. ERROR HANDLING
    ├─> Catch any errors
    ├─> Format error message
    ├─> Send to user
    └─> Log error

12. QUEUE NEXT
    └─> Process next message in queue (if any)
```

### Error Handling Flow

```
ERROR OCCURS
├─> Process spawn error?
│   └─> "Failed to start Claude Code"
├─> Timeout (>120s)?
│   └─> "Request timed out after 120 seconds"
├─> Non-zero exit code?
│   └─> "Claude Code exited with code X"
└─> Other error?
    └─> "Error: {message}"
```

## File Structure

```
/root/bot-circus/performers/claw/
│
├── bot.mjs                     # Main bot script
│   ├─> Grammy bot setup (webhook mode)
│   ├─> Event handlers (/start, /clear, message)
│   ├─> Per-chat FIFO queue
│   ├─> Claude CLI spawn logic
│   ├─> Response processing
│   └─> Error handling
│
├── dedupe.mjs                  # Telegram message deduplication
│   ├─> LRU cache (max 200)
│   ├─> TTL 30s window
│   └─> Prevents duplicate processing
│
├── ecosystem.config.cjs        # PM2 configuration
│   ├─> App name (claw-bot)
│   ├─> Script path
│   ├─> Environment vars
│   └─> Log paths
│
├── package.json                # Dependencies
│   ├─> grammy@^1.41.0
│   └─> dotenv@^16.4.5
│
├── .env                        # Environment config
│   ├─> TELEGRAM_BOT_TOKEN
│   ├─> ALLOWED_USER_ID
│   ├─> CLAUDE_CLI_PATH
│   ├─> CLAUDE_WORKING_DIR
│   └─> CLAUDE_TIMEOUT
│
├── data/
│   └── sessions.db            # Session database
│
└── docs/                       # Documentation
    ├─> ARCHITECTURE.md        # This file
    ├─> COMMAND_REFERENCE.md   # Bot commands
    ├─> QUICKSTART.md          # Quick start
    └─> DEPLOYMENT.md          # Deployment guide
```

**Performer Ecosystem:**
Claw is part of the bot-circus performer set. Other performers:
- **octo** - GitHub operations
- **friday** - Proactive monitoring
- **007** - Security tasks
- **wa-drone** - WhatsApp automation
- **webbs** - Web scraping

All performers share modules from `/root/bot-circus/lib/`.

## Security Model

### Authorization

```
Message Received
    ↓
Extract user.id from ctx.from.id
    ↓
Compare to ALLOWED_USER_ID
    ↓
┌──────────────┬──────────────┐
│  Match?      │  No Match?   │
│  Continue    │  Reject      │
└──────────────┴──────────────┘
```

**Single User:** Only user ID `6531675960` can interact.

**Benefit:**
- No unauthorized access
- No abuse from other users
- No rate limiting needed (single user)

### Command Injection Protection

**Unsafe (NOT used):**
```javascript
// DON'T DO THIS
exec(`claude ${userMessage}`)  // Command injection risk!
```

**Safe (used):**
```javascript
// DO THIS
spawn(CLAUDE_CLI_PATH, ['--print', '--output-format', 'text'], {
  stdio: ['pipe', 'pipe', 'pipe']
})
claudeProcess.stdin.write(userMessage)  // Safe - no shell interpretation
```

**Benefit:**
- No shell interpretation
- User input never executed as commands
- Args array prevents injection

### Environment Variables

**Sensitive Data:**
- `TELEGRAM_BOT_TOKEN` - Bot authentication
- `ALLOWED_USER_ID` - User authorization

**Protection:**
- Stored in `.env` file
- `.env` in `.gitignore` (not committed)
- Loaded at runtime only
- Never logged or exposed

## Performance Characteristics

### Response Time

```
User sends message
    ↓
Webhook receives (latency: ~100-500ms)
    ↓
Dedupe check (~1ms)
    ↓
Queue position check (~1ms)
    ↓
Spawn Claude process (~0.5s)
    ↓
Claude processes (variable: 5-120s)
    ↓
Response sent (~0.5s)
    ↓
Total: 6-122 seconds (typical: 10-30s)
```

### Resource Usage

**Memory:**
- Bot process: ~50-100MB
- Claude process: ~200-300MB per query
- Total: ~250-400MB peak

**CPU:**
- Bot idle: <1%
- Claude processing: 10-50%
- Spikes during response generation

**Network:**
- Webhook: incoming POST only
- Messages: 1-10KB per message
- Responses: 1-100KB per response

### Scalability

**Current Limits:**
- **Users:** 1 (hard-coded)
- **Concurrent requests:** Unlimited (queued per-chat)
- **Message rate:** Unlimited (single user)

**Potential Scaling:**
- Multiple users: Array of allowed IDs
- Concurrent requests: Already queued
- Rate limiting: Per-user quotas

## Monitoring & Logging

### PM2 Logs

**Output Log:** `/var/log/pm2/claw-bot-out.log`
```
2026-05-28 10:30:15 Starting Claw Telegram Bot...
2026-05-28 10:30:15 Bot successfully started!
2026-05-28 10:31:22 Message from user 6531675960: Hello...
2026-05-28 10:31:35 Response length: 1234 characters
2026-05-28 10:31:36 Sent 1 message(s) to user
```

**Error Log:** `/var/log/pm2/claw-bot-error.log`
```
2026-05-28 10:45:12 Error processing message: Error: timeout
2026-05-28 10:46:33 Claude Code exited with code 1
```

### Monitoring Points

1. **Bot Health:**
   - PM2 status (running/stopped/errored)
   - Last message timestamp
   - Error count in last hour

2. **Claude Health:**
   - Spawn success rate
   - Average response time
   - Timeout count

3. **User Experience:**
   - Message→response latency
   - Error rate
   - Split message frequency

4. **Queue Health:**
   - Queue depth per chat
   - Average wait time
   - `/pending` check results

### Log Queries

```bash
# Message count
grep "Message from user" /var/log/pm2/claw-bot-out.log | wc -l

# Error count
wc -l /var/log/pm2/claw-bot-error.log

# Average response time (if logged)
grep "Response length" /var/log/pm2/claw-bot-out.log | tail -100

# Recent errors
tail -20 /var/log/pm2/claw-bot-error.log
```

## Deployment

### Production Checklist

- [x] Dependencies installed (`npm install`)
- [x] `.env` configured with correct values
- [x] Claude CLI executable exists and is accessible
- [x] Bot token is valid
- [x] User ID is correct
- [x] Webhook endpoint configured (https://whatshubb.co.za/webhook/claw)
- [ ] Test bot in dev mode
- [ ] Start with PM2 (`pm2 start ecosystem.config.cjs`)
- [ ] Verify logs (`pm2 logs claw-bot`)
- [ ] Test from Telegram
- [ ] Configure PM2 startup (optional: `pm2 startup && pm2 save`)

### Rollback Plan

If bot fails or has issues:

1. **Stop this bot:**
   ```bash
   pm2 stop claw-bot
   pm2 delete claw-bot
   ```

2. **Verify webhook is released:**
   - Telegram only allows one webhook per bot token
   - Stopping claw releases the endpoint

3. **Check logs for issues:**
   ```bash
   pm2 logs claw-bot --lines 100
   ```

## Future Architecture

### Session Continuity (Planned)

```
┌─────────────────┐
│  Telegram User  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│    Bot + Session        │
│    Manager              │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Conversation History   │
│  (SQLite or Redis)      │
│                         │
│  user_id → [           │
│    {role: "user", ...} │
│    {role: "assistant"} │
│  ]                      │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Claude CLI             │
│  (with full context)    │
└─────────────────────────┘
```

### Multi-User Support (Planned)

```
.env:
ALLOWED_USER_IDS=6531675960,1234567890,9876543210

Code:
const ALLOWED_IDS = process.env.ALLOWED_USER_IDS.split(',').map(Number);
if (!ALLOWED_IDS.includes(userId)) { ... }
```

### File Upload Support (Planned)

```
User uploads file
    ↓
Save to /tmp/telegram-{messageId}-{filename}
    ↓
Pass file path to Claude
    ↓
Claude processes file
    ↓
Delete temp file
```

## Summary

Modern webhook-based architecture:
- Grammy handles Telegram API (webhook mode)
- Per-chat FIFO queue (no dropped messages)
- Telegram dedupe (LRU+TTL 30s)
- Spawns Claude CLI per message
- Session state in SQLite
- Single user authorization
- PM2 for reliability
- Comprehensive error handling
- Part of bot-circus performer ecosystem
- Easy to understand and modify
