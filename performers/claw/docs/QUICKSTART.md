# Quick Start Guide

## Prerequisites

**Webhook Configuration:**
Claw runs in webhook mode at `https://whatshubb.co.za/webhook/claw` (port 7710).
Ensure reverse proxy (nginx/caddy) is configured to forward webhook requests.

## Installation (Already Done)

```bash
cd /root/bot-circus/performers/claw
npm install  ✓ Complete
```

## Test Claude CLI Integration

```bash
cd /root/bot-circus/performers/claw
node test-cli.mjs
```

Expected: Claude responds with current directory info.

## Test Bot (Development Mode)

```bash
cd /root/bot-circus/performers/claw
node bot.mjs
```

Then on Telegram:
1. Open @Theclawbotbot
2. Send: `/start`
3. Send: `Hello, who are you?`

Press Ctrl+C to stop.

**Note:** Dev mode still uses webhook. Ensure webhook is properly configured.

## Start Bot (Production)

```bash
cd /root/bot-circus
pm2 start performers/claw/ecosystem.config.cjs
```

## Check Status

```bash
pm2 status claw-bot
# or
pm2 list
```

## Watch Logs

```bash
pm2 logs claw-bot
# or
pm2 logs claw-bot --lines 100
```

## Stop Bot

```bash
pm2 stop claw-bot
# or
pm2 delete claw-bot
```

## Troubleshooting

### Webhook conflicts

Only one bot can use the token at a time. If getting webhook errors:
```bash
pm2 list
# Look for other processes using the same bot token
pm2 stop <conflicting-process>
pm2 restart claw-bot
```

### Bot doesn't respond

Check logs:
```bash
pm2 logs claw-bot --lines 100
```

Check authorization:
```bash
# Your Telegram user ID must be: 6531675960
cat /root/bot-circus/performers/claw/.env | grep ALLOWED_USER_ID
```

Check webhook endpoint:
```bash
# Verify reverse proxy is forwarding to port 7710
curl -X POST https://whatshubb.co.za/webhook/claw
```

### Empty responses from Claude

Test CLI directly:
```bash
cd /root/bot-circus/performers/claw
node test-cli.mjs
```

If that fails, check Claude CLI exists:
```bash
ls -lh /root/.local/share/claude/versions/2.1.76
```

Check working directory:
```bash
# Ensure workspace exists
ls -la /root/claw-workspace
```

### Messages not processing (stuck in queue)

Check queue status:
```bash
# Send via Telegram
/pending
```

Cancel stuck messages:
```bash
# Send via Telegram
/stop
```

### Duplicate messages

Dedupe should prevent this. Check if `dedupe.mjs` is present:
```bash
ls -la /root/bot-circus/performers/claw/dedupe.mjs
```

## Common Commands

| Command | Description |
|---------|-------------|
| `pm2 start performers/claw/ecosystem.config.cjs` | Start with PM2 |
| `pm2 stop claw-bot` | Stop bot |
| `pm2 restart claw-bot` | Restart bot |
| `pm2 status claw-bot` | Show status |
| `pm2 logs claw-bot` | View logs |
| `pm2 logs claw-bot --lines 100` | Last 100 lines |
| `pm2 monit` | Real-time monitor |

## Configuration

Edit `.env` file:

```bash
nano /root/bot-circus/performers/claw/.env
```

Then restart:
```bash
pm2 restart claw-bot
```

## PM2 Auto-Start on Reboot

```bash
pm2 startup
pm2 save
```

## Data Locations

- **Sessions DB:** `/root/bot-circus/performers/claw/data/sessions.db`
- **Tasks DB:** `/root/bot-circus/performers/claw/data/tasks.db`
- **Alerts DB:** `/root/bot-circus/performers/claw/data/proactive-alerts.db`
- **Queue DB:** `/root/bot-circus/performers/claw/data/queue.db`
- **Logs:** `/var/log/pm2/claw-bot-*.log`

## Quick Health Check

```bash
# PM2 status
pm2 status claw-bot

# Recent logs
pm2 logs claw-bot --lines 20

# Check databases exist
ls -lh /root/bot-circus/performers/claw/data/

# Check webhook port listening
netstat -tlnp | grep 7710
```

## Telegram Bot Commands

Quick reference (see COMMAND_REFERENCE.md for full list):

- `/start` - Wake up bot
- `/status` - Health check
- `/pending` - Check message queue
- `/stop` - Cancel queued messages
- `/alerts` - View recent alerts
- `/jobs` - List background jobs
- `/clear` - Reset session

## Full Documentation

- `ARCHITECTURE.md` - System design
- `COMMAND_REFERENCE.md` - All Telegram commands
- `QUICKSTART.md` - This file
- `DEPLOYMENT.md` - Deployment guide

## Support

- Bot: @Theclawbotbot
- Allowed User: 6531675960
- Working Dir: /root/claw-workspace
- Model: opus
- Timeout: 120s
- Webhook: https://whatshubb.co.za/webhook/claw
- Port: 7710
- PM2 Name: claw-bot
- Performer: Part of bot-circus ecosystem

## Performer Ecosystem

Claw is one of several bot-circus performers:
- **claw** - Main Claude assistant
- **octo** - GitHub operations
- **friday** - Proactive monitoring
- **007** - Security tasks
- **wa-drone** - WhatsApp automation
- **webbs** - Web scraping

Shared libraries: `/root/bot-circus/lib/`
