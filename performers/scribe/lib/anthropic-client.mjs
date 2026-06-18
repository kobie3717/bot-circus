// anthropic-client.mjs — Thin wrapper around Anthropic SDK

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ANTHROPIC_API_KEY from environment or fallback to hydra-note .env
if (!process.env.ANTHROPIC_API_KEY) {
  config({ path: '/root/hydra-note/.env' });
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Pricing for Sonnet 4.5 (as of 2026-05-31)
const PRICING = {
  input: 3.0 / 1_000_000,   // $3 per MTok
  output: 15.0 / 1_000_000,  // $15 per MTok
};

/**
 * Draft content via Claude Sonnet 4.5
 * @param {string} systemPrompt - Full system prompt (voice + template)
 * @param {string} userMessage - Topic/brief from user
 * @param {object} options - Optional overrides
 * @returns {Promise<{text: string, usage: object, cost_estimate: number}>}
 */
export async function draft(systemPrompt, userMessage, options = {}) {
  const model = options.model || 'claude-sonnet-4-5-20250929';
  const maxTokens = options.maxTokens || 4000;

  const startTime = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const duration = Date.now() - startTime;

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };

  const cost = (usage.input_tokens * PRICING.input) + (usage.output_tokens * PRICING.output);

  // Log every call to usage.jsonl
  const logEntry = {
    timestamp: new Date().toISOString(),
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: cost.toFixed(4),
    duration_ms: duration,
  };

  const usageLogPath = join(__dirname, '..', 'usage.jsonl');
  appendFileSync(usageLogPath, JSON.stringify(logEntry) + '\n');

  return {
    text: response.content[0].text,
    usage,
    cost_estimate: parseFloat(cost.toFixed(4)),
  };
}
