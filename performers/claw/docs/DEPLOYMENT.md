# Claw Telegram Bot - Deployment Guide

## Pre-Deployment Checklist

✅ All scripts created and executable
✅ SQLite database initialized at /root/bot-circus/performers/claw/data/sessions.db
✅ Dependencies installed (Grammy, dotenv, better-sqlite3)
✅ .env file configured with bot token and user ID
✅ Bot initialization tested (loads 43,921 char system prompt)
✅ Session management tested
✅ Cleanup script tested
✅ Webhook endpoint configured (https://whatshubb.co.za/webhook/claw)
✅ Dedupe module present (dedupe.mjs)
✅ Per-chat FIFO queue implemented

## Deployment Steps

### 1. Install Cron Jobs

```bash
(crontab -l 2>/dev/null; echo "*/30 * * * * /root/bot-circus/performers/claw/heartbeat.mjs >> /var/log/pm2/claw-heartbeat-cron.log 2>&1"; echo "0 4 * * * /root/bot-circus/performers/claw/cleanup-sessions.mjs >> /var/log/pm2/claw-cleanup-cron.log 2>&1") | crontab -
```

Verify:
```bash
crontab -l | grep bot-circus/performers/claw
```

### 2. Start PM2 Processes

```bash
cd /root/bot-circus
pm2 start performers/claw/ecosystem.config.cjs
pm2 save
```

### 3. Verify Running

```bash
pm2 status
# Should show:
# claw-bot            | online
# claw-alerts         | online  (if alerts enabled)
```

### 4. Test Bot on Telegram

Send these messages to your bot:
1. `/start` - Should respond with "🦀 Claw is online. What do you need?"
2. `/session` - Should show "No active session" initially
3. `hello` - Should respond (creates first session)
4. `/session` - Should now show session UUID and age
5. `/clear` - Should clear session and reload memories
6. `/status` - Should run quick health check
7. `/pending` - Should show queue status (likely empty)

### 5. Test Queue Functionality

```bash
# Send multiple messages quickly to test FIFO queue
# Message 1: "What's the time?"
# Message 2: "List files in /tmp"
# Message 3: "Check disk space"

# Then check queue
/pending
```

### 6. Monitor Logs

```bash
# Watch bot logs
pm2 logs claw-bot --lines 50

# Watch alert logs (if enabled)
pm2 logs claw-alerts --lines 50

# Watch heartbeat
tail -f /var/log/pm2/claw-heartbeat-cron.log

# Watch cleanup
tail -f /var/log/pm2/claw-cleanup-cron.log
```

### 7. Test Heartbeat (Manual)

```bash
/root/bot-circus/performers/claw/heartbeat.mjs
# Should run checks and send Telegram summary
```

### 8. Test File Upload

Upload a file to the bot and ask it to analyze it.
The bot should download to /tmp/ and process it.

### 9. Verify Webhook

```bash
# Check port 7710 is listening
netstat -tlnp | grep 7710

# Test webhook endpoint
curl -X POST https://whatshubb.co.za/webhook/claw

# Check reverse proxy forwarding
tail -f /var/log/nginx/access.log | grep webhook
# or
tail -f /var/log/caddy/access.log | grep webhook
```

## Rollback Plan

If something goes wrong:

```bash
# Stop PM2 processes
pm2 stop claw-bot
pm2 delete claw-bot

# If alerts enabled
pm2 stop claw-alerts
pm2 delete claw-alerts

# Remove cron entries
crontab -l | grep -v bot-circus/performers/claw | crontab -

# Clear sessions (optional)
rm /root/bot-circus/performers/claw/data/sessions.db

# Restart from clean state
cd /root/bot-circus
pm2 start performers/claw/ecosystem.config.cjs
```

## Performance Expectations

- **Bot response time**: 5-30 seconds (depends on Claude CLI)
- **Memory usage**: ~200-500MB per PM2 process
- **Session DB size**: ~10KB per 100 sessions
- **Log rotation**: Managed by PM2 (merge_logs: true)
- **Webhook latency**: ~100-500ms (vs 1-3s for polling)
- **Queue processing**: Sequential per-chat, parallel across chats

## Monitoring

Key metrics to watch:
- PM2 status (restarts indicate crashes)
- Heartbeat logs (check for failed health checks)
- Alert logs (watch for Docker/PM2 events)
- Session DB size (should stay under 1MB)
- /tmp/ directory (cleanup removes old files daily)
- Queue depth (use `/pending` command)
- Dedupe hit rate (check logs for duplicates caught)

## Common Issues

### Bot not responding
```bash
pm2 logs claw-bot --lines 100
# Look for errors, check Claude CLI path
# Check working directory: /root/claw-workspace exists
```

### Webhook conflicts
```bash
# Only one bot can hold the webhook at a time
pm2 list  # Check for other processes using same token
pm2 stop <conflicting-process>
pm2 restart claw-bot
```

### Messages stuck in queue
```bash
# Use Telegram commands
/pending   # Check queue status
/stop      # Cancel queued messages
```

### Alerts not firing
```bash
pm2 logs claw-alerts --lines 100
# Check Docker events and PM2 log tailing
```

### Heartbeat not running
```bash
crontab -l | grep heartbeat
tail -f /var/log/pm2/claw-heartbeat-cron.log
```

### Session database locked
```bash
pm2 stop claw-bot
rm /root/bot-circus/performers/claw/data/sessions.db-*
pm2 start claw-bot
```

### Duplicate messages processing
```bash
# Check dedupe.mjs exists
ls -la /root/bot-circus/performers/claw/dedupe.mjs

# Check logs for dedupe activity
pm2 logs claw-bot | grep -i dedupe
```

## Success Criteria

✅ Bot responds to /start
✅ Sessions persist across messages
✅ /clear resets session
✅ Heartbeat runs every 30 minutes
✅ Alerts fire on Docker/PM2 events (if enabled)
✅ Cleanup runs daily at 4am
✅ Files upload/download correctly
✅ System prompt loads (43,921 chars)
✅ Webhook receives messages (100-500ms latency)
✅ Queue processes messages FIFO
✅ /pending and /stop commands work
✅ Dedupe prevents duplicate processing

## Post-Deployment

After 24 hours:
- Check heartbeat logs for any issues
- Verify no session DB locks
- Check PM2 restart count (should be 0)
- Review alert logs for noise
- Confirm cleanup ran at 4am
- Check queue performance (`/pending`)
- Verify dedupe is catching duplicates (check logs)

## Architecture Notes

**Webhook Mode:**
- Endpoint: https://whatshubb.co.za/webhook/claw
- Port: 7710
- Replaces legacy long polling
- Lower latency (~100-500ms vs 1-3s)
- More reliable

**Queue System:**
- Per-chat FIFO (messages processed in order)
- No drop-on-busy (all messages queued)
- `/pending` to check status
- `/stop` to cancel queued messages
- Replaces legacy `processingChats` set

**Dedupe:**
- LRU cache (max 200 entries)
- 30 second TTL window
- Prevents duplicate Telegram messages
- Implemented in `dedupe.mjs`

**Working Directory:**
- Claude runs in `/root/claw-workspace`
- Isolated from bot code
- Set via `CLAUDE_WORKING_DIR` env var

**Performer Ecosystem:**
- Claw is part of bot-circus
- Other performers: octo, friday, 007, wa-drone, webbs
- Shared libs in `/root/bot-circus/lib/`

## Support

Logs locations:
- Bot: `/var/log/pm2/claw-bot-*.log`
- Alerts: `/var/log/pm2/claw-alerts-*.log`
- Heartbeat: `/var/log/pm2/claw-heartbeat-cron.log`
- Cleanup: `/var/log/pm2/claw-cleanup-cron.log`

Database:
- Location: `/root/bot-circus/performers/claw/data/sessions.db`
- Backup: `cp sessions.db sessions-$(date +%Y%m%d).db`

PM2:
- Process name: `claw-bot`
- Ecosystem: `/root/bot-circus/performers/claw/ecosystem.config.cjs`

---

**READY TO DEPLOY** ✅
