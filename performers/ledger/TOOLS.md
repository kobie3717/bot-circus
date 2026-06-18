# TOOLS.md - Tool Notes & Quick Reference

## Finance Database

**File:** `data/finance.db` (SQLite)
**Schema (to be created on first run):**

```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount_zar REAL NOT NULL,
  category TEXT NOT NULL, -- 'revenue' or 'cogs' or 'opex' or 'one-off'
  subcategory TEXT,
  source TEXT, -- 'bank' or 'stripe' or 'payfast'
  reconciled INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,
  vendor TEXT NOT NULL,
  amount_zar REAL NOT NULL,
  due_date DATE NOT NULL,
  paid INTEGER DEFAULT 0,
  paid_at DATE,
  category TEXT NOT NULL
);

CREATE TABLE monthly_pl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL, -- 'YYYY-MM'
  revenue_zar REAL NOT NULL,
  cogs_zar REAL NOT NULL,
  opex_zar REAL NOT NULL,
  profit_zar REAL NOT NULL,
  mrr_zar REAL,
  arr_zar REAL,
  runway_months REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Bank CSV Import

Bank exports in `data/imports/`.

CSV structure (Standard Bank format):
```
Date,Description,Amount,Balance
2026-04-01,WHATSAUCTION SUBSCRIPTION,450.00,12345.67
```

## Stripe API

**Endpoint:** https://api.stripe.com/v1/charges
**Auth:** Bearer token (creds in `/root/.openclaw/credentials/stripe-credentials.json`)

Pull transactions:
```bash
curl https://api.stripe.com/v1/charges \
  -u sk_test_xxx: \
  -G -d limit=100 -d created[gte]=1609459200
```

## PayFast API

**Endpoint:** https://api.payfast.co.za/subscriptions
**Auth:** Merchant ID + passphrase (creds in `/root/.openclaw/credentials/payfast-credentials.json`)

## Exchange Rates

Source: XE.com or SARB (South African Reserve Bank).

Example:
```bash
curl -s "https://api.exchangerate-api.com/v4/latest/USD" | jq '.rates.ZAR'
```

Store exchange rates in `data/exchange-rates.db` for historical accuracy.

## P&L Generation

Monthly P&L formula:
- Revenue = SUM(transactions WHERE category='revenue' AND month=X)
- COGS = SUM(transactions WHERE category='cogs' AND month=X)
- OPEX = SUM(transactions WHERE category='opex' AND month=X)
- Profit = Revenue - COGS - OPEX

## Runway Calculation

Runway formula:
```
runway_months = (bank_balance + accounts_receivable) / avg_monthly_burn
```

Alert Kobus if runway <4 months.
