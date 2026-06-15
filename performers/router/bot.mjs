#!/usr/bin/env node

import { Bot } from 'grammy';
import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { circusRegister, submitTask } from '../../lib/circus-bridge.mjs';
import { detectTaskType, detectEnvironment } from '../../lib/experience-bridge.mjs';

// Load environment variables
config({ override: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KOBUS_CHAT_ID = parseInt(process.env.KOBUS_CHAT_ID, 10);
const CIRCUS_URL = process.env.CIRCUS_URL || 'http://127.0.0.1:6200';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

if (!BOT_TOKEN || !KOBUS_CHAT_ID) {
  console.error('Error: TELEGRAM_BOT_TOKEN and KOBUS_CHAT_ID required in .env');
  process.exit(1);
}

// Bot registry — HTTP task ports for direct injection (bypasses Telegram self-message limitation)
const BOTS = {
  octo: {
    name: 'Octo',
    taskPort: 4201,
    token: '7592154182:AAFLzNk1DPTCaYj04kVFaJ5E3TF-Hc_hki8', // Fallback for bots without HTTP endpoint
    keywords: ['code', 'debug', 'file', 'fix', 'implement', 'test', 'refactor', 'git', 'bug', 'error',
               'analyze', 'analyse', 'project', 'build', 'write', 'create', 'review', 'pr',
               'vps', 'server', 'relay', 'hydra', 'circus', 'bot', 'script', 'function', 'class',
               'database', 'db', 'api', 'endpoint', 'deploy', 'docker', 'pm2', 'log']
  },
  '007': {
    name: '007',
    taskPort: 4203,
    token: '8640295266:AAGouyXZpzDcmPzyrhX4zEA6Ul_qQo-xyPQ',
    keywords: ['research', 'find', 'search', 'look up', 'investigate', 'intel', 'web', 'strategy',
               'data', 'market', 'competitor', 'news', 'price', 'compare', 'best', 'recommend']
  },
  friday: {
    name: 'Friday',
    taskPort: 4202,
    token: '8290915555:AAHFvm94O0PDHvomLCECbsftP-rbnZeJie8',
    keywords: ['schedule', 'remind', 'monitor', 'alert', 'uptime', 'health check',
               'cron', 'routine', 'daily', 'weekly', 'notify', 'watch']
  },
  claw: {
    name: 'Claw',
    taskPort: 4204,
    token: process.env.CLAW_BOT_TOKEN || '',
    keywords: ['whatsapp', 'email', 'inbox', 'message', 'send', 'contact', 'auction', 'whatsauction']
  },
};

console.log('🧭 Starting Router Bot...');
console.log(`Kobus chat ID: ${KOBUS_CHAT_ID}`);
console.log(`Circus URL: ${CIRCUS_URL}`);

// Crash protection
process.on('uncaughtException', (err) => {
  console.error('[CRASH GUARD] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH GUARD] Unhandled rejection:', reason?.message || reason);
});

// Initialize Grammy bot
const bot = new Bot(BOT_TOKEN);

// Initialize Anthropic client (optional — fallback to keywords if missing)
let anthropic = null;
if (ANTHROPIC_API_KEY) {
  try {
    anthropic = new Anthropic();
    console.log('✓ Claude routing enabled');
  } catch (err) {
    console.warn('⚠ Claude init failed, using keyword fallback:', err.message);
  }
}

// Register with Circus and save token for experience queries
(async () => {
  try {
    routerToken = await circusRegister('router', 'router');
    console.log('✓ Registered with Circus');
  } catch (err) {
    console.warn('⚠ Circus registration failed (non-fatal):', err.message);
  }
})();

// Bot ID → Circus agent name mapping
const BOT_AGENT_IDS = { octo: 'octo', '007': '007', friday: 'friday', claw: 'claw' };

/**
 * Get experience boost for a bot on a given task/environment from Circus.
 * Returns 0-25 bonus points based on proven track record.
 */
async function getExperienceBoost(botId, taskType, environment) {
  try {
    if (!environment || environment === 'general') return 0;
    const params = new URLSearchParams({ environment, task_type: taskType, min_confidence: '0.6' });
    // Need auth token — use router's own Circus token if available
    const res = await fetch(`${CIRCUS_URL}/api/v1/experiences/query?${params}`, {
      headers: routerToken ? { Authorization: `Bearer ${routerToken}` } : {},
      signal: AbortSignal.timeout(2000)
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const experiences = (data.experiences || []).filter(e => e.agent_id?.startsWith(botId));
    if (!experiences.length) return 0;
    const top = experiences[0];
    const boost = Math.round(top.confidence * (top.trust_score / 100) * 25);
    console.log(`[Router] Circus boost for ${botId}: +${boost} (${taskType}/${environment}, conf=${top.confidence})`);
    return boost;
  } catch {
    return 0; // non-fatal
  }
}

// Router's Circus token (set after registration)
let routerToken = null;

/**
 * Route a task to the best performer using Claude or keyword fallback.
 * @param {string} taskText - The user's message
 * @returns {Promise<{botId: string, botName: string, score: number, reason: string}>}
 */
async function routeTask(taskText) {
  // Try Claude routing via OAuth proxy
  try {
    const prompt = `You are a task router. Pick the best bot for this task. Reply with JSON only.

Bots:
- octo: coding, debugging, files, git, vps, server analysis, technical work, building things
- 007: research, web searches, market intel, news, comparisons
- friday: scheduling, reminders, monitoring, alerts, watch tasks
- claw: WhatsApp, email, inbox, auctions, send messages

Task: "${taskText}"

JSON only: {"botId":"...","botName":"...","score":0-100,"reason":"..."}`;

    const res = await fetch('http://localhost:4321/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'proxy' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 150,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (res.ok) {
      const raw = await res.text();
      let text = '';
      // Try non-streaming JSON first
      try {
        const data = JSON.parse(raw);
        text = data.content?.[0]?.text?.trim() || '';
      } catch {
        // Fall back to SSE stream parsing
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.slice(5).trim());
            if (d?.type === 'content_block_delta' && d?.delta?.text) {
              text += d.delta.text;
            }
          } catch {}
        }
        text = text.trim();
      }
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const result = JSON.parse(match[0]);
        if (result.botId && BOTS[result.botId]) {
          const baseScore = result.score || 75;
          // Apply Circus experience boost
          const taskType = detectTaskType(taskText);
          const environment = detectEnvironment(taskText) || 'general';
          const boost = await getExperienceBoost(result.botId, taskType, environment);
          const finalScore = Math.min(100, baseScore + boost);
          console.log(`[Router] Claude picked: ${result.botId} (${baseScore}+${boost}=${finalScore})`);
          return { ...result, score: finalScore, reason: result.reason + (boost ? ` [+${boost} Circus boost]` : '') };
        }
      }
    }
  } catch (err) {
    console.warn('[Router] Claude routing failed, using keywords:', err.message);
  }

  // Fallback: keyword-based routing
  const lowerText = taskText.toLowerCase();
  let bestBot = 'claw'; // default fallback
  let bestScore = 0;
  let bestReason = 'general task (default)';

  for (const [botId, bot] of Object.entries(BOTS)) {
    const matchCount = bot.keywords.filter(kw => lowerText.includes(kw)).length;
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestBot = botId;
      bestReason = `matched keywords: ${bot.keywords.filter(kw => lowerText.includes(kw)).join(', ')}`;
    }
  }

  return {
    botId: bestBot,
    botName: BOTS[bestBot].name,
    score: bestScore * 10,
    reason: bestReason
  };
}

// Handle all messages
bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;

  // Security: only accept messages from Kobus
  if (userId !== KOBUS_CHAT_ID) {
    console.log(`[Router] Ignored message from unauthorized user ${userId}`);
    return;
  }

  const messageText = ctx.message.text;
  console.log(`[Router] Task from Kobus: "${messageText.substring(0, 80)}..."`);

  try {
    // Route the task
    const { botId, botName, score, reason } = await routeTask(messageText);
    console.log(`[Router] → ${botName} (${botId}), score: ${score}`);

    // Reply to Kobus
    await ctx.reply(`🧭 Router → ${botName} (${score})\n${reason}`);

    // Inject task into target bot
    const targetBot = BOTS[botId];

    // Try HTTP endpoint first (preferred — avoids Telegram self-message limitation)
    if (targetBot?.taskPort) {
      try {
        const res = await fetch(`http://127.0.0.1:${targetBot.taskPort}/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: messageText,
            chatId: KOBUS_CHAT_ID
          }),
          signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
          console.log(`[Router] Task injected to ${botId} via HTTP (port ${targetBot.taskPort})`);
        } else {
          const err = await res.text();
          console.error(`[Router] HTTP inject failed for ${botId}:`, err);
          await ctx.reply(`⚠ ${botName} HTTP injection failed: ${err}`);
        }
      } catch (err) {
        console.error(`[Router] HTTP inject error for ${botId}:`, err.message);
        await ctx.reply(`⚠ ${botName} unreachable (port ${targetBot.taskPort}). Check if bot is running.`);
      }
    } else if (targetBot?.token) {
      // Fallback to Telegram API for bots without HTTP endpoint (e.g., Claw)
      const tgUrl = `https://api.telegram.org/bot${targetBot.token}/sendMessage`;
      const res = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: KOBUS_CHAT_ID, text: messageText })
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[Router] Telegram inject failed for ${botId}:`, err);
        await ctx.reply(`⚠ ${botName} couldn't receive the task via Telegram. Message them directly.`);
      } else {
        console.log(`[Router] Task injected to ${botId} via Telegram API`);
      }
    } else {
      await ctx.reply(`⚠ No injection method for ${botName}. Message them directly.`);
    }
  } catch (err) {
    console.error('[Router] Error handling message:', err);
    await ctx.reply(`❌ Router error: ${err.message}`).catch(() => {});
  }
});

// Start bot
bot.start({
  onStart: () => console.log('✓ Router Bot running')
});
