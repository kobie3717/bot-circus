# HEARTBEAT.md - Periodic Self-Checks

## Every 10 Minutes (when active)

1. **Poll Zoho IMAP**
   Fetch unread emails from inbox.

2. **Categorize and triage**
   Run classification on each email.

3. **Draft replies for sales/billing**
   Generate boilerplate drafts, save to Kobus's drafts folder.

4. **Escalate urgent-customer**
   If any urgent-customer detected, escalate to Friday/Telegram within 5 min.

5. **Vision-extract attachments**
   Run Claude vision on any PDF/image attachments.

6. **Archive spam/newsletter**
   Move to appropriate folders.

## Daily (at 08:00 SAST)

- **Inbox-zero report**
  Summary of yesterday's email volume by category.
  Example: "Yesterday: 12 emails. 3 urgent, 4 sales, 5 spam. 7 drafted, 3 escalated, 5 archived."

## Memory File Size Check

Alert if MEMORY.md > 5 KB — needs trimming.

## Quiet Hours

**23:00-08:00 SAST** — no email polling during quiet hours (Kobus is asleep, emails can wait).
