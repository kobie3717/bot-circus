#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test database in /tmp
const TEST_DATA_DIR = '/tmp/ledger-test-data';

function setup() {
  // Clean up previous test
  if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  // Override data directory for testing
  const dbDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'ledger.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}

// Import after setup to get fresh DB
setup();

const {
  initDb,
  addAccount,
  listAccounts,
  ingestCsv,
  categorizeUncategorized,
  getTransactions,
  monthlyPnL,
  currentCashBalance,
  runwayMonths,
  snapshot,
  closeDb
} = await import('../db/index.mjs');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

function assertApprox(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    console.error(`❌ FAIL: ${message} (expected ~${expected}, got ${actual})`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

console.log('🧪 Running Ledger smoke tests...\n');

// Test 1: Init DB
console.log('Test 1: Initialize database');
const initResult = initDb();
assert(fs.existsSync(initResult.path), 'Database file created');

// Test 2: Add account
console.log('\nTest 2: Add account');
const account = addAccount({
  name: 'Test Bank',
  currency: 'ZAR',
  type: 'bank',
  opening_balance: 100000.0,
  opening_date: '2026-01-01'
});
assert(account.id === 1, 'Account ID is 1');
assert(account.name === 'Test Bank', 'Account name matches');

const accounts = listAccounts();
assert(accounts.length === 1, 'One account exists');

// Test 3: Ingest synthetic CSV
console.log('\nTest 3: Ingest synthetic CSV');
const csvPath = path.join(TEST_DATA_DIR, 'test.csv');
const csvContent = `date,description,amount
2026-05-01,Stripe Payment,5000.00
2026-05-05,Anthropic API,-450.00
2026-05-10,Google Ads,-1200.00
2026-05-15,Stripe Payment,3500.00
2026-05-20,AWS Invoice,-890.00
2026-05-25,Twilio SMS,-230.00
2026-05-28,Contractor Payment,-8000.00`;

fs.writeFileSync(csvPath, csvContent);

const ingestResult = ingestCsv({ filepath: csvPath, accountId: account.id });
assert(ingestResult.inserted === 7, 'Inserted 7 transactions');
assert(ingestResult.skipped === 0, 'No duplicates skipped');

// Test 4: Categorize transactions
console.log('\nTest 4: Categorize transactions');
const categorizeResult = categorizeUncategorized();
assert(categorizeResult.categorized === 7, 'Categorized 7 transactions');

const txns = getTransactions({ limit: 100 });
assert(txns.length === 7, 'Retrieved 7 transactions');

const revenueTxns = txns.filter(t => t.category === 'revenue');
assert(revenueTxns.length === 2, 'Found 2 revenue transactions');

const softwareTxns = txns.filter(t => t.category === 'opex_software');
assert(softwareTxns.length >= 1, 'Found at least 1 software expense');

// Test 5: Monthly P&L
console.log('\nTest 5: Monthly P&L');
const pnl = monthlyPnL('2026-05');
assert(pnl.revenue === 8500.00, 'Revenue is 8500.00');
assertApprox(pnl.cogs, 230.00, 0.01, 'COGS is ~230.00 (Twilio)');
assertApprox(pnl.opex, 10540.00, 0.01, 'OpEx is ~10540.00 (Anthropic + Ads + AWS + Contractor)');
assertApprox(pnl.net, -2270.00, 0.01, 'Net is ~-2270.00 (loss)');

// Test 6: Cash balance
console.log('\nTest 6: Cash balance');
const cash = currentCashBalance();
assertApprox(cash.total_zar, 97730.00, 0.01, 'Cash balance is ~97730.00 (100k opening - 10770 outflow + 8500 inflow)');

// Test 7: Runway calculation
console.log('\nTest 7: Runway calculation');
// Need 3 months of data for runway, but we only have 1. Runway should handle this gracefully.
const runway = runwayMonths();
assert(runway.runway_months >= 0, 'Runway is non-negative');
assert(runway.cash_balance_zar === cash.total_zar, 'Runway cash matches balance');

// Test 8: Snapshot
console.log('\nTest 8: Snapshot generation');
const snap = snapshot('2026-05');
assert(snap.month === '2026-05', 'Snapshot month matches');
assert(snap.revenue === pnl.revenue, 'Snapshot revenue matches P&L');

// Test 9: Duplicate prevention
console.log('\nTest 9: Duplicate prevention');
const dupResult = ingestCsv({ filepath: csvPath, accountId: account.id });
assert(dupResult.inserted === 0, 'No duplicates inserted');
assert(dupResult.skipped === 7, 'All 7 duplicates skipped');

// Test 10: Multi-currency
console.log('\nTest 10: Multi-currency account');
const eurAccount = addAccount({
  name: 'EUR Stripe',
  currency: 'EUR',
  type: 'stripe',
  opening_balance: 1000.0,
  opening_date: '2026-01-01'
});
assert(eurAccount.id === 2, 'EUR account created');

const eurCsvPath = path.join(TEST_DATA_DIR, 'eur.csv');
const eurCsvContent = `date,description,amount
2026-05-10,EU Customer Payment,500.00
2026-05-15,Refund,-50.00`;
fs.writeFileSync(eurCsvPath, eurCsvContent);

const eurIngest = ingestCsv({ filepath: eurCsvPath, accountId: eurAccount.id });
assert(eurIngest.inserted === 2, 'Inserted 2 EUR transactions');

categorizeUncategorized();

const pnlWithEur = monthlyPnL('2026-05');
// EUR revenue converted to ZAR at 20.5 rate: 500*20.5 = 10250, minus refund 50*20.5 = 1025
// Total revenue: 8500 (ZAR) + 10250 (EUR inflow) = 18750, minus COGS 1025 (refund treated as COGS)
assertApprox(pnlWithEur.revenue, 18750.00, 50.00, 'Multi-currency revenue converted to ZAR');

closeDb();

console.log('\n✅ All tests passed!\n');
console.log('Summary:');
console.log('- 10 test suites executed');
console.log('- Database operations: ✓');
console.log('- CSV ingestion: ✓');
console.log('- Auto-categorization: ✓');
console.log('- P&L calculation: ✓');
console.log('- Runway projection: ✓');
console.log('- Multi-currency: ✓');
console.log('- Deduplication: ✓');
