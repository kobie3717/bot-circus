#!/usr/bin/env node

/**
 * Rule-based transaction categorization for Ledger v1.0
 *
 * Phase 1: Deterministic regex patterns (no LLM = cheap + fast)
 * Phase 2: TODO — upgrade to Claude Haiku for edge cases
 */

export function categorize(txn) {
  const desc = txn.description.toLowerCase();
  const amount = txn.amount;

  // Revenue patterns (inflows)
  if (amount > 0) {
    if (/stripe|payfast|paypal|square|payment received/.test(desc)) {
      return { category: 'revenue', confidence: 'high', reason: 'Payment gateway match' };
    }
    if (/invoice|customer|subscription|saas/.test(desc)) {
      return { category: 'revenue', confidence: 'high', reason: 'Revenue keyword' };
    }
    if (/refund|chargeback/.test(desc)) {
      return { category: 'cogs', confidence: 'medium', reason: 'Refund (negative revenue)' };
    }
    return { category: 'revenue', confidence: 'medium', reason: 'Positive amount (default inflow)' };
  }

  // Expense patterns (outflows, amount < 0)

  // COGS — variable costs tied to revenue
  if (/twilio|messagebird|africastalking|whatsapp|sms|api/.test(desc)) {
    return { category: 'cogs', confidence: 'high', reason: 'Variable API cost' };
  }
  if (/aws|gcp|azure|digitalocean|linode|hosting/.test(desc) && Math.abs(amount) > 500) {
    return { category: 'cogs', confidence: 'medium', reason: 'Cloud hosting (high usage)' };
  }

  // OpEx Software — SaaS subscriptions
  if (/anthropic|openai|claude|github|vercel|netlify|heroku|cloudflare/.test(desc)) {
    return { category: 'opex_software', confidence: 'high', reason: 'SaaS subscription' };
  }
  if (/figma|notion|slack|zoom|gsuite|microsoft 365|office|adobe/.test(desc)) {
    return { category: 'opex_software', confidence: 'high', reason: 'Productivity SaaS' };
  }
  if (/npm|docker|gitlab|bitbucket/.test(desc)) {
    return { category: 'opex_software', confidence: 'high', reason: 'Dev tooling' };
  }

  // OpEx Marketing — ads, SEO, email
  if (/google ads|adwords|facebook|meta|instagram|linkedin ads|twitter ads/.test(desc)) {
    return { category: 'opex_marketing', confidence: 'high', reason: 'Paid ads' };
  }
  if (/mailchimp|sendgrid|mailgun|convertkit|substack/.test(desc)) {
    return { category: 'opex_marketing', confidence: 'high', reason: 'Email marketing' };
  }
  if (/semrush|ahrefs|moz|seo/.test(desc)) {
    return { category: 'opex_marketing', confidence: 'high', reason: 'SEO tools' };
  }

  // OpEx Salaries — payroll
  if (/salary|payroll|contractor|freelancer|upwork|fiverr/.test(desc)) {
    return { category: 'opex_salaries', confidence: 'high', reason: 'Payroll/contractor' };
  }

  // Taxes
  if (/sars|vat|tax|provisional|efiling/.test(desc)) {
    return { category: 'taxes', confidence: 'high', reason: 'Tax payment' };
  }

  // Transfers (internal, exclude from P&L)
  if (/transfer|internal|own account|self/.test(desc)) {
    return { category: 'transfer', confidence: 'high', reason: 'Internal transfer' };
  }

  // One-off — large, rare
  if (Math.abs(amount) > 5000 && /legal|attorney|equipment|laptop|phone|furniture/.test(desc)) {
    return { category: 'one_off', confidence: 'medium', reason: 'Large one-time expense' };
  }

  // Default fallback
  return { category: 'opex_other', confidence: 'low', reason: 'No pattern match (needs manual review)' };
}

// TODO Phase 2: LLM-based categorization for edge cases
// Use Claude Haiku with few-shot examples from existing categorized txns
// Cost: ~$0.0001 per txn (100 tokens in, 10 out) = R1.80 per 1000 txns
export async function categorizeLLM(txn) {
  throw new Error('LLM categorization not implemented yet (Phase 2)');
}
