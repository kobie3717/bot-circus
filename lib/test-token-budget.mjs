#!/usr/bin/env node

import { TokenBudget } from './token-budget.mjs';

async function test() {
  console.log('=== Testing TokenBudget Upgrades ===\n');

  const budget = new TokenBudget();
  await budget.setBudget(100000);
  await budget.resetUsage();

  // Test 1: Tiered throttling
  console.log('Test 1: Tiered Throttling');
  console.log(`Current tier: ${budget.getTier()} (should be green)`);
  console.log(`Delay: ${budget.getDelay()}ms (should be 0)`);
  console.log(`Skip proactive: ${budget.shouldSkipProactive()} (should be false)`);
  console.log();

  // Simulate 75% usage
  await budget.recordUsage({ inputTokens: 75000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.5 });
  console.log(`After 75k tokens:`);
  console.log(`  Tier: ${budget.getTier()} (should be yellow)`);
  console.log(`  Delay: ${budget.getDelay()}ms (should be 0)`);
  console.log();

  // Simulate 90% usage
  await budget.recordUsage({ inputTokens: 15000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.1 });
  console.log(`After 90k tokens:`);
  console.log(`  Tier: ${budget.getTier()} (should be orange)`);
  console.log(`  Delay: ${budget.getDelay()}ms (should be 2000)`);
  console.log();

  // Simulate 96% usage
  await budget.recordUsage({ inputTokens: 6000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.05 });
  console.log(`After 96k tokens:`);
  console.log(`  Tier: ${budget.getTier()} (should be red)`);
  console.log(`  Delay: ${budget.getDelay()}ms (should be 5000)`);
  console.log(`  Skip proactive: ${budget.shouldSkipProactive()} (should be true)`);
  console.log();

  // Simulate 100% usage
  await budget.recordUsage({ inputTokens: 4000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.03 });
  console.log(`After 100k tokens:`);
  console.log(`  Tier: ${budget.getTier()} (should be exhausted)`);
  console.log(`  Delay: ${budget.getDelay()}ms (should be 5000)`);
  console.log(`  Exhausted: ${budget.isExhausted()} (should be true)`);
  console.log(`  Over budget: ${budget.isOverBudget()} (should be true)`);
  console.log(`  Refusal message: "${budget.getRefusalMessage()}"`);
  console.log();

  // Reset for next tests
  await budget.resetUsage();

  // Test 2: Per-conversation caps
  console.log('Test 2: Per-Conversation Caps');
  await budget.recordUsage({ inputTokens: 30000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.2, sessionId: 'conv-1' });
  await budget.recordUsage({ inputTokens: 20000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.15, sessionId: 'conv-1' });
  await budget.recordUsage({ inputTokens: 10000, outputTokens: 0, cacheCreation: 0, cacheRead: 0, costUsd: 0.08, sessionId: 'conv-2' });

  console.log(`Conv-1 usage: ${budget.getConvUsage('conv-1').toLocaleString()} (should be 50,000)`);
  console.log(`Conv-2 usage: ${budget.getConvUsage('conv-2').toLocaleString()} (should be 10,000)`);
  console.log(`Conv-1 over (cap 40k): ${budget.isConvOver('conv-1', 40000)} (should be true)`);
  console.log(`Conv-2 over (cap 40k): ${budget.isConvOver('conv-2', 40000)} (should be false)`);
  console.log();

  await budget.clearConv('conv-1');
  console.log(`Conv-1 usage after clear: ${budget.getConvUsage('conv-1').toLocaleString()} (should be 0)`);
  console.log();

  // Test 3: Circus pool coordination (will fail gracefully if Circus not running)
  console.log('Test 3: Circus Pool Coordination (optional)');
  const tier = await budget.checkCircusPool('test-bot', 'test-session');
  console.log(`Circus tier response: ${tier || 'null (Circus not available - expected)'}`);
  await budget.recordCircusUsage('test-bot', 'test-session', 1000);
  console.log('Circus usage recorded (fire-and-forget)');
  console.log();

  console.log('=== All Tests Complete ===');
}

test().catch(console.error);
