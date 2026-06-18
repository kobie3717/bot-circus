# HEARTBEAT.md - Periodic Self-Checks

## Monthly (on the 5th at 09:00 SAST)

1. **Generate monthly P&L**
   Close books for previous month. Generate P&L statement.

2. **Calculate runway**
   Formula: (bank balance + AR) / avg monthly burn.

3. **Alert if runway <4 months**
   Escalate to Kobus via Telegram.

4. **MRR/ARR tracking**
   Pull subscription data from WhatsAuction/Relay/FlashVault APIs.

5. **Invoice tracking**
   Surface unpaid invoices past due date.

## Weekly (Mondays at 09:00 SAST)

1. **Bank reconciliation**
   Compare bank balance vs finance.db. Flag discrepancies.

2. **Unpaid invoices**
   Surface invoices due this week.

## Memory File Size Check

Alert if MEMORY.md > 5 KB — needs trimming.

## Quiet Hours

**23:00-08:00 SAST** — no financial alerts during quiet hours (Kobus is asleep).
