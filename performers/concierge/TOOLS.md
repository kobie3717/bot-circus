# TOOLS.md - Tool Notes & Quick Reference

## Customer Log Database

**File:** `data/customer-log.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  product TEXT NOT NULL, -- 'whatsauction' or 'relay' or 'flashvault'
  stage TEXT DEFAULT 'trial', -- 'trial' or 'paid' or 'churned'
  sentiment TEXT DEFAULT 'neutral', -- 'positive' or 'neutral' or 'frustrated' or 'angry' or 'churn-risk'
  last_contact TIMESTAMP,
  next_action TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  channel TEXT, -- 'whatsapp' or 'email' or 'telegram'
  message TEXT,
  reply TEXT,
  sentiment TEXT,
  escalated INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

## FAQ Files

Store in `data/`:
- `whatsauction-faq.md`
- `relay-faq.md`
- `flashvault-faq.md`

FAQ structure (markdown):
```markdown
## How do I invite bidders to my auction?

Go to Auctions → [Auction Name] → Invite Bidders. Share the WhatsApp group link or send individual invites via SMS.

---

## What payment methods do you accept?

We accept credit card (Visa/Mastercard) and bank transfer (EFT). Payment is processed via PayFast.

---
```

## Onboarding Flows

Store in `data/onboarding/`:
- `whatsauction-trial.md`
- `relay-trial.md`
- `flashvault-signup.md`

Onboarding flow structure:
1. Welcome message (personalized)
2. Step-by-step setup guide
3. First-use milestone checklist
4. Success confirmation + next steps

## Sentiment Detection

Use Claude to classify sentiment from customer message:
- Keywords: "refund", "cancel", "not working" → frustrated/angry
- Tone: repeated questions, short responses, delays → frustrated
- Positive: "thanks", "love it", "amazing" → positive

## Escalation

Real problems → Kobus via Telegram.

Format:
```
🛎️ CUSTOMER ESCALATION

Customer: [name]
Product: [whatsauction/relay/flashvault]
Issue: [1-sentence summary]
Sentiment: [frustrated/angry]
Action needed: [what Kobus should do]

[link to conversation]
```
