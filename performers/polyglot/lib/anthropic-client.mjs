#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import { appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_LOG = join(__dirname, '..', 'usage.jsonl');

// Pricing for claude-haiku-4-5-20251001
const PRICING = {
  input: 0.80 / 1_000_000,  // $0.80 per MTok
  output: 4.00 / 1_000_000  // $4.00 per MTok
};

let anthropicClient = null;

function getClient() {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not found. Load from /root/hydra-note/.env');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Call Haiku 4.5 for translation
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User text to translate
 * @param {number} maxTokens - Max output tokens (default 2000)
 * @returns {Promise<{text: string, usage: object, cost_estimate: number}>}
 */
export async function callHaiku(systemPrompt, userPrompt, maxTokens = 2000) {
  // Test mode: return mock response
  if (process.env.POLYGLOT_TEST_MODE === 'true') {
    const mockText = process.env.POLYGLOT_MOCK_RESPONSE || 'Mocked translation';
    return {
      text: mockText,
      usage: { input_tokens: 100, output_tokens: 20 },
      cost_estimate: 0.001
    };
  }

  const client = getClient();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt }
    ]
  });

  const usage = response.usage;
  const costEstimate = (usage.input_tokens * PRICING.input) + (usage.output_tokens * PRICING.output);

  // Log usage
  const logEntry = {
    timestamp: new Date().toISOString(),
    model: 'claude-haiku-4-5-20251001',
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: costEstimate
  };

  try {
    appendFileSync(USAGE_LOG, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('Warning: Could not write to usage.jsonl', err.message);
  }

  return {
    text: response.content[0].text,
    usage,
    cost_estimate: costEstimate
  };
}
