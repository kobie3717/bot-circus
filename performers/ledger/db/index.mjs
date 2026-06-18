#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ledger.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

// FX conversion rates (static for MVP, TODO: live rates)
const FX_RATES_TO_ZAR = {
  ZAR: 1.0,
  EUR: 20.5, // avg 2026 Q2
  USD: 18.7, // avg 2026 Q2
  GBP: 23.8  // avg 2026 Q2
};

function getDb() {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initDb() {
  const database = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  database.exec(schema);
  return { success: true, path: DB_PATH };
}

export function addAccount({ name, currency, type, opening_balance, opening_date }) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO accounts (name, currency, type, opening_balance, opening_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, currency.toUpperCase(), type, opening_balance, opening_date);
  return { id: info.lastInsertRowid, name, currency, type, opening_balance, opening_date };
}

export function listAccounts() {
  const database = getDb();
  return database.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all();
}

export function getAccountByName(name) {
  const database = getDb();
  return database.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
}

// CSV ingestion: auto-detect common formats
export function ingestCsv({ filepath, accountId }) {
  const database = getDb();
  const account = database.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  const csvContent = fs.readFileSync(filepath, 'utf8');
  const lines = csvContent.split('\n').filter(l => l.trim());

  const { header, rows } = parseGenericCsv(lines);
  const colMap = detectColumns(header);

  let inserted = 0, skipped = 0;
  const errors = [];

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO transactions (account_id, txn_date, description, amount, currency, source_file, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    try {
      const date = extractDate(row, colMap);
      const desc = extractDescription(row, colMap);
      const amount = extractAmount(row, colMap);

      if (!date || !desc || amount === null) {
        skipped++;
        continue;
      }

      // Hash for dedup (without category, since categorization is mutable)
      const hash = crypto
        .createHash('sha256')
        .update(`${accountId}|${date}|${desc}|${amount}|${account.currency}`)
        .digest('hex');

      const info = stmt.run(accountId, date, desc, amount, account.currency, path.basename(filepath), hash);
      if (info.changes > 0) inserted++;
      else skipped++;
    } catch (err) {
      errors.push({ row, error: err.message });
    }
  }

  return { inserted, skipped, errors: errors.slice(0, 10) }; // limit error output
}

function parseGenericCsv(lines) {
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const rows = lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/"/g, ''));
    return cols;
  });
  return { header, rows };
}

function detectColumns(header) {
  const dateIdx = header.findIndex(h => /date|datum|txn_date/.test(h));
  const descIdx = header.findIndex(h => /description|desc|narrative|details|narration/.test(h));
  const amountIdx = header.findIndex(h => /amount|value|balance|debit|credit/.test(h));
  const debitIdx = header.findIndex(h => /debit|withdrawal/.test(h));
  const creditIdx = header.findIndex(h => /credit|deposit/.test(h));

  return { dateIdx, descIdx, amountIdx, debitIdx, creditIdx };
}

function extractDate(row, colMap) {
  if (colMap.dateIdx === -1) return null;
  const raw = row[colMap.dateIdx];
  // Try YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

function extractDescription(row, colMap) {
  if (colMap.descIdx === -1) return 'Unknown';
  return row[colMap.descIdx] || 'Unknown';
}

function extractAmount(row, colMap) {
  // If debit/credit separate columns
  if (colMap.debitIdx !== -1 && colMap.creditIdx !== -1) {
    const debit = parseFloat(row[colMap.debitIdx] || '0');
    const credit = parseFloat(row[colMap.creditIdx] || '0');
    return credit - debit; // positive = inflow, negative = outflow
  }

  // Single amount column
  if (colMap.amountIdx !== -1) {
    const raw = row[colMap.amountIdx].replace(/[^0-9.-]/g, '');
    return parseFloat(raw) || 0;
  }

  return null;
}

export function categorizeUncategorized() {
  const database = getDb();
  const uncategorized = database.prepare('SELECT * FROM transactions WHERE category IS NULL').all();

  const stmt = database.prepare('UPDATE transactions SET category = ? WHERE id = ?');
  let categorized = 0;

  for (const txn of uncategorized) {
    const { category } = categorizeTxn(txn);
    stmt.run(category, txn.id);
    categorized++;
  }

  return { categorized, total: uncategorized.length };
}

function categorizeTxn(txn) {
  const desc = txn.description.toLowerCase();
  const amount = txn.amount;

  // Revenue patterns
  if (amount > 0) {
    if (/stripe|payfast|sepa.*invoice|payment received|customer/.test(desc)) {
      return { category: 'revenue', confidence: 'high', reason: 'Payment received pattern' };
    }
    return { category: 'revenue', confidence: 'medium', reason: 'Positive amount' };
  }

  // Expense patterns (amount < 0)
  if (/anthropic|openai|claude|aws|gcp|azure|vercel|cloudflare|github|npm|docker/.test(desc)) {
    return { category: 'opex_software', confidence: 'high', reason: 'Software subscription' };
  }
  if (/google ads|facebook|meta|linkedin|twitter|reddit ads|mailchimp/.test(desc)) {
    return { category: 'opex_marketing', confidence: 'high', reason: 'Marketing spend' };
  }
  if (/salary|payroll|contractor|freelancer/.test(desc)) {
    return { category: 'opex_salaries', confidence: 'high', reason: 'Payroll' };
  }
  if (/twilio|messagebird|whatsapp|sms|africastalking/.test(desc)) {
    return { category: 'cogs', confidence: 'high', reason: 'Variable API cost' };
  }
  if (/vat|tax|sars|provisional/.test(desc)) {
    return { category: 'taxes', confidence: 'high', reason: 'Tax payment' };
  }
  if (/transfer|internal|own account/.test(desc)) {
    return { category: 'transfer', confidence: 'high', reason: 'Internal transfer' };
  }

  return { category: 'opex_other', confidence: 'low', reason: 'No pattern match' };
}

export function getTransactions({ from, to, accountId, category, limit = 50 }) {
  const database = getDb();
  let query = 'SELECT t.*, a.name as account_name FROM transactions t JOIN accounts a ON t.account_id = a.id WHERE 1=1';
  const params = [];

  if (from) {
    query += ' AND t.txn_date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND t.txn_date <= ?';
    params.push(to);
  }
  if (accountId) {
    query += ' AND t.account_id = ?';
    params.push(accountId);
  }
  if (category) {
    query += ' AND t.category = ?';
    params.push(category);
  }

  query += ' ORDER BY t.txn_date DESC LIMIT ?';
  params.push(limit);

  return database.prepare(query).all(...params);
}

export function monthlyPnL(monthStr) {
  const database = getDb();
  const [year, month] = monthStr.split('-');
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-31`;

  const txns = database.prepare(`
    SELECT t.*, a.currency as account_currency
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE t.txn_date >= ? AND t.txn_date <= ? AND t.category != 'transfer'
  `).all(startDate, endDate);

  let revenue = 0, cogs = 0, opex = 0;
  const opex_breakdown = {};

  for (const txn of txns) {
    const amountZar = txn.amount * (FX_RATES_TO_ZAR[txn.account_currency] || 1);

    if (txn.category === 'revenue') {
      revenue += amountZar;
    } else if (txn.category === 'cogs') {
      cogs += Math.abs(amountZar);
    } else if (txn.category?.startsWith('opex_')) {
      opex += Math.abs(amountZar);
      opex_breakdown[txn.category] = (opex_breakdown[txn.category] || 0) + Math.abs(amountZar);
    } else if (txn.category === 'taxes' || txn.category === 'one_off') {
      opex += Math.abs(amountZar);
      opex_breakdown[txn.category] = (opex_breakdown[txn.category] || 0) + Math.abs(amountZar);
    }
  }

  const net = revenue - cogs - opex;

  return {
    month: monthStr,
    revenue: Math.round(revenue * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    opex: Math.round(opex * 100) / 100,
    opex_breakdown,
    net: Math.round(net * 100) / 100,
    count: txns.length
  };
}

export function currentCashBalance() {
  const database = getDb();
  const accounts = database.prepare('SELECT * FROM accounts').all();

  const balances = {};

  for (const account of accounts) {
    const txnSum = database.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ?
    `).get(account.id).total;

    const balance = account.opening_balance + txnSum;
    balances[account.currency] = (balances[account.currency] || 0) + balance;
  }

  // Convert all to ZAR for total
  let totalZar = 0;
  for (const [currency, amount] of Object.entries(balances)) {
    totalZar += amount * (FX_RATES_TO_ZAR[currency] || 1);
  }

  return { by_currency: balances, total_zar: Math.round(totalZar * 100) / 100 };
}

export function runwayMonths() {
  const database = getDb();
  const today = new Date();
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const monthStr = threeMonthsAgo.toISOString().slice(0, 7);

  // Get last 3 months P&L
  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(threeMonthsAgo.getFullYear(), threeMonthsAgo.getMonth() + i, 1);
    months.push(d.toISOString().slice(0, 7));
  }

  let totalBurn = 0;
  for (const m of months) {
    const pnl = monthlyPnL(m);
    const burn = pnl.cogs + pnl.opex - pnl.revenue; // negative burn = profit
    totalBurn += burn;
  }

  const avgMonthlyBurn = totalBurn / 3;
  const cash = currentCashBalance().total_zar;

  const runway = avgMonthlyBurn > 0 ? cash / avgMonthlyBurn : 999;

  return {
    cash_balance_zar: cash,
    avg_monthly_burn_zar: Math.round(avgMonthlyBurn * 100) / 100,
    runway_months: Math.round(runway * 10) / 10
  };
}

export function snapshot(monthStr) {
  const database = getDb();
  const pnl = monthlyPnL(monthStr);
  const runway = runwayMonths();

  const stmt = database.prepare(`
    INSERT OR REPLACE INTO monthly_snapshots (month, revenue_zar, cogs_zar, opex_zar, net_zar, cash_balance_zar, runway_months)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(monthStr, pnl.revenue, pnl.cogs, pnl.opex, pnl.net, runway.cash_balance_zar, runway.runway_months);

  return { month: monthStr, ...pnl, ...runway };
}

export function listCategories() {
  const database = getDb();
  return database.prepare('SELECT * FROM categories ORDER BY name').all();
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
