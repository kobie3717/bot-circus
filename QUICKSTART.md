# Bot-Circus Quick Start Guide

Get your first Telegram bot powered by Claude running in 5 minutes.

## Prerequisites

- Node.js ≥20 installed
- [Claude Code CLI](https://claude.com/claude-code) installed
- A Telegram bot token from [@BotFather](https://t.me/botfather)

## Step 1: Get a Telegram Bot Token

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow the prompts to choose a name and username
4. Copy the bot token (looks like `1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ`)

## Step 2: Install Bot-Circus

```bash
cd /root/bot-circus
npm install
chmod +x bin/circus.js
```

## Step 3: Verify Installation

```bash
bash test-installation.sh
```

All tests should pass.

## Step 4: Create Your First Bot

```bash
./bin/circus.js add-performer \
  --name "MyFirstBot" \
  --token "YOUR_BOT_TOKEN_HERE" \
  --persona templates/default.soul.md
```

Replace `YOUR_BOT_TOKEN_HERE` with your actual token from BotFather.

## Step 5: Start the Orchestrator

```bash
./bin/circus.js serve
```

Keep this terminal open. The orchestrator is now running.

## Step 6: Test Your Bot

1. Open Telegram
2. Find your bot (the username you chose in Step 1)
3. Send a message: "Hello!"
4. Your bot should respond!

## Step 7: Monitor Your Bot

In a new terminal:

```bash
# See bot status
./bin/circus.js list

# View real-time dashboard
./bin/circus.js top

# View logs
./bin/circus.js logs myfirstbot --follow
```

## What's Next?

### Customize Your Bot's Personality

Edit the persona file:

```bash
nano performers/myfirstbot/SOUL.md
```

Then restart:

```bash
./bin/circus.js restart myfirstbot
```

### Add More Bots

```bash
./bin/circus.js add-performer \
  --name "SecondBot" \
  --token "ANOTHER_TOKEN" \
  --persona templates/customer-support.soul.md
```

### Create a Shared Memory Team

```bash
# Create a troupe
./bin/circus.js add-troupe support-team

# Add bots to the troupe
./bin/circus.js add-performer \
  --name "SupportBot1" \
  --token "TOKEN_1" \
  --troupe support-team

./bin/circus.js add-performer \
  --name "SupportBot2" \
  --token "TOKEN_2" \
  --troupe support-team
```

Both bots now share knowledge via `troupes/support-team/MEMORY.md`!

### Run as a Service (Production)

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

Now your bots will auto-start on server reboot!

## Troubleshooting

### Bot not responding?

1. Check orchestrator is running: `./bin/circus.js health`
2. View logs: `./bin/circus.js logs <bot-id> --follow`
3. Verify token is correct in `performers/<bot-id>/config.json`

### "Orchestrator not running" error?

Make sure `circus serve` is running in another terminal, or run as a systemd service.

### Claude CLI errors?

Verify Claude CLI is installed and working:

```bash
claude --version
```

If not installed, visit [claude.com/claude-code](https://claude.com/claude-code).

## Learn More

- [Full README](./README.md) — Complete documentation
- [Examples](./EXAMPLES.md) — Common use cases
- [Technical Spec](./SPEC.md) — Architecture details
- [Contributing](./CONTRIBUTING.md) — Development guide

## Support

- GitHub Issues: [github.com/kobie3717/bot-circus/issues](https://github.com/kobie3717/bot-circus/issues)
- Author: [@kobie3717](https://github.com/kobie3717)

Happy bot building! 🎪
