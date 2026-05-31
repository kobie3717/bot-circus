# HEARTBEAT.md - Periodic Self-Checks

## DISABLED SERVICES (do NOT check or alert on these)
- claw-whatsapp (port 7700) — STOPPED, do not check
- claw-email (port 7701) — STOPPED, do not check
- claw-monitor — STOPPED, do not check
- Do NOT send any alerts about claw-* services

## On Every Heartbeat

1. **Check friday-bot PM2 status**
   ```bash
   pm2 jlist | jq -r '.[] | select(.name == "friday-bot") | "\(.name): \(.pm2_env.status)"'
   ```
   Expected: `friday-bot: online`

2. **Check Docker containers**
   ```bash
   docker ps --format "{{.Names}} {{.Status}}" | grep -v "Up"
   ```
   Expected Docker: whatsauction-api, whatsapp-worker, whatsbookings, whatsbookings-whatsapp, whatshub-api, whatsmap-api, whatsstatus-app
   Alert if any not "Up"

3. **Check other PM2 services**
   ```bash
   pm2 jlist | jq -r '.[] | select(.pm2_env.status != "online" and (.name | startswith("claw-") | not) and .name != "friday-bot") | .name'
   ```
   Expected PM2: whatsvault-api, umami, n8n
   Alert if any not online (excluding claw-* services)

4. **Check WhatsAuction API health**
   ```bash
   curl -sf http://localhost:4000/health | jq .status
   ```
   Should return: "ok"

5. **Check disk usage**
   ```bash
   df -h / | tail -1
   ```
   Alert if >85%

6. **Check Telegram bot connectivity**
   ```bash
   pm2 logs friday-bot --lines 10 --nostream | grep -i "error\|disconnected\|failed"
   ```
   Alert if connection errors found

7. **Check inbox size**
   Check if inbox has critical unread items via `/inbox` command

8. **Memory file size check**
   ```bash
   wc -c /root/bot-circus/performers/friday/MEMORY.md
   ```
   Alert if >5120 bytes (5KB) — needs trimming

## Alert Kobus if:

- friday-bot PM2 process is not online
- Any Docker container is not "Up"
- Any PM2 process is not "online" (excluding claw-* services)
- WhatsAuction health endpoint fails or shows degraded
- Disk usage > 85%
- Telegram bot connection errors
- Error spikes in logs: `docker logs whatsauction-api --tail 20 2>&1 | grep -i error`
- MEMORY.md exceeds 5KB

## Proactive Maintenance (during heartbeat)

1. **Compact memory files**
   - If MEMORY.md > 3KB, review and trim outdated entries
   - Move old detailed logs to `memory/archive-YYYY-MM-DD.md`
   - Delete daily memory files older than 7 days

2. **Email inbox check**
   - Check for urgent emails via inbox aggregator
   - Flag items requiring attention

3. **Session cleanup**
   - Run cleanup-sessions.mjs if needed
   - Remove stale Claude sessions

4. **Documentation sync**
   - Update MEMORY.md with recent learnings
   - Keep TOOLS.md current with new endpoints/functions

## Quiet Hours

**23:00-08:00 SAST** — only alert for critical issues:
- friday-bot crashed
- WhatsAuction API down
- Disk >95% full
- Customer-impacting outages

Non-urgent alerts should wait until 08:00.

## Circus Mesh Health

Check Circus connectivity:
```bash
curl -sf http://localhost:6200/health | jq .
```

Verify friday-174577 is registered and active.
