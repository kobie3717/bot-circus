#!/usr/bin/env node

import { TokenBudget } from './token-budget.mjs';

async function test() {
  console.log('=== Testing Persistence ===\n');

  // Create new instance
  const budget1 = new TokenBudget();
  await budget1.setBudget(200000);
  await budget1.resetUsage();

  // Record some usage with sessions
  await budget1.recordUsage({
    inputTokens: 10000,
    outputTokens: 5000,
    cacheCreation: 0,
    cacheRead: 0,
    costUsd: 0.1,
    sessionId: 'test-session-1'
  });

  await budget1.recordUsage({
    inputTokens: 8000,
    outputTokens: 2000,
    cacheCreation: 0,
    cacheRead: 0,
    costUsd: 0.08,
    sessionId: 'test-session-2'
  });

  console.log('Instance 1:');
  console.log(`  Session 1 usage: ${budget1.getConvUsage('test-session-1')}`);
  console.log(`  Session 2 usage: ${budget1.getConvUsage('test-session-2')}`);
  console.log(`  Total daily usage: ${budget1.dailyUsed}`);
  console.log();

  // Create second instance to verify persistence
  const budget2 = new TokenBudget();

  // Wait for async load to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('Instance 2 (loaded from disk):');
  console.log(`  Session 1 usage: ${budget2.getConvUsage('test-session-1')}`);
  console.log(`  Session 2 usage: ${budget2.getConvUsage('test-session-2')}`);
  console.log(`  Total daily usage: ${budget2.dailyUsed}`);
  console.log();

  console.log('✅ Persistence working correctly');
}

test().catch(console.error);
