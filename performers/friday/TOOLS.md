# TOOLS.md - Tool Notes & Quick Reference

## Telegram Bot

**Handle:** @friday_assistant_bot
**Token:** From .env (TELEGRAM_BOT_TOKEN)
**Framework:** grammy (long-poll mode)
**Main file:** `bot.mjs` (57KB)

### Available Commands
- `/help` — Show available commands
- `/inbox` — Check unread messages from all sources
- `/dashboard` — Server status overview
- `/email <recipient> <subject> <body>` — Send email via Zoho SMTP
- `/action <name>` — Execute predefined action
- `/session` — Show Claude session info
- `/clear` — Clear Claude session
- Voice messages → Auto-transcribe with Whisper

## Email Integration

**SMTP:** Zoho (email-sender.mjs)
**IMAP:** Zoho (email-reader.mjs)
**Creds:** `/root/.openclaw/credentials/zoho-credentials.json`

### Functions
```javascript
// From email-sender.mjs
await verifySmtp()
await sendEmail({ to, subject, body, attachments, from, replyTo, cc, bcc })

// From email-reader.mjs
// Auto-polls IMAP and adds to inbox
```

## Inbox Aggregator

**File:** `inbox.mjs`
**Purpose:** Centralized message queue from email, WhatsApp, alerts

### Functions
```javascript
addMessage(message)           // Add to inbox
getUnread(source, limit)      // Get unread items
markRead(id)                  // Mark single message read
markAllRead(source)           // Mark all read (optional source filter)
search(query, limit)          // Search inbox messages
getStats()                    // Get inbox statistics
```

## Dashboards

**File:** `dashboards.mjs`

### Functions
```javascript
await fullDashboard()         // Complete server status
await serverDashboard()       // Server health only
await whatsauctionDashboard() // WhatsAuction-specific stats
await flashvaultDashboard()   // FlashVault VPN stats
```

### Checks
- PM2 processes (online/stopped)
- Docker containers (up/down)
- Disk usage
- API health endpoints
- Memory usage

## Actions System

**File:** `actions.mjs`
**Purpose:** Execute predefined server operations

### Functions
```javascript
listActions()                 // Show available actions
getAction(name)              // Get action details
executeAction(name)          // Run action
```

### Predefined Actions
- Server restarts
- Log checks
- Cleanup operations
- Health checks

## Circus Bridge

**File:** `circus-bridge.mjs` (46KB)
**Purpose:** Integration with Circus mesh network

### Core Functions
```javascript
// Registration & Connectivity
await circusRegister(name, role)
await circusJoinRooms(rooms)
startHeartbeat(intervalMs)
enableAutoReconnect(name, role, intervalMs)

// Shared Memory
await getRelevantSharedKnowledge(query, { limit })
await writeSharedKnowledge(content, category, confidence, domain, agentName)
await writeCorrection(correctedContent, reason, agentName, supersedesId)

// User Preferences
await buildPreferenceContext()
await publishPreference(field, value, confidence, reasoning)
detectPreferenceSignals(text)

// Task Queue
registerTaskHandler(taskType, handler, opts)
startTaskInboxPoller(intervalMs)
await submitTask(toAgentId, taskType, payload, deadline)
```

## Voice Transcription

**File:** `voice.mjs`
**Provider:** OpenAI Whisper API

### Function
```javascript
await transcribe(audioFilePath) // Returns text transcript
```

## Confirmation System

**File:** `confirm.mjs`
**Purpose:** Two-step confirmation for destructive actions

### Functions
```javascript
generateActionId()
createConfirmKeyboard(actionId)  // Telegram inline keyboard
addPendingAction(actionId, { type, data, chatId, description })
getPendingAction(actionId)
removePendingAction(actionId)
```

## Session Management

**File:** `sessions.mjs`
**Purpose:** Claude API session persistence

### Functions
```javascript
getOrCreateSession(chatId)
clearSession(chatId)
getSessionInfo(chatId)
getStats()
```

## WhatsApp Bridge (Legacy)

**File:** `whatsapp.mjs` (11KB)
**Note:** May be deprecated in favor of WaSP protocol

## Alerts & Monitoring

**File:** `alerts.mjs` (4.7KB)
**Purpose:** Proactive system alerts

**File:** `monitor.mjs` (15KB)
**Purpose:** Continuous health monitoring

## WhatsAuction API

**Base URL:** `http://localhost:4000` (direct, no SSH needed)
**Health:** `curl -s http://localhost:4000/health | jq .`
**Spec:** `cat /root/whatsauction/SPEC.md`

### Auth
```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"EMAIL","password":"PASS"}' | jq .
# Use token: -H "Authorization: Bearer TOKEN"
```

### Key Endpoints
- `GET /health` — system health
- `POST /api/auth/login` — get JWT
- `GET /api/auctions` — list auctions
- `GET /api/lots?auctionId=X` — lots for auction
- `POST /api/bids` — place bid
- `GET /api/invoices` — list invoices
- `GET /api/whatsapp-groups/status` — WhatsApp connection status

## Database

```bash
PGPASSWORD=vpn_secure_password_2025 psql -U vpn_user -d whatsauction -h localhost
```

## PM2

```bash
pm2 list                    # Show all processes
pm2 logs friday-bot         # Friday logs
pm2 logs whatsauction-api   # API logs
pm2 logs whatsapp-worker    # Worker logs
pm2 reload <name>           # Zero-downtime reload
```

## File Locations

- **Friday runtime:** `/root/bot-circus/performers/friday/`
- **Friday workspace (legacy):** `/root/friday-workspace/`
- **WhatsAuction:** `/root/whatsauction/`
- **Backend:** `/root/whatsauction/backend/`
- **Frontend:** `/root/whatsauction/frontend/`
- **Reference docs:** `/root/.openclaw/reference/`
- **Credentials:** `/root/.openclaw/credentials/`
- **Circus identity:** `/root/.circus/friday-identity.json`

## Zoho Email

- **IMAP:** `imappro.zoho.com`
- **SMTP:** `smtppro.zoho.com`
- **Creds:** `/root/.openclaw/credentials/zoho-credentials.json`
