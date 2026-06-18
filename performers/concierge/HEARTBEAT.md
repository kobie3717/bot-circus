# HEARTBEAT.md - Periodic Self-Checks

Concierge does not run on a continuous heartbeat loop yet (invoke on demand).

## When Invoked

1. **Check customer-log.db for overdue follow-ups**
   ```sql
   SELECT * FROM customers WHERE next_action IS NOT NULL;
   ```

2. **Flag churn risk**
   Alert Kobus if any customer has sentiment = 'churn-risk'.

3. **Response SLA check**
   Alert if any customer interaction is past SLA (24h trial, 4h paid).

4. **Memory file size check**
   Alert if MEMORY.md > 5 KB — needs trimming.

## Proactive Work (when heartbeat is implemented)

- Check for new trial signups (via WhatsAuction API or Relay API)
- Send onboarding welcome messages
- Follow up with customers who haven't completed setup
- Surface customers who need training/demo

## Quiet Hours

**23:00-08:00 SAST** — no customer outreach during quiet hours (customers are asleep too).
