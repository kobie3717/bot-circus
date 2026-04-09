# Bot-Circus Examples

This document provides practical examples for common use cases.

## Example 1: Personal Assistant

Create a single bot as your personal assistant.

```bash
# Add the bot
circus add-performer \
  --name "MyAssistant" \
  --token "YOUR_TELEGRAM_BOT_TOKEN" \
  --persona templates/default.soul.md

# Start the orchestrator
circus serve
```

Now chat with your bot on Telegram. It will remember context across conversations using its local MEMORY.md file.

## Example 2: Customer Support Team

Create a team of 3 support bots sharing knowledge.

```bash
# Create the troupe
circus add-troupe customer-support

# Add bot 1
circus add-performer \
  --name "SupportBot Alpha" \
  --token "TOKEN_1" \
  --troupe customer-support \
  --persona templates/customer-support.soul.md

# Add bot 2
circus add-performer \
  --name "SupportBot Beta" \
  --token "TOKEN_2" \
  --troupe customer-support \
  --persona templates/customer-support.soul.md

# Add bot 3
circus add-performer \
  --name "SupportBot Gamma" \
  --token "TOKEN_3" \
  --troupe customer-support \
  --persona templates/customer-support.soul.md

# Start all
circus serve
```

All three bots share the same MEMORY.md via symlink. Knowledge learned by one is immediately available to the others.

## Example 3: Specialized Bot Team (No Memory Sharing)

Create bots for different tasks without shared memory.

```bash
# Sales bot
circus add-performer \
  --name "SalesBot" \
  --token "TOKEN_SALES" \
  --persona templates/sales-agent.soul.md

# Dev helper bot
circus add-performer \
  --name "DevBot" \
  --token "TOKEN_DEV" \
  --persona templates/dev-helper.soul.md

# Meme bot for team morale
circus add-performer \
  --name "MemeBot" \
  --token "TOKEN_MEME" \
  --persona templates/meme-lord.soul.md

circus serve
```

Each bot has its own isolated memory and persona.

## Example 4: Custom Persona

Create a bot with a custom personality.

```bash
# Create your persona file
cat > my-persona.md << 'EOF'
# My Custom Bot Persona

You are a pirate captain AI assistant on Telegram. Arr!

## Speaking Style
- Use pirate slang ("ahoy", "matey", "arr")
- Be adventurous and enthusiastic
- Make sailing and treasure metaphors
- End messages with "⚓️"

## Example Responses
User: "How are you?"
You: "Ahoy matey! I be sailin' smooth seas today! ⚓️"

User: "Help me plan my day"
You: "Arr! Let's chart a course for this fine day's adventures! ⚓️"
EOF

# Add the bot
circus add-performer \
  --name "CaptainBot" \
  --token "YOUR_TOKEN" \
  --persona my-persona.md

circus serve
```

## Example 5: Monitoring and Management

```bash
# View all bots
circus list

# Check health
circus health

# View stats
circus stats

# Real-time dashboard
circus top

# View bot logs
circus logs supportbot-alpha --follow

# Pause a bot temporarily
circus pause supportbot-alpha

# Resume it
circus resume supportbot-alpha

# Restart a bot (reload config)
circus restart supportbot-alpha
```

## Example 6: Troupe Management

```bash
# Create multiple troupes
circus add-troupe customer-support
circus add-troupe sales-team
circus add-troupe dev-team

# List all troupes
circus list-troupes

# Move a bot between troupes
circus leave-troupe mybot       # Leave current troupe
circus join-troupe mybot sales-team

# See who's in a troupe
circus troupe-members sales-team
```

## Example 7: Restricting Bot Access

Edit `performers/<bot-id>/config.json` to restrict who can use the bot:

```json
{
  "telegram_config": {
    "allowed_users": ["@admin", "@manager", "123456789"],
    "respond_to_groups": false
  }
}
```

Then restart the bot:

```bash
circus restart <bot-id>
```

## Example 8: Rate Limit Configuration

Edit `performers/<bot-id>/config.json` to adjust rate limits:

```json
{
  "rate_limits": {
    "messages_per_minute": 30,
    "max_queue_size": 200
  }
}
```

Restart the bot to apply changes.

## Example 9: Production Deployment

```bash
# Create systemd service
sudo tee /etc/systemd/system/bot-circus.service << 'EOF'
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
EOF

# Enable and start
sudo systemctl enable bot-circus
sudo systemctl start bot-circus

# Check status
sudo systemctl status bot-circus

# View logs
sudo journalctl -u bot-circus -f
```

## Tips and Tricks

### Editing Bot Personas on the Fly

```bash
# Edit the SOUL.md file
nano performers/<bot-id>/SOUL.md

# Restart the bot to reload
circus restart <bot-id>
```

### Viewing Shared Troupe Memory

```bash
cat troupes/<troupe-name>/MEMORY.md
```

### Backup Bot Workspace

```bash
tar -czf bot-backup.tar.gz performers/<bot-id>/
```

### Testing with ngrok (Webhooks)

Bot-Circus uses polling by default, but you can configure webhooks by editing the orchestrator code. For testing locally:

```bash
ngrok http 3000
# Use the ngrok URL in your webhook config
```

### Monitoring with Prometheus

If metrics are enabled, scrape `http://localhost:9090/metrics`:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'bot-circus'
    static_configs:
      - targets: ['localhost:9090']
```

## Troubleshooting

### Bot not responding

1. Check if orchestrator is running: `circus health`
2. View bot logs: `circus logs <bot-id> --follow`
3. Check queue depth: `circus stats`
4. Verify Claude CLI works: `claude --version`

### Memory not shared in troupe

1. Verify symlink: `ls -la performers/<bot-id>/MEMORY.md`
2. Should show: `... -> /root/bot-circus/troupes/<troupe>/MEMORY.md`
3. If not, rejoin troupe: `circus leave-troupe <bot-id> && circus join-troupe <bot-id> <troupe>`

### High queue depth

1. Increase worker pool: Edit `circus.config.json` → `worker_pool.max_workers`
2. Or increase per-bot rate limit
3. Or add more bots to distribute load
