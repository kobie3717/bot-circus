# TOOLS.md - Tool Notes & Quick Reference

## Email Integration

**IMAP:** Zoho (`imappro.zoho.com`)
**SMTP:** Zoho (`smtppro.zoho.com`)
**Creds:** `/root/.openclaw/credentials/zoho-credentials.json`

Poll frequency: every 10 min when active.

## Email Log Database

**File:** `data/email-log.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at TIMESTAMP NOT NULL,
  category TEXT NOT NULL,
  urgency TEXT, -- 'urgent' or 'normal' or 'low'
  draft_created INTEGER DEFAULT 0,
  escalated INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  extracted_text TEXT,
  extracted_data JSON, -- structured data from vision-extract
  FOREIGN KEY (email_id) REFERENCES emails(id)
);
```

## Boilerplate Templates

Store in `data/templates/`:
- `whatsauction-trial-inquiry.md`
- `relay-demo-request.md`
- `invoice-request.md`
- `support-acknowledgment.md`

## Vision Extract (Attachments)

Use Claude vision API to extract:
- Invoice: vendor, amount, due date, invoice number
- Contract: parties, term, value, key obligations
- Receipt: merchant, date, amount, category

## Escalation

Urgent-customer emails → Friday → Telegram within 5 min.

Format:
```
🚨 URGENT CUSTOMER EMAIL

From: [sender]
Subject: [subject]
Summary: [1-sentence summary]
Action needed: [what Kobus should do]

[link to email in drafts]
```

## Sender History

Track frequent senders to improve classification accuracy.
Example: matt@bullamore.com → always "sales" or "personal" (not spam).
