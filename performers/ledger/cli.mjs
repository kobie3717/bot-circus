#!/usr/bin/env node

import {
  initDb,
  addAccount,
  listAccounts,
  getAccountByName,
  ingestCsv,
  categorizeUncategorized,
  getTransactions,
  monthlyPnL,
  currentCashBalance,
  runwayMonths,
  snapshot,
  listCategories,
  closeDb
} from './db/index.mjs';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Ledger 💰 — Finance/runway CLI for bootstrapped founders

USAGE:
  ledger <command> [options]

COMMANDS:
  init                                      Initialize database
  account add <name> <currency> <type> <opening_balance> <opening_date>
                                            Add new account (type: bank|stripe|payfast|cash)
  accounts                                  List all accounts
  ingest <csv_path> --account <name>        Ingest CSV into account
  txns [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--category X] [--account Y] [--limit 50]
                                            List transactions with filters
  categorize                                Auto-categorize uncategorized transactions
  categories                                List all available categories
  pnl [YYYY-MM]                             Monthly P&L (defaults to current month)
  runway                                    Runway projection (months until out of cash)
  snapshot [YYYY-MM]                        Generate + store monthly snapshot
  report [YYYY-MM]                          Full markdown report (P&L + runway + breakdown)
  help                                      Show this help

EXAMPLES:
  ledger init
  ledger account add "FNB Business" ZAR bank 50000.00 2026-01-01
  ledger ingest /tmp/fnb-may.csv --account "FNB Business"
  ledger categorize
  ledger pnl 2026-05
  ledger runway
  ledger report 2026-05

NOTES:
  - Multi-currency supported (ZAR, EUR, USD, GBP). All reports convert to ZAR.
  - CSV auto-detection supports most SA bank formats (FNB, Capitec, Standard Bank).
  - Categorization is rule-based (deterministic, no LLM cost).
  - Runway = (cash balance) / (avg monthly burn over last 3 months).
`);
}

function formatCurrency(amount, currency = 'ZAR') {
  const symbol = currency === 'ZAR' ? 'R' : currency === 'EUR' ? '€' : '$';
  return `${symbol}${Math.abs(amount).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function printTable(rows, headers) {
  if (rows.length === 0) {
    console.log('(no data)');
    return;
  }

  const widths = headers.map((h, i) => {
    const colVals = rows.map(r => String(r[i] || ''));
    return Math.max(h.length, ...colVals.map(v => v.length));
  });

  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const separator = widths.map(w => '-'.repeat(w)).join('-+-');

  console.log(headerRow);
  console.log(separator);

  rows.forEach(row => {
    const rowStr = row.map((cell, i) => String(cell || '').padEnd(widths[i])).join(' | ');
    console.log(rowStr);
  });
}

try {
  switch (command) {
    case 'init': {
      const result = initDb();
      console.log(`✓ Database initialized at ${result.path}`);
      break;
    }

    case 'account': {
      const subCmd = args[1];
      if (subCmd === 'add') {
        const [name, currency, type, opening_balance, opening_date] = args.slice(2);
        if (!name || !currency || !type || !opening_balance || !opening_date) {
          console.error('Usage: ledger account add <name> <currency> <type> <opening_balance> <opening_date>');
          process.exit(1);
        }
        const account = addAccount({ name, currency, type, opening_balance: parseFloat(opening_balance), opening_date });
        console.log(`✓ Account added: ${account.name} (${account.currency}, ${account.type})`);
      } else {
        console.error('Unknown account subcommand. Try: ledger account add');
        process.exit(1);
      }
      break;
    }

    case 'accounts': {
      const accounts = listAccounts();
      if (accounts.length === 0) {
        console.log('No accounts yet. Add one with: ledger account add <name> <currency> <type> <opening_balance> <opening_date>');
        break;
      }
      const rows = accounts.map(a => [a.id, a.name, a.currency, a.type, formatCurrency(a.opening_balance, a.currency), a.opening_date]);
      printTable(rows, ['ID', 'Name', 'Currency', 'Type', 'Opening Balance', 'Opening Date']);
      break;
    }

    case 'ingest': {
      const filepath = args[1];
      const accountNameIdx = args.indexOf('--account');
      if (!filepath || accountNameIdx === -1) {
        console.error('Usage: ledger ingest <csv_path> --account <name>');
        process.exit(1);
      }
      const accountName = args[accountNameIdx + 1];
      const account = getAccountByName(accountName);
      if (!account) {
        console.error(`Account "${accountName}" not found. List accounts with: ledger accounts`);
        process.exit(1);
      }

      console.log(`Ingesting ${filepath} into account "${accountName}"...`);
      const result = ingestCsv({ filepath, accountId: account.id });
      console.log(`✓ Inserted: ${result.inserted}, Skipped (duplicates): ${result.skipped}`);
      if (result.errors.length > 0) {
        console.log(`⚠ Errors: ${result.errors.length} (showing first 10):`);
        result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.error}`));
      }
      console.log('\nRun `ledger categorize` to auto-categorize new transactions.');
      break;
    }

    case 'txns': {
      const fromIdx = args.indexOf('--from');
      const toIdx = args.indexOf('--to');
      const categoryIdx = args.indexOf('--category');
      const accountIdx = args.indexOf('--account');
      const limitIdx = args.indexOf('--limit');

      const filters = {
        from: fromIdx !== -1 ? args[fromIdx + 1] : null,
        to: toIdx !== -1 ? args[toIdx + 1] : null,
        category: categoryIdx !== -1 ? args[categoryIdx + 1] : null,
        accountId: accountIdx !== -1 ? getAccountByName(args[accountIdx + 1])?.id : null,
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 50
      };

      const txns = getTransactions(filters);
      if (txns.length === 0) {
        console.log('No transactions found.');
        break;
      }

      const rows = txns.map(t => [
        t.txn_date,
        t.account_name,
        t.description.slice(0, 40),
        t.amount > 0 ? `+${formatCurrency(t.amount, t.currency)}` : formatCurrency(t.amount, t.currency),
        t.category || '(uncategorized)'
      ]);
      printTable(rows, ['Date', 'Account', 'Description', 'Amount', 'Category']);
      console.log(`\nShowing ${txns.length} of max ${filters.limit} transactions.`);
      break;
    }

    case 'categorize': {
      console.log('Categorizing uncategorized transactions...');
      const result = categorizeUncategorized();
      console.log(`✓ Categorized ${result.categorized} transactions.`);
      if (result.categorized < result.total) {
        console.log(`⚠ ${result.total - result.categorized} remain uncategorized (needs manual review).`);
      }
      break;
    }

    case 'categories': {
      const categories = listCategories();
      const rows = categories.map(c => [c.name, c.is_revenue ? 'Revenue' : c.is_expense ? 'Expense' : 'Other', c.description || '']);
      printTable(rows, ['Category', 'Type', 'Description']);
      break;
    }

    case 'pnl': {
      const monthStr = args[1] || new Date().toISOString().slice(0, 7);
      const pnl = monthlyPnL(monthStr);

      console.log(`\n## P&L for ${monthStr}`);
      console.log(`Revenue:       ${formatCurrency(pnl.revenue)}`);
      console.log(`COGS:          ${formatCurrency(pnl.cogs)}`);
      console.log(`Gross Profit:  ${formatCurrency(pnl.revenue - pnl.cogs)}`);
      console.log(`\nOperating Expenses:`);
      for (const [cat, amt] of Object.entries(pnl.opex_breakdown)) {
        console.log(`  ${cat.padEnd(20)} ${formatCurrency(amt)}`);
      }
      console.log(`Total OpEx:    ${formatCurrency(pnl.opex)}`);
      console.log(`\n**Net Income:  ${formatCurrency(pnl.net)}**`);
      console.log(`\nTransactions: ${pnl.count}`);
      break;
    }

    case 'runway': {
      const runway = runwayMonths();
      console.log(`\n## Runway Projection`);
      console.log(`Cash Balance:       ${formatCurrency(runway.cash_balance_zar)}`);
      console.log(`Avg Monthly Burn:   ${formatCurrency(runway.avg_monthly_burn_zar)} (last 3 months)`);
      console.log(`Runway:             ${runway.runway_months.toFixed(1)} months`);

      if (runway.runway_months < 4) {
        console.log(`\n⚠️  WARNING: Runway < 4 months. Time to fundraise or cut burn.`);
      } else if (runway.runway_months < 12) {
        console.log(`\n✓ Runway healthy but monitor closely.`);
      } else {
        console.log(`\n✓ Runway excellent (>12 months).`);
      }
      break;
    }

    case 'snapshot': {
      const monthStr = args[1] || new Date().toISOString().slice(0, 7);
      const snap = snapshot(monthStr);
      console.log(`✓ Snapshot saved for ${monthStr}`);
      console.log(`  Revenue: ${formatCurrency(snap.revenue)}, Net: ${formatCurrency(snap.net)}, Runway: ${snap.runway_months.toFixed(1)}mo`);
      break;
    }

    case 'report': {
      const monthStr = args[1] || new Date().toISOString().slice(0, 7);
      const pnl = monthlyPnL(monthStr);
      const runway = runwayMonths();
      const topExpenses = getTransactions({ from: `${monthStr}-01`, to: `${monthStr}-31`, limit: 10 })
        .filter(t => t.amount < 0)
        .sort((a, b) => a.amount - b.amount);
      const topRevenue = getTransactions({ from: `${monthStr}-01`, to: `${monthStr}-31`, limit: 10 })
        .filter(t => t.amount > 0)
        .sort((a, b) => b.amount - a.amount);

      console.log(`\n# Financial Report — ${monthStr}`);
      console.log(`\n## P&L`);
      console.log(`- **Revenue:** ${formatCurrency(pnl.revenue)}`);
      console.log(`- **COGS:** ${formatCurrency(pnl.cogs)}`);
      console.log(`- **Gross Profit:** ${formatCurrency(pnl.revenue - pnl.cogs)}`);
      console.log(`- **OpEx:** ${formatCurrency(pnl.opex)}`);
      for (const [cat, amt] of Object.entries(pnl.opex_breakdown)) {
        console.log(`  - ${cat}: ${formatCurrency(amt)}`);
      }
      console.log(`- **Net Income:** ${formatCurrency(pnl.net)}`);

      console.log(`\n## Runway`);
      console.log(`- **Cash Balance:** ${formatCurrency(runway.cash_balance_zar)}`);
      console.log(`- **Avg Monthly Burn:** ${formatCurrency(runway.avg_monthly_burn_zar)}`);
      console.log(`- **Runway:** ${runway.runway_months.toFixed(1)} months`);

      console.log(`\n## Top 10 Expenses`);
      if (topExpenses.length > 0) {
        topExpenses.forEach((t, i) => {
          console.log(`${i + 1}. ${t.txn_date} — ${t.description.slice(0, 40)} — ${formatCurrency(Math.abs(t.amount), t.currency)}`);
        });
      } else {
        console.log('(no expenses)');
      }

      console.log(`\n## Top 10 Revenue Sources`);
      if (topRevenue.length > 0) {
        topRevenue.forEach((t, i) => {
          console.log(`${i + 1}. ${t.txn_date} — ${t.description.slice(0, 40)} — ${formatCurrency(t.amount, t.currency)}`);
        });
      } else {
        console.log('(no revenue)');
      }

      console.log(`\n---`);
      console.log(`Generated: ${new Date().toISOString()}`);
      console.log(`Transactions: ${pnl.count}`);
      break;
    }

    case 'help':
    case undefined:
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run `ledger help` for usage.');
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
} finally {
  closeDb();
}
