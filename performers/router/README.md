# Router Bot

Intelligent task router for the bot-circus mesh. Routes incoming tasks from Kobus to the best performer based on capabilities.

## Files Created

- `/root/bot-circus/performers/router/config.json` — Bot config
- `/root/bot-circus/performers/router/bot.mjs` — Main bot implementation (147 lines)
- `/root/bot-circus/performers/router/package.json` — Dependencies
- `/root/bot-circus/performers/router/.env.example` — Environment template

## Setup

### 1. Create Telegram Bot

Talk to [@BotFather](https://t.me/BotFather) on Telegram:

```
/newbot
Name: Router Bot
Username: <pick something like router_circus_bot>
```

BotFather will reply with your token: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### 2. Get Kobus's Chat ID

If you don't know it already:
- Message any existing bot (e.g., @claw_assistant_bot)
- Check that bot's logs for your user ID

OR use this quick method:
```bash
# Start the router bot temporarily without KOBUS_CHAT_ID
# Send it a test message
# Check logs for: "Ignored message from unauthorized user <ID>"
# That ID is your KOBUS_CHAT_ID
```

### 3. Install Dependencies

```bash
cd /root/bot-circus/performers/router
npm install
```

### 4. Configure Environment

```bash
cd /root/bot-circus/performers/router
cp .env.example .env
nano .env
```

Fill in:
```env
TELEGRAM_BOT_TOKEN=<token from BotFather>
ANTHROPIC_AUTH_TOKEN=<your Claude API key>
KOBUS_CHAT_ID=<your Telegram user ID>
CIRCUS_URL=http://127.0.0.1:6200
```

### 5. Start with PM2

```bash
pm2 start /root/bot-circus/performers/router/bot.mjs --name router-bot
pm2 save
```

## Usage

1. Message the router bot on Telegram with any task
2. It analyzes the task and routes to the best performer:
   - **Octo** — code, debug, files, git
   - **007** — research, intel, web searches
   - **Friday** — ops, monitoring, scheduling
   - **Claw** — general assistant, WhatsApp, email
   - **WA Drone** — WhatsApp-specific

3. Router replies: `🧭 Router → [BotName] ([score])\n[reason]`
4. The target bot receives the task via Circus and DMs you directly

## Routing Logic

**Primary**: Claude Haiku-4.5 analyzes the task and returns JSON with bot selection + reasoning

**Fallback**: Keyword matching if Claude API unavailable
- Searches for capability keywords in task text
- Scores each bot by keyword matches
- Defaults to Claw for general tasks

## Security

Only accepts messages from `KOBUS_CHAT_ID` — all other users are ignored.

## Monitoring

```bash
pm2 logs router-bot
pm2 monit
```

## Architecture

- Grammy.js for Telegram bot framework
- Anthropic SDK for Claude-based routing
- Circus Bridge for task submission to mesh
- ~150 lines of clean, readable code
