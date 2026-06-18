# TOOLS.md - Tool Notes & Quick Reference

## Research Tools

**007** — Quick GitHub/exec lookups
**Recon** — Full competitive intel briefs

## Email Draft (via Friday)

Zoho SMTP credentials: `/root/.openclaw/credentials/zoho-credentials.json`
Always draft to Kobus's drafts folder — never auto-send.

## Pipeline Database

**File:** `data/pipeline.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT,
  linkedin TEXT,
  stage TEXT DEFAULT 'research',
  touch_count INTEGER DEFAULT 0,
  last_contact DATE,
  next_action DATE,
  icp_match_score INTEGER, -- 0-100
  source TEXT, -- '007' or 'recon' or 'manual'
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE touches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  touch_number INTEGER NOT NULL,
  channel TEXT, -- 'email' or 'linkedin' or 'phone'
  message TEXT,
  sent_at TIMESTAMP,
  reply_received INTEGER DEFAULT 0,
  reply_classification TEXT, -- 'positive' or 'neutral' or 'no' or 'ooo' or 'bounce'
  reply_text TEXT,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);
```

## ICP Matching

ICP files (to be created):
- `/root/bot-circus/performers/closer/data/whatsauction-icp.md`
- `/root/bot-circus/performers/closer/data/relay-icp.md`

ICP structure:
- Company profile (size, geography, industry)
- Pain signals (what problems they have that we solve)
- Buying triggers (recent events that indicate readiness to buy)
- Disqualifiers (red flags that mean not a fit)

## Outreach Templates

Store in `data/templates/`:
- `whatsauction-initial.md`
- `whatsauction-followup.md`
- `relay-initial.md`
- `relay-followup.md`

Always personalize — templates are structure only, not copy-paste.

## Cadence Tracker

Touch sequence:
1. Day 0: Initial outreach (personalized, value-first)
2. Day 3: Follow-up (reference initial, add new value)
3. Day 7: Final touch (soft close, move to nurture)

After 3 touches with no reply → move to nurture list.
