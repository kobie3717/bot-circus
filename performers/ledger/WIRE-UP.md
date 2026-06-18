# WIRE-UP — Ledger 💰

Manual steps to get Ledger operational. Ledger is a CLI-only tool (no PM2, no Telegram bot yet).

---

## 1. Install dependencies

```bash
cd /root/bot-circus/performers/ledger
npm install
```

Should install `better-sqlite3` v12.8.0.

---

## 2. Make CLI executable globally (optional)

```bash
chmod +x /root/bot-circus/performers/ledger/cli.mjs
ln -sf /root/bot-circus/performers/ledger/cli.mjs /usr/local/bin/ledger
```

Now you can run `ledger <command>` instead of `node /root/bot-circus/performers/ledger/cli.mjs <command>`.

---

## 3. Initialize the database

```bash
ledger init
```

Creates `/root/bot-circus/performers/ledger/data/ledger.db` with schema + pre-seeded categories.

---

## 4. Add your accounts

Run `ledger account add` for each bank/payment gateway you use:

```bash
# FNB Business Account
ledger account add "FNB Business" ZAR bank 50000.00 2026-01-01

# Stripe EUR
ledger account add "Stripe EUR" EUR stripe 1200.00 2026-01-01

# PayFast ZAR
ledger account add "PayFast" ZAR payfast 0.00 2026-01-01
```

**Arguments:**
- `<name>` — friendly name (must be unique)
- `<currency>` — ZAR, EUR, USD, or GBP
- `<type>` — bank, stripe, payfast, or cash
- `<opening_balance>` — account balance on opening_date (float)
- `<opening_date>` — YYYY-MM-DD when you started tracking this account

Verify:
```bash
ledger accounts
```

---

## 5. Export CSVs from your bank/payment gateways

### FNB Business Online Banking
1. Log in to https://fnbonline.fnb.co.za
2. Go to "Accounts" → Select account → "Statements"
3. Choose date range (e.g. "May 2026")
4. Click "Export to CSV"
5. Save to `/tmp/fnb-2026-05.csv`

### Capitec Business
1. Log in to https://www.capitecbank.co.za/business-bank/login
2. "Transactions" → "Download"
3. Select "CSV" format
4. Save to `/tmp/capitec-2026-05.csv`

### Stripe
1. Log in to https://dashboard.stripe.com
2. "Balance" → "Balance History"
3. Click "Export" (top right) → CSV
4. Save to `/tmp/stripe-2026-05.csv`

### PayFast
1. Log in to https://www.payfast.co.za/login
2. "Transactions" → "Download"
3. CSV format
4. Save to `/tmp/payfast-2026-05.csv`

Ledger auto-detects most SA bank CSV formats (date, description, amount columns).

---

## 6. Ingest CSVs

```bash
ledger ingest /tmp/fnb-2026-05.csv --account "FNB Business"
ledger ingest /tmp/stripe-2026-05.csv --account "Stripe EUR"
ledger ingest /tmp/payfast-2026-05.csv --account "PayFast"
```

Ledger deduplicates automatically (hashes txn data). Re-running the same CSV won't create duplicates.

Output:
```
Ingesting /tmp/fnb-2026-05.csv into account "FNB Business"...
✓ Inserted: 127, Skipped (duplicates): 0

Run `ledger categorize` to auto-categorize new transactions.
```

---

## 7. Auto-categorize transactions

```bash
ledger categorize
```

Ledger uses rule-based matching (no LLM cost). Patterns:
- **Revenue:** Stripe, PayFast, payment received, invoice → `revenue`
- **COGS:** Twilio, SMS, API costs → `cogs`
- **OpEx Software:** Anthropic, OpenAI, AWS, Vercel, GitHub → `opex_software`
- **OpEx Marketing:** Google Ads, Facebook, LinkedIn → `opex_marketing`
- **OpEx Salaries:** Payroll, contractor, Upwork → `opex_salaries`
- **Taxes:** SARS, VAT, provisional tax → `taxes`
- **Transfers:** Internal, own account → `transfer` (excluded from P&L)
- **Fallback:** Unmatched → `opex_other` (low confidence, needs manual review)

Output:
```
Categorizing uncategorized transactions...
✓ Categorized 127 transactions.
```

To see uncategorized transactions (confidence=low):
```bash
ledger txns --category opex_other
```

Manually re-categorize in SQLite if needed:
```bash
sqlite3 /root/bot-circus/performers/ledger/data/ledger.db
UPDATE transactions SET category = 'opex_marketing' WHERE id = 42;
```

---

## 8. Run reports

### Monthly P&L
```bash
ledger pnl 2026-05
```

Output:
```
## P&L for 2026-05
Revenue:       R45,230.00
COGS:          R1,890.00
Gross Profit:  R43,340.00

Operating Expenses:
  opex_software        R3,450.00
  opex_marketing       R8,700.00
  opex_salaries        R25,000.00
  taxes                R2,100.00
Total OpEx:    R39,250.00

**Net Income:  R4,090.00**

Transactions: 127
```

### Runway projection
```bash
ledger runway
```

Output:
```
## Runway Projection
Cash Balance:       R98,450.00
Avg Monthly Burn:   R12,300.00 (last 3 months)
Runway:             8.0 months

✓ Runway healthy but monitor closely.
```

### Full report (Telegram-ready)
```bash
ledger report 2026-05
```

Produces markdown with P&L + runway + top 10 expenses + top 10 revenue sources.

### List transactions
```bash
# Last 50 txns
ledger txns

# Filter by date range
ledger txns --from 2026-05-01 --to 2026-05-31

# Filter by category
ledger txns --category opex_software --limit 100

# Filter by account
ledger txns --account "FNB Business"
```

### Snapshot (archive monthly data)
```bash
ledger snapshot 2026-05
```

Stores a row in `monthly_snapshots` table for historical tracking. Useful for charting MRR/burn over time later.

---

## 9. Wire into Friday (future)

Once Friday's `/ledger` command is ready, add this to Friday's command handler:

```javascript
// In /root/bot-circus/performers/friday/bot.mjs
case 'ledger':
  const args = ctx.message.text.split(' ').slice(1); // e.g. "/ledger pnl 2026-05"
  const result = execSync(`node /root/bot-circus/performers/ledger/cli.mjs ${args.join(' ')}`, { encoding: 'utf8' });
  await ctx.reply(result, { parse_mode: 'Markdown' });
  break;
```

Then Kobus can run `/ledger pnl 2026-05` in Telegram → Friday executes Ledger CLI → posts markdown report to chat.

---

## 10. Monthly routine (on the 5th of each month)

1. Export CSVs for previous month (e.g. on June 5, export May data)
2. `ledger ingest /tmp/fnb-2026-05.csv --account "FNB Business"`
3. `ledger ingest /tmp/stripe-2026-05.csv --account "Stripe EUR"`
4. `ledger categorize`
5. `ledger pnl 2026-05` — review
6. `ledger runway` — alert if <4 months
7. `ledger snapshot 2026-05` — archive
8. `ledger report 2026-05 > /tmp/ledger-may-report.md` — send to Telegram via Friday

---

## Security Notes

- **No auto-payment:** Ledger NEVER pays invoices. Pure reporting.
- **No live API access yet:** No Stripe API, no bank scraping. Manual CSV export for MVP.
- **No Telegram bot:** Ledger is CLI-only. Friday can relay output later.
- **DB location:** `/root/bot-circus/performers/ledger/data/ledger.db` — plaintext SQLite (no PII, just txn data). No encryption needed for now.

---

## Roadmap (Phase 2, not now)

- [ ] LLM-based categorization for edge cases (Claude Haiku, ~R1.80 per 1000 txns)
- [ ] Live FX rates (XE.com API or SARB API instead of static EUR=20.5)
- [ ] Stripe API integration (auto-fetch payouts, no manual CSV export)
- [ ] MRR/ARR tracking per product (WhatsAuction, Relay, FlashVault)
- [ ] Invoice tracking (unpaid invoices, payment due dates, AR aging)
- [ ] Reconciliation alerts (bank vs books discrepancies)
- [ ] Runway alerts via Telegram (Friday sends "⚠️ Runway < 4 months" notification)

---

## Troubleshooting

**Q: `ledger: command not found`**
A: Either run `node /root/bot-circus/performers/ledger/cli.mjs <command>` directly, or create the symlink (step 2 above).

**Q: CSV ingest shows 0 inserted, all skipped**
A: Ledger couldn't detect date/description/amount columns. Check CSV format. Expected headers: `date`, `description`, `amount` (or `debit`/`credit`). Open an issue if SA bank format isn't supported.

**Q: Categorization is wrong for some transactions**
A: Update `/root/bot-circus/performers/ledger/categorize.mjs` with new regex patterns, or manually fix in SQLite. Phase 2 will add LLM fallback.

**Q: Multi-currency: EUR→ZAR rate is wrong**
A: Static rate is EUR=20.5 (2026 Q2 avg). For live rates, wait for Phase 2, or manually edit `FX_RATES_TO_ZAR` in `/root/bot-circus/performers/ledger/db/index.mjs`.

**Q: Runway projection is 999 months**
A: You're profitable (avg monthly burn is negative). Runway formula: `cash / burn`. If burn ≤ 0, runway = infinity (capped at 999 for display).

---

**Questions?** Ping Kobus on Telegram (@Theclawbotbot) or WhatsApp (+27825651069).

_Last updated: 2026-05-31_
