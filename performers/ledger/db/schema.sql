-- Ledger DB Schema v1.0

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  type TEXT NOT NULL CHECK(type IN ('bank', 'stripe', 'payfast', 'cash')),
  opening_balance REAL NOT NULL DEFAULT 0.0,
  opening_date TEXT NOT NULL, -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_revenue INTEGER NOT NULL DEFAULT 0,
  is_expense INTEGER NOT NULL DEFAULT 0,
  description TEXT
);

-- Pre-seed categories
INSERT OR IGNORE INTO categories (name, is_revenue, is_expense, description) VALUES
  ('revenue', 1, 0, 'Customer payments, subscription revenue'),
  ('cogs', 0, 1, 'Cost of goods sold (hosting, SMS, API costs)'),
  ('opex_software', 0, 1, 'Software subscriptions (Anthropic, AWS, Vercel, etc)'),
  ('opex_marketing', 0, 1, 'Ads, marketing tools, SEO'),
  ('opex_salaries', 0, 1, 'Payroll, contractor fees'),
  ('opex_other', 0, 1, 'Miscellaneous operating expenses'),
  ('one_off', 0, 1, 'One-time expenses (equipment, legal fees)'),
  ('taxes', 0, 1, 'VAT, income tax, provisional tax'),
  ('transfer', 0, 0, 'Internal transfers between accounts');

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  txn_date TEXT NOT NULL, -- YYYY-MM-DD
  description TEXT NOT NULL,
  amount REAL NOT NULL, -- negative = outflow
  currency TEXT NOT NULL,
  category TEXT,
  source_file TEXT, -- original CSV filename
  hash TEXT NOT NULL UNIQUE, -- dedup: sha256(account_id|txn_date|description|amount|currency) WITHOUT category
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (category) REFERENCES categories(name)
);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_hash ON transactions(hash);

CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE, -- YYYY-MM
  revenue_zar REAL NOT NULL DEFAULT 0.0,
  cogs_zar REAL NOT NULL DEFAULT 0.0,
  opex_zar REAL NOT NULL DEFAULT 0.0,
  net_zar REAL NOT NULL DEFAULT 0.0,
  cash_balance_zar REAL NOT NULL DEFAULT 0.0,
  runway_months REAL NOT NULL DEFAULT 0.0,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshot_month ON monthly_snapshots(month);
