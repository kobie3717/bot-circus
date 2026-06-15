#!/usr/bin/env node

import { Bot, webhookCallback } from 'grammy';
import http from 'http';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { config } from 'dotenv';
import { readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOrCreateSession, clearSession, getSessionInfo, getStats, getLastSummary } from '../../lib/sessions.mjs';
import { transcribe } from '../../lib/voice.mjs';
import { createConfirmKeyboard, addPendingAction, getPendingAction, removePendingAction, generateActionId } from '../../lib/confirm.mjs';
import { getUnread, getStats as getInboxStats, search as searchInbox, markAllRead } from '../../lib/inbox.mjs';
import { sendEmail, verifySmtp } from '../../lib/email-sender.mjs';
import { fullDashboard, serverDashboard } from '../../lib/dashboards.mjs';
import { executeAction, listActions, getAction } from '../../lib/actions.mjs';
import { buildMemoryContext, autoStoreConversation, storeMemory, searchMemory } from '../../lib/memory-bridge.mjs';
import { detectSignal, storeFeedback, buildFeedbackContext, getStats as getLearningStats, getTopPatterns } from '../../lib/learning.mjs';
import { buildExperienceContext } from '../../lib/experience-bridge.mjs';
import { addTask, removeTask, toggleTask, listTasks, startScheduler, addHeartbeatTask, getTask } from '../../lib/tasks.mjs';
import { updateContext, getContext, getTopicHistory, getTopicStats, clearContext } from '../../lib/context.mjs';
import { shouldAlert, sendAlert, getRecentAlerts, getAlertStats, muteAlerts, getMuteStatus, flushQueuedAlerts } from '../../lib/proactive-alerts.mjs';
import { captureSessionSnapshot, loadSessionContext, formatSessionContext } from '../../lib/handoff.mjs';
import { enqueueJob, getJobStatus, listJobs, processQueue, getQueueStats } from '../../lib/queue.mjs';
import { circusRegister, joinTroupe, buildPreferenceContext, detectPreferenceSignals, publishPreference, getRelevantSharedKnowledge, writeSharedKnowledge, shouldShareKnowledge, writeCorrection, detectCorrectionSignal, registerTaskHandler, startTaskInboxPoller, startHeartbeat, submitTask, getAgentId } from './circus-bridge.mjs';
import { spawnBot, loadManagedBots, killBot } from '../../lib/factory.mjs';
import { startOvernightRun, stopOvernightRun, getOvernightStatus } from '../../lib/overnight.mjs';

const execFileAsync = promisify(execFile);

// Load environment variables (override: true prevents inherited env from clobbering .env)
config({ override: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID, 10);
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH;
const CLAUDE_WORKING_DIR = process.env.CLAUDE_WORKING_DIR || '/root/octo-workspace';
const CLAUDE_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT, 10) || 300000; // 5 min default
const CLAW_API_KEY = process.env.CLAW_API_KEY;

// Internal API auth headers
const internalHeaders = CLAW_API_KEY
  ? { 'Content-Type': 'application/json', 'X-API-Key': CLAW_API_KEY }
  : { 'Content-Type': 'application/json' };

// OpenClaw workspace paths
const WORKSPACE = process.env.WORKSPACE || '/root/octo-workspace';
const MEMORY_DIR = join(WORKSPACE, 'memory');

if (!BOT_TOKEN || !ALLOWED_USER_ID || !CLAUDE_CLI_PATH) {
  console.error('Error: TELEGRAM_BOT_TOKEN, ALLOWED_USER_ID, and CLAUDE_CLI_PATH required in .env');
  process.exit(1);
}

// Global crash protection — prevent unhandled rejections from killing the process
process.on('uncaughtException', (err) => {
  console.error('[CRASH GUARD] Uncaught exception (survived):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH GUARD] Unhandled rejection (survived):', reason?.message || reason);
});

console.log('🐙 Starting Octo Telegram Bot...');
console.log(`Allowed user ID: ${ALLOWED_USER_ID}`);
console.log(`Claude CLI: ${CLAUDE_CLI_PATH}`);
console.log(`Timeout: ${CLAUDE_TIMEOUT / 1000}s`);

// Grammy bot — no special config needed
const bot = new Bot(BOT_TOKEN);

// Per-user model selection
const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const DEFAULT_MODEL = 'sonnet';
const userModels = new Map(); // userId -> preferred model

// After each long-poll getUpdates returns, wait 2s before the next one.

// --- Thread Context (Message History) ---

// Track recent messages per chat for context (in-memory only, expires after 30min)
const recentMessages = new Map(); // chatId -> [{role, text, timestamp}]
const CONTEXT_LIMIT = 3;
const CONTEXT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

function addToContext(chatId, role, text) {
  if (!recentMessages.has(chatId)) {
    recentMessages.set(chatId, []);
  }

  const messages = recentMessages.get(chatId);
  messages.push({ role, text: text.substring(0, 500), timestamp: Date.now() });

  // Keep only last 3 messages
  if (messages.length > CONTEXT_LIMIT) {
    messages.shift();
  }

  recentMessages.set(chatId, messages);
}

function getRecentContext(chatId) {
  if (!recentMessages.has(chatId)) {
    return '';
  }

  const messages = recentMessages.get(chatId);
  const now = Date.now();

  // Filter out expired messages
  const validMessages = messages.filter(m => now - m.timestamp < CONTEXT_EXPIRY_MS);

  if (validMessages.length === 0) {
    recentMessages.delete(chatId);
    return '';
  }

  // Build context string
  let context = '\n## Recent Message Context\n\n';
  for (const msg of validMessages) {
    const timeAgo = Math.floor((now - msg.timestamp) / 1000 / 60); // minutes
    context += `${msg.role === 'user' ? 'User' : 'Assistant'} (${timeAgo}m ago): ${msg.text}\n`;
  }

  return context;
}

// Cleanup expired contexts every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [chatId, messages] of recentMessages.entries()) {
    const validMessages = messages.filter(m => now - m.timestamp < CONTEXT_EXPIRY_MS);
    if (validMessages.length === 0) {
      recentMessages.delete(chatId);
    } else {
      recentMessages.set(chatId, validMessages);
    }
  }
}, 10 * 60 * 1000);

// --- Helpers ---

function isQuietHours() {
  const now = new Date();
  // SAST is UTC+2
  const sastHour = (now.getUTCHours() + 2) % 24;
  return sastHour >= 23 || sastHour < 8; // 23:00 - 08:00 SAST
}

async function readFileOrEmpty(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

function trimMemory(content, maxChars = 5000) {
  if (!content || content.length <= maxChars) return content;
  // Truncate at last section boundary (## heading) before limit
  const truncated = content.slice(0, maxChars);
  const lastSection = truncated.lastIndexOf('\n##');
  if (lastSection > maxChars * 0.7) {
    return truncated.slice(0, lastSection) + '\n\n_[Over budget — run `memory-tool topics` for full view]_\n';
  }
  return truncated + '\n\n_[Truncated at 5KB]_\n';
}

async function buildSystemPrompt(userMessage = '', chatId = null) {
  // Core persona files (always load)
  const soul = await readFileOrEmpty(join(WORKSPACE, 'SOUL.md'));
  const identity = await readFileOrEmpty(join(WORKSPACE, 'IDENTITY.md'));
  const user = await readFileOrEmpty(join(WORKSPACE, 'USER.md'));
  const agents = await readFileOrEmpty(join(WORKSPACE, 'AGENTS.md'));
  const memory = trimMemory(await readFileOrEmpty(join(WORKSPACE, 'MEMORY.md')));
  const tools = await readFileOrEmpty(join(WORKSPACE, 'TOOLS.md'));
  const heartbeat = await readFileOrEmpty(join(WORKSPACE, 'HEARTBEAT.md'));

  // Smart context loading: only load relevant topic memories
  let topicMemories = '';
  if (userMessage) {
    // Extract keywords from message to match against memory file names
    const keywords = userMessage.toLowerCase().match(/\b\w{4,}\b/g) || [];
    const relevantTopics = new Set();

    try {
      const files = await readdir(MEMORY_DIR);
      for (const f of files) {
        if (!f.endsWith('.md') || f.startsWith('.')) continue;

        // Check if any keyword matches the filename
        const fileName = f.toLowerCase();
        for (const keyword of keywords) {
          if (fileName.includes(keyword)) {
            relevantTopics.add(f);
            break;
          }
        }
      }

      // Load only relevant topic files
      for (const f of relevantTopics) {
        const content = await readFileOrEmpty(join(MEMORY_DIR, f));
        if (content.trim()) {
          topicMemories += `\n## memory/${f}\n${content}\n`;
        }
      }

      // If no relevant topics found, don't load any (saves context)
      if (relevantTopics.size === 0) {
        console.log('[Context] No relevant topic memories for this message');
      } else {
        console.log(`[Context] Loaded ${relevantTopics.size} relevant topic memories`);
      }
    } catch {}
  }

  // AI-IQ memory context (semantic search based on current message)
  const aiiqContext = userMessage ? await buildMemoryContext(userMessage) : '';

  // Learning feedback context (past feedback on similar tasks)
  const feedbackContext = userMessage ? buildFeedbackContext(userMessage) : '';

  // Peer experience context (what other bots learned on similar tasks)
  const experienceContext = userMessage ? await buildExperienceContext(userMessage) : '';

  // Recent message context (last 3 messages in this conversation)
  const recentContext = chatId ? getRecentContext(chatId) : '';

  // Last session summary (continuity between sessions)
  let lastSessionContext = '';
  if (chatId) {
    const lastSummary = getLastSummary(chatId);
    if (lastSummary) {
      lastSessionContext = `\n## Last Session Summary\n\n${lastSummary}\n`;
    }
  }

  // Today's date
  const today = new Date().toISOString().split('T')[0];

  // Build full prompt with budget awareness
  let fullPrompt = `You are Octo 🐙 — an AI super assistant. You are running via Claude Code CLI, connected to Telegram.

Embody the persona in SOUL.md fully. Be casual, direct, no-nonsense. Lead with answers, not explanations.
Keep responses SHORT for Telegram — no markdown tables, use bullet lists. Bold for emphasis.
This is a Telegram DM with Kobus (your human). Be yourself.

Today: ${today}
Platform: Telegram DM
Runtime: Claude Code CLI (legitimate, full tool access)
Working directory: ${CLAUDE_WORKING_DIR}

You have full access to the VPS via Claude Code tools (Bash, Read, Edit, Write, Grep, Glob).
You can check servers, read logs, edit code, run commands — everything you can do.

**MEMORY MANAGEMENT**: You can update your memory by editing files in /root/octo-workspace/:
- MEMORY.md - Your hot memory index
- memory/*.md - Topic-specific memory files
Use the Write/Edit tools to update these files when you learn something important.

When asked to check something on the server, actually do it with tools. Don't just talk about it.

## Available Tools (use via Bash tool)

You have access to a unified inbox and assistant tools. Use these to help Kobus:

**Inbox (read messages):**
- All unread: node --input-type=module -e 'import {getUnread} from "./inbox.mjs"; console.log(JSON.stringify(getUnread()))'
- WhatsApp only: node --input-type=module -e 'import {getUnread} from "./inbox.mjs"; console.log(JSON.stringify(getUnread("whatsapp")))'
- Email only: node --input-type=module -e 'import {getUnread} from "./inbox.mjs"; console.log(JSON.stringify(getUnread("email-icloud")))'
- Search: node --input-type=module -e 'import {search} from "./inbox.mjs"; console.log(JSON.stringify(search("query")))'

**Send messages (ALWAYS draft and ask Kobus to confirm before sending):**
- WhatsApp: curl -X POST http://localhost:7700/send -H 'Content-Type: application/json' -d '{"to":"27xxx","message":"text"}'
- Email: node --input-type=module -e 'import {sendEmail} from "./email-sender.mjs"; sendEmail({to:"x@y.com",subject:"s",body:"b"}).then(console.log)'

**Dashboard:**
- Full: node --input-type=module -e 'import {fullDashboard} from "./dashboards.mjs"; fullDashboard().then(d=>console.log(JSON.stringify(d,null,2)))'

**Server actions:**
- Safe commands: node --input-type=module -e 'import {executeAction} from "./actions.mjs"; executeAction("disk").then(console.log)'
- Available: disk, memory, docker-ps, pm2-status, logs-whatsauction, logs-flashvault, ssl-check
- Needs confirm: restart-whatsauction, restart-flashvault, deploy-whatsauction

**WhatsApp status:** curl -s http://localhost:7700/status
**Email status:** curl -s http://localhost:7701/status

IMPORTANT: For any outbound action (sending WhatsApp, email, restarting services), ALWAYS show Kobus what you plan to do and get confirmation first. Never send messages or execute actions autonomously.

---

## SOUL.md
${soul}

## IDENTITY.md
${identity}

## USER.md
${user}

## MEMORY.md (Hot Memory Index)
${memory}

## Topic Memories
${topicMemories}
${lastSessionContext}
${recentContext}
${aiiqContext}
${feedbackContext}
${experienceContext}

## TOOLS.md
${tools}

## HEARTBEAT.md
${heartbeat}

## Key Rules (from AGENTS.md)
${agents}

---

**IMPORTANT**: Lead with the answer. "Done ✅" > 10-line explanation. Be concise. Silence is valid.
`;

  // Keep prompt under 15K chars
  if (fullPrompt.length > 15000) {
    console.log(`[Context] Prompt too long (${fullPrompt.length} chars), trimming topic memories`);
    // Remove topic memories first if over budget
    fullPrompt = fullPrompt.replace(/## Topic Memories[\s\S]*?(?=##|$)/m, '## Topic Memories\n(trimmed for space)\n');
  }

  return fullPrompt;
}

// NOTE: System prompt is now built per-message with smart context loading
// No more caching - each message gets relevant context only
async function getSystemPrompt(userMessage = '', chatId = null) {
  const basePrompt = await buildSystemPrompt(userMessage, chatId);
  const circusContext = await buildPreferenceContext();
  // W11: Add shared knowledge context dynamically
  const sharedKnowledge = userMessage ? await getRelevantSharedKnowledge(userMessage.slice(0, 500)) : '';
  return basePrompt + circusContext + sharedKnowledge;
}

function splitMessage(text, maxLength = 4096) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = maxLength;
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    const lastSpace = remaining.lastIndexOf(' ', maxLength);
    if (lastNewline > maxLength * 0.8) splitAt = lastNewline + 1;
    else if (lastSpace > maxLength * 0.8) splitAt = lastSpace + 1;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }
  return chunks;
}

function startTypingIndicator(ctx) {
  // Send immediately to eliminate initial gap
  ctx.replyWithChatAction('typing').catch(() => {});

  // Refresh every 3s (well before Telegram's ~5s expiry for reliability)
  const interval = setInterval(async () => {
    try { await ctx.replyWithChatAction('typing'); } catch {}
  }, 3000);

  return () => clearInterval(interval);
}

function isAuthorized(ctx) {
  return ctx.from?.id === ALLOWED_USER_ID;
}

function getModel(userId) {
  return userModels.get(userId) || DEFAULT_MODEL;
}

// --- Command Handlers ---

bot.command('start', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.reply('🐙 Octo is online. What do you need?');
});

bot.command('model', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const userId = ctx.from.id;
  const arg = ctx.message.text.replace('/model', '').trim().toLowerCase();
  if (!arg) {
    const current = getModel(userId);
    await ctx.reply(`Current model: ${current}\nAvailable: ${VALID_MODELS.join(', ')}`);
    return;
  }
  if (!VALID_MODELS.includes(arg)) {
    await ctx.reply(`Invalid model. Available: ${VALID_MODELS.join(', ')}`);
    return;
  }
  userModels.set(userId, arg);
  await ctx.reply(`Model switched to: ${arg}`);
});

bot.command('clear', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const chatId = ctx.chat.id;

  // Get topic history for snapshot summary
  const history = getTopicHistory(chatId, 5);
  const topics = [...new Set(history.map(h => h.topic))];
  const topicSummary = topics.length > 0 ? topics.join(', ') : 'general conversation';

  // Get session ID for handoff
  const sessionInfo = getSessionInfo(chatId);
  const sessionId = sessionInfo?.sessionId || 'unknown';

  // Capture handoff snapshot with recent context
  const recentMsgs = [];
  for (const h of history.slice(0, 3)) {
    recentMsgs.push({ role: 'user', text: h.topic });
  }

  try {
    await captureSessionSnapshot(sessionId, recentMsgs);
    console.log(`[Clear] Handoff snapshot captured for session ${sessionId}`);
  } catch (error) {
    console.error('[Clear] Handoff snapshot failed:', error.message);
  }

  // Also use old snapshot method as backup
  try {
    const snapshotContent = `Telegram session with Kobus: ${topicSummary}`;
    await execFileAsync('memory-tool', [
      'snapshot',
      snapshotContent
    ], { timeout: 5000 });
    console.log(`[Clear] Auto-snapshot created: ${snapshotContent}`);
  } catch (error) {
    console.error('[Clear] Snapshot failed:', error.message);
  }

  // Clear session
  clearSession(chatId);

  // Clear context tracking
  clearContext(chatId);

  await ctx.reply('🐙 Fresh start. Session snapshotted & cleared. Go.');
});

bot.command('session', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const info = getSessionInfo(ctx.chat.id);
  const stats = getStats();

  if (!info) {
    await ctx.reply(`🐙 No active session.\n\nGlobal: ${stats.total} sessions (${stats.active24h} active in 24h)`);
  } else {
    await ctx.reply(
      `🐙 Session: \`${info.sessionId}\`\n` +
      `Age: ${info.age} min\n` +
      `Last used: ${info.lastUsed} min ago\n\n` +
      `Global: ${stats.total} sessions (${stats.active24h} active in 24h)`,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.command('status', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);

  try {
    const claudeProcess = spawn(CLAUDE_CLI_PATH, [
      '--print', '--output-format', 'text', '--model', 'haiku',
      '--system-prompt', 'You are Octo 🐙. Run a quick health check: docker ps --format "{{.Names}} {{.Status}}", pm2 jlist | jq -r ".[] | .name + \" \" + .pm2_env.status", curl -sf http://localhost:4000/health | jq .status, df -h / | tail -1. Report concisely with bullet points.',
    ], { cwd: CLAUDE_WORKING_DIR, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    claudeProcess.stdout.on('data', d => stdout += d.toString());
    claudeProcess.stdin.write('Run the health check now\n');
    claudeProcess.stdin.end();

    await new Promise((resolve) => claudeProcess.on('close', resolve));
    stopTyping();

    const response = stdout.trim() || 'Could not run health check.';
    for (const chunk of splitMessage(response)) await ctx.reply(chunk);
  } catch (e) {
    stopTyping();
    await ctx.reply(`Health check failed: ${e.message}`);
  }
});

bot.command('memory', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const args = ctx.message.text.split(/\s+/).slice(1);
  const subcommand = args[0];

  // /memory stats
  if (subcommand === 'stats') {
    await ctx.replyWithChatAction('typing');
    try {
      const { stdout } = await execFileAsync('memory-tool', ['stats'], { timeout: 10000 });
      const lines = stdout.trim().split('\n').slice(0, 15).join('\n');
      await ctx.reply(`🧠 *Memory Stats*\n\n\`\`\`\n${lines}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply(`Stats failed: ${e.message}`);
    }
    return;
  }

  // /memory recent
  if (subcommand === 'recent') {
    await ctx.replyWithChatAction('typing');
    try {
      const { stdout } = await execFileAsync('memory-tool', [
        'list',
        '--project', 'Octo'
      ], { timeout: 10000, maxBuffer: 1024 * 1024 });

      const lines = stdout.trim().split('\n').slice(0, 10);
      if (lines.length === 0 || lines[0].includes('No memories')) {
        await ctx.reply('🐙 No recent Octo memories');
      } else {
        const formatted = lines.join('\n');
        await ctx.reply(`🧠 *Recent Octo Memories*\n\n\`\`\`\n${formatted}\n\`\`\``, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      await ctx.reply(`Recent failed: ${e.message}`);
    }
    return;
  }

  // /memory add <content>
  if (subcommand === 'add') {
    const content = args.slice(1).join(' ');
    if (!content) {
      await ctx.reply('🐙 Usage: /memory add <content>');
      return;
    }

    try {
      await storeMemory(content, ['telegram', 'claw', 'manual'], 'learning');
      await ctx.reply('✅ Memory stored');
    } catch (e) {
      await ctx.reply(`❌ Failed: ${e.message}`);
    }
    return;
  }

  // /memory search <query> (default)
  const query = subcommand === 'search' ? args.slice(1).join(' ') : args.join(' ');

  if (!query) {
    await ctx.reply('🐙 Usage:\n/memory search <query>\n/memory add <content>\n/memory recent\n/memory stats');
    return;
  }

  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Use AI-IQ hybrid search
    const memories = await searchMemory(query, 5);

    stopTyping();

    if (memories.length === 0) {
      await ctx.reply(`🐙 No memories found for: ${query}`);
    } else {
      let msg = `🧠 *Memory Search: ${query}*\n\n`;
      for (let i = 0; i < memories.length; i++) {
        msg += `${i + 1}. ${memories[i].substring(0, 200)}...\n\n`;
      }
      await ctx.reply(msg, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    stopTyping();
    await ctx.reply(`Search failed: ${e.message}`);
  }
});

bot.command('heartbeat', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.reply('🐙 Running heartbeat check...');

  try {
    const { execSync } = await import('child_process');
    execSync('/root/claude-telegram-bot/heartbeat.mjs', { timeout: 30000 });
    await ctx.reply('✅ Heartbeat complete. Check logs for details.');
  } catch (e) {
    await ctx.reply(`Heartbeat failed: ${e.message}`);
  }
});

bot.command('inbox', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const stats = getInboxStats();
  let msg = '🐙 *Inbox Summary*\n\n';
  if (stats.bySource && stats.bySource.length > 0) {
    for (const s of stats.bySource) {
      const icon = s.source.includes('whatsapp') ? '📱' : s.source.includes('email') ? '📧' : '📨';
      msg += `${icon} ${s.source}: ${s.unread} unread / ${s.total} total\n`;
    }
  } else {
    msg += 'No messages yet.\n';
  }
  msg += `\n*Total: ${stats.unread} unread*`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('wa', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const messages = getUnread('whatsapp', 20);
  if (messages.length === 0) {
    await ctx.reply('📱 No unread WhatsApp messages');
    return;
  }
  let msg = '📱 *WhatsApp Unread*\n\n';
  // Group by chat
  const byChat = {};
  for (const m of messages) {
    const key = m.chat_name || m.from_name || m.from_address;
    if (!byChat[key]) byChat[key] = [];
    byChat[key].push(m);
  }
  for (const [chat, msgs] of Object.entries(byChat)) {
    msg += `*${chat}* (${msgs.length})\n`;
    for (const m of msgs.slice(0, 3)) {
      msg += `  ${m.from_name || m.from_address}: ${(m.body || '').slice(0, 60)}\n`;
    }
    if (msgs.length > 3) msg += `  ...and ${msgs.length - 3} more\n`;
    msg += '\n';
  }
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('email', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const icloud = getUnread('email-icloud', 20);
  const pop = getUnread('email-pop', 20);
  const all = [...icloud, ...pop].sort((a, b) => b.timestamp - a.timestamp);
  if (all.length === 0) {
    await ctx.reply('📧 No unread emails');
    return;
  }
  let msg = '📧 *Email Unread*\n\n';
  for (const m of all.slice(0, 10)) {
    const src = m.source === 'email-icloud' ? 'iCloud' : 'Pop';
    const priority = m.priority === 'urgent' ? '🔴' : '';
    msg += `${priority}[${src}] *${m.from_name || m.from_address}*\n  ${m.subject || '(no subject)'}\n\n`;
  }
  if (all.length > 10) msg += `...and ${all.length - 10} more`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('biz', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);
  try {
    const d = await fullDashboard();
    let msg = '📊 *Business Dashboard*\n\n';

    msg += '*WhatsAuction*\n';
    msg += `• Signups: ${d.whatsauction.signups24h} (24h) / ${d.whatsauction.signups7d} (7d)\n`;
    msg += `• Bids: ${d.whatsauction.bids24h} (24h)\n`;
    msg += `• API: ${d.whatsauction.apiHealth}\n\n`;

    msg += '*FlashVault*\n';
    msg += `• Users: ${d.flashvault.totalUsers}\n`;
    msg += `• VPN peers: ${d.flashvault.activePeers}\n`;
    msg += `• API: ${d.flashvault.apiHealth}\n\n`;

    msg += '*Server*\n';
    msg += `• Disk: ${d.server.disk}\n`;
    msg += `• Load: ${d.server.load}\n`;

    stopTyping();
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    stopTyping();
    await ctx.reply(`Dashboard error: ${e.message}`);
  }
});

bot.command('ops', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);
  try {
    const d = await serverDashboard();
    let msg = '🖥️ *Server Status*\n\n';
    msg += `*Disk:* ${d.disk}\n`;
    msg += `*Memory:* ${d.mem}\n`;
    msg += `*Load:* ${d.load}\n\n`;
    msg += `*Docker:*\n${d.docker}\n\n`;
    msg += `*PM2:*\n${d.pm2}`;
    stopTyping();
    for (const chunk of splitMessage(msg)) await ctx.reply(chunk);
  } catch (e) {
    stopTyping();
    await ctx.reply(`Ops error: ${e.message}`);
  }
});

bot.command('qr', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  try {
    const res = await fetch('http://127.0.0.1:7700/qr', { headers: internalHeaders });
    if (!res.ok) {
      const status = await fetch('http://127.0.0.1:7700/status', { headers: internalHeaders }).then(r => r.json()).catch(() => ({}));
      await ctx.reply(`📱 WhatsApp status: ${status.status || 'unknown'}. No QR needed.`);
      return;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const qrPath = '/tmp/claw-wa-qr.png';
    await writeFile(qrPath, buffer);
    await ctx.replyWithPhoto({ source: qrPath });
    await ctx.reply('📱 Scan this QR with your WhatsApp');
  } catch (e) {
    await ctx.reply(`QR fetch failed: ${e.message}`);
  }
});

// NEW COMMANDS

bot.command('context', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const chatId = ctx.chat.id;
  const context = getContext(chatId);
  const topicStats = getTopicStats(chatId);

  let msg = '🗂️ *Conversation Context*\n\n';
  msg += `Current topic: *${context.currentTopic}*\n\n`;

  if (context.transitions.length > 0) {
    msg += '*Recent topic shifts:*\n';
    for (const t of context.transitions) {
      const timeAgo = Math.floor((Date.now() - t.timestamp) / 1000 / 60);
      msg += `• ${t.from} → ${t.to} (${timeAgo}m ago)\n`;
    }
    msg += '\n';
  }

  if (context.recentMessages && context.recentMessages.length > 0) {
    msg += '*Recent messages:*\n';
    for (const m of context.recentMessages.slice(0, 3)) {
      const timeAgo = Math.floor((Date.now() - m.timestamp) / 1000 / 60);
      msg += `• [${m.topic}] ${m.message_preview.substring(0, 40)}... (${timeAgo}m ago)\n`;
    }
    msg += '\n';
  }

  if (topicStats.length > 0) {
    msg += '*Top topics:*\n';
    for (const s of topicStats.slice(0, 5)) {
      msg += `• ${s.topic}: ${s.count} messages\n`;
    }
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('feedback', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const stats = getLearningStats();
  const patterns = getTopPatterns(3);

  let msg = '🧠 *Learning Stats*\n\n';
  msg += `Total feedback: ${stats.total}\n`;
  msg += `✅ Positive: ${stats.positive}\n`;
  msg += `❌ Negative: ${stats.negative}\n`;
  msg += `Success rate: ${stats.ratio}%\n\n`;
  msg += `*Last 7 days:*\n`;
  msg += `✅ ${stats.recent.positive} positive\n`;
  msg += `❌ ${stats.recent.negative} negative\n`;

  if (patterns.length > 0) {
    msg += '\n*Top patterns:*\n';
    for (const p of patterns) {
      msg += `• ${p.response_summary.substring(0, 50)}... (${p.count}x)\n`;
    }
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('task', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const args = ctx.message.text.split(/\s+/).slice(1);
  const subcommand = args[0];

  if (!subcommand || subcommand === 'list') {
    const tasks = listTasks();
    if (tasks.length === 0) {
      await ctx.reply('🤖 No tasks scheduled');
      return;
    }

    let msg = '🤖 *Background Tasks*\n\n';
    for (const task of tasks) {
      const status = task.enabled ? '✅' : '⏸️';
      const interval = task.interval_ms / 1000 / 60; // minutes
      const nextRun = task.next_run ? Math.floor((task.next_run - Date.now()) / 1000 / 60) : 0;
      msg += `${status} *${task.name}*\n`;
      msg += `  Every ${interval}m | Next: ${nextRun}m\n`;
      msg += `  \`${task.command}\`\n\n`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } else if (subcommand === 'add') {
    // /task add "name" "command" 5m
    const name = args[1];
    const command = args[2];
    const interval = args[3];

    if (!name || !command || !interval) {
      await ctx.reply('Usage: /task add <name> <command> <interval>\nExample: /task add "check-disk" "df -h /" 30m');
      return;
    }

    const result = addTask(name, command, interval, ctx.chat.id);
    if (result.ok) {
      await ctx.reply(`✅ Task "${name}" added (every ${interval})`);
    } else {
      await ctx.reply(`❌ Failed: ${result.error}`);
    }
  } else if (subcommand === 'stop') {
    const name = args[1];
    if (!name) {
      await ctx.reply('Usage: /task stop <name>');
      return;
    }

    const result = toggleTask(name, false);
    if (result.ok) {
      await ctx.reply(`⏸️ Task "${name}" stopped`);
    } else {
      await ctx.reply(`❌ Failed: ${result.error}`);
    }
  } else if (subcommand === 'start') {
    const name = args[1];
    if (!name) {
      await ctx.reply('Usage: /task start <name>');
      return;
    }

    const result = toggleTask(name, true);
    if (result.ok) {
      await ctx.reply(`▶️ Task "${name}" started`);
    } else {
      await ctx.reply(`❌ Failed: ${result.error}`);
    }
  } else if (subcommand === 'remove') {
    const name = args[1];
    if (!name) {
      await ctx.reply('Usage: /task remove <name>');
      return;
    }

    const result = removeTask(name);
    if (result.ok) {
      await ctx.reply(`🗑️ Task "${name}" removed`);
    } else {
      await ctx.reply(`❌ Failed: ${result.error}`);
    }
  } else {
    await ctx.reply('Usage: /task [list|add|stop|start|remove]');
  }
});

bot.command('analyze', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.reply('📸 Send me a photo to analyze');
});

bot.command('remember', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const content = ctx.message.text.replace('/remember', '').trim();
  if (!content) {
    await ctx.reply('🐙 Usage: /remember <what to remember>\nExample: /remember FlashVault backend runs on port 3000');
    return;
  }

  await ctx.replyWithChatAction('typing');

  try {
    const result = await storeMemory(content, ['telegram', 'manual', 'claw'], 'learning');
    if (result.ok) {
      await ctx.reply('✅ Remembered');
    } else {
      await ctx.reply(`❌ Failed to store: ${result.error}`);
    }
  } catch (e) {
    await ctx.reply(`Memory error: ${e.message}`);
  }
});

bot.command('recall', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const query = ctx.message.text.replace('/recall', '').trim();
  if (!query) {
    await ctx.reply('🐙 Usage: /recall <search query>\nExample: /recall FlashVault port');
    return;
  }

  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);

  try {
    const memories = await searchMemory(query, 5);
    stopTyping();

    if (memories.length === 0) {
      await ctx.reply(`🧠 No memories found for: ${query}`);
    } else {
      let msg = `🧠 *AI-IQ Memories (${memories.length})*\n\n`;
      for (let i = 0; i < memories.length; i++) {
        msg += `${i + 1}. ${memories[i]}\n\n`;
      }
      for (const chunk of splitMessage(msg)) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      }
    }
  } catch (e) {
    stopTyping();
    await ctx.reply(`Recall error: ${e.message}`);
  }
});

bot.command('forget', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const query = ctx.message.text.replace('/forget', '').trim();
  if (!query) {
    await ctx.reply('🐙 Usage: /forget <search query>\nExample: /forget old flashvault config');
    return;
  }

  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Search for memories matching the query
    const { stdout } = await execFileAsync('memory-tool', [
      'search',
      query,
      '--full'
    ], { timeout: 10000, maxBuffer: 1024 * 1024 });

    // Parse memory IDs from output (format: ID | content | ...)
    const lines = stdout.trim().split('\n');
    const memoryIds = [];

    for (const line of lines) {
      const match = line.match(/^(\d+)\s*\|/);
      if (match) {
        memoryIds.push(match[1]);
      }
    }

    stopTyping();

    if (memoryIds.length === 0) {
      await ctx.reply(`🧠 No memories found for: ${query}`);
      return;
    }

    // Show found memories with their IDs
    let msg = `🗑️ *Found ${memoryIds.length} memories*\n\n`;
    msg += stdout.split('\n').slice(0, 10).join('\n');
    msg += `\n\nTo delete, use: /forget-confirm ${memoryIds[0]}`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    stopTyping();
    await ctx.reply(`Forget error: ${e.message}`);
  }
});

bot.command('forget-confirm', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const memoryId = ctx.message.text.replace('/forget-confirm', '').trim();
  if (!memoryId || !memoryId.match(/^\d+$/)) {
    await ctx.reply('🐙 Usage: /forget-confirm <memory-id>\nExample: /forget-confirm 42');
    return;
  }

  await ctx.replyWithChatAction('typing');

  try {
    await execFileAsync('memory-tool', ['delete', memoryId], { timeout: 5000 });
    await ctx.reply(`✅ Memory #${memoryId} deleted`);
  } catch (e) {
    await ctx.reply(`❌ Failed to delete: ${e.message}`);
  }
});

bot.command('scavenge', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const args = ctx.message.text.split(/\s+/).slice(1);
  const githubUrl = args[0];

  if (!githubUrl || !githubUrl.includes('github.com')) {
    await ctx.reply('Usage: /scavenge <github-url>\nExample: /scavenge https://github.com/user/repo');
    return;
  }

  await ctx.reply('🔍 Scavenging repo for useful patterns...');
  const stopTyping = startTypingIndicator(ctx);

  try {
    const systemPrompt = await getSystemPrompt('', ctx.chat.id);
    const scavengePrompt = `Extract useful patterns, code snippets, and ideas from this GitHub repo that are relevant to our projects (FlashVault, WhatsAuction, Octo). Focus on: architecture patterns, interesting libraries, deployment strategies, monitoring/logging setups, API designs.

GitHub repo: ${githubUrl}

Use the Bash tool to clone or read the repo, then summarize key learnings.`;

    const claudeProcess = spawn(CLAUDE_CLI_PATH, [
      '--print',
      '--output-format', 'text',
      '--model', getModel(ctx.from?.id || 0),
      '--system-prompt', systemPrompt,
    ], { cwd: CLAUDE_WORKING_DIR, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    claudeProcess.stdout.on('data', d => stdout += d.toString());
    claudeProcess.stdin.write(scavengePrompt + '\n');
    claudeProcess.stdin.end();

    await new Promise((resolve) => claudeProcess.on('close', resolve));
    stopTyping();

    const response = stdout.trim();
    if (response) {
      // Store in AI-IQ memory
      await storeMemory(`Scavenged from ${githubUrl}: ${response.substring(0, 500)}`, ['scavenge', 'github', 'learning']);

      for (const chunk of splitMessage(response)) {
        await ctx.reply(chunk);
      }
      await ctx.reply('💾 Stored in AI-IQ memory');
    } else {
      await ctx.reply('❌ Could not extract useful patterns');
    }
  } catch (e) {
    stopTyping();
    await ctx.reply(`Scavenge failed: ${e.message}`);
  }
});

bot.command('overnight', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  return; // overnight feature disabled
  const status = getOvernightStatus();
  if (!status) {
    return ctx.reply('No overnight run active. Say "work on [objective]" to start one.\n— Octo 🐙');
  }
  const last = status.lastResult;
  await ctx.reply([
    `🌙 *Overnight Run Status*`,
    ``,
    `Objective: ${status.objective.slice(0, 100)}`,
    `Progress: iteration ${status.iteration}/${status.maxIterations}`,
    `Commits: ${status.committedCount}`,
    `Last: ${last ? (last.committed ? '✅' : last.rollbacked ? '❌' : '⚪') + ' ' + last.summary.slice(0, 80) : 'starting...'}`,
    `Elapsed: ${Math.round((Date.now() - new Date(status.startedAt)) / 60000)}min`,
    ``,
    `Say "stop overnight" to cancel.`,
    `— Octo 🐙`
  ].join('\n'), { parse_mode: 'Markdown' });
});

// --- Proactive Alerts Commands ---

bot.command('alerts', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const stats = getAlertStats();
  const recent = getRecentAlerts(5);

  let msg = `🚨 *Alert Statistics*\n\n`;
  msg += `Total: ${stats.total}\n`;
  msg += `Critical: ${stats.critical}\n`;
  msg += `Last 24h: ${stats.last24h}\n`;
  msg += `Queued: ${stats.queued}\n\n`;

  if (recent.length > 0) {
    msg += `*Recent Alerts:*\n\n`;
    for (const alert of recent) {
      const icon = alert.critical ? '🚨' : '⚠️';
      const timeAgo = Math.floor((Date.now() - alert.last_sent) / 1000 / 60);
      msg += `${icon} ${alert.message.substring(0, 100)} (${timeAgo}m ago)\n\n`;
    }
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('mute', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const args = ctx.message.text.split(/\s+/).slice(1);
  const minutes = parseInt(args[0], 10);

  if (!minutes || minutes < 1 || minutes > 1440) {
    await ctx.reply('🐙 Usage: /mute <minutes>\nExample: /mute 30\n(Max 1440 minutes / 24 hours)');
    return;
  }

  muteAlerts(minutes);
  await ctx.reply(`🔕 Alerts muted for ${minutes} minutes`);
});

// --- Job Queue Commands ---

bot.command('queue', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const text = ctx.message.text.replace('/queue', '').trim();

  if (!text) {
    await ctx.reply('🐙 Usage: /queue <description> | <command>\nExample: /queue run tests | cd /root/whatsauction && npm test');
    return;
  }

  const parts = text.split('|').map(p => p.trim());
  if (parts.length !== 2) {
    await ctx.reply('❌ Format: /queue <description> | <command>');
    return;
  }

  const [description, command] = parts;

  const jobId = enqueueJob(ctx.chat.id, description, command);
  await ctx.reply(`✅ Job #${jobId} queued: ${description}\n\nUse /jobs to see status`);
});

bot.command('jobs', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  try {
    // Try global job queue first
    const { listJobs: listGlobalJobs } = await import('/root/jobs/queue.mjs');
    const globalJobs = listGlobalJobs(8);
    if (globalJobs.length > 0) {
      const lines = globalJobs.map(j => {
        const icon = j.status === 'done' ? '✅' : j.status === 'running' ? '🔄' : j.status === 'failed' ? '❌' : '⏳';
        return `${icon} ${j.title.slice(0,40)} (${j.status})`;
      });
      await ctx.reply(`**Recent Jobs:**\n${lines.join('\n')}`);
      return;
    }
  } catch (err) {
    console.error('[Octo] Global jobs error:', err.message);
  }

  // Fallback to local queue
  const jobs = listJobs(ctx.chat.id, 10);
  const stats = getQueueStats();

  if (jobs.length === 0) {
    await ctx.reply(`🐙 No jobs yet\n\nQueue: ${stats.queued} | Running: ${stats.running} | Done: ${stats.done} | Failed: ${stats.failed}`);
    return;
  }

  let msg = `📋 *Recent Jobs*\n\n`;

  for (const job of jobs) {
    const icon = job.status === 'done' ? '✅' : job.status === 'failed' ? '❌' : job.status === 'running' ? '🔄' : '⏳';
    const timeAgo = Math.floor((Date.now() - job.created_at) / 1000 / 60);

    msg += `${icon} #${job.id} (${job.status}) - ${job.description}\n`;
    msg += `  Created: ${timeAgo}m ago\n`;

    if (job.exit_code !== null) {
      msg += `  Exit code: ${job.exit_code}\n`;
    }

    msg += '\n';
  }

  msg += `\nQueue: ${stats.queued} | Running: ${stats.running}`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('job', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const jobId = parseInt(ctx.message.text.replace('/job', '').trim(), 10);

  if (!jobId) {
    await ctx.reply('🐙 Usage: /job <id>\nExample: /job 5');
    return;
  }

  const job = getJobStatus(jobId);

  if (!job) {
    await ctx.reply(`❌ Job #${jobId} not found`);
    return;
  }

  const icon = job.status === 'done' ? '✅' : job.status === 'failed' ? '❌' : job.status === 'running' ? '🔄' : '⏳';

  let msg = `${icon} *Job #${job.id}*\n\n`;
  msg += `Description: ${job.description}\n`;
  msg += `Status: ${job.status}\n`;
  msg += `Created: ${new Date(job.createdAt).toISOString()}\n`;

  if (job.startedAt) {
    msg += `Started: ${new Date(job.startedAt).toISOString()}\n`;
  }

  if (job.completedAt) {
    msg += `Completed: ${new Date(job.completedAt).toISOString()}\n`;
    msg += `Duration: ${job.duration}s\n`;
  }

  if (job.exitCode !== null && job.exitCode !== undefined) {
    msg += `Exit code: ${job.exitCode}\n`;
  }

  msg += '\n';

  if (job.output) {
    msg += `*Output:*\n\`\`\`\n${job.output.substring(0, 2000)}\n\`\`\``;
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// --- Message Reaction Handlers ---

bot.on('message_reaction', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const reaction = ctx.messageReaction;
  if (!reaction || !reaction.new_reaction || reaction.new_reaction.length === 0) {
    return;
  }

  // Get the new reaction emoji
  const newReaction = reaction.new_reaction[0];
  const emoji = newReaction.type === 'emoji' ? newReaction.emoji : null;

  if (!emoji) return;

  // Map emoji to signal
  let signal = null;
  if (['👍', '✅', '💯', '🎉', '👌', '🔥'].includes(emoji)) {
    signal = 'positive';
  } else if (['👎', '❌', '⛔'].includes(emoji)) {
    signal = 'negative';
  }

  if (signal) {
    // We don't have the original message text here, so we'll store a generic feedback
    // In a real implementation, you'd need to track message IDs to original content
    storeFeedback(
      `Reaction to message ${reaction.message_id}`,
      `User reacted with ${emoji}`,
      signal,
      `chat_id: ${reaction.chat.id}`
    );
    console.log(`[Learning] Captured ${signal} feedback from reaction ${emoji}`);
  }
});

// --- Callback Query Handlers ---

// Confirm action
bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const actionId = ctx.match[1];
  const action = getPendingAction(actionId);
  if (!action) {
    await ctx.answerCallbackQuery('Expired');
    return;
  }
  try {
    if (action.type === 'whatsapp') {
      const res = await fetch('http://127.0.0.1:7700/send', {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify(action.data),
      });
      const result = await res.json();
      await ctx.editMessageText(result.ok ? `✅ WhatsApp sent to ${action.data.to}` : `❌ Failed: ${result.error}`);
    } else if (action.type === 'email') {
      const result = await sendEmail(action.data);
      await ctx.editMessageText(result.ok ? `✅ Email sent to ${action.data.to}` : `❌ Failed: ${result.error}`);
    } else if (action.type === 'command') {
      const result = await executeAction(action.data.name);
      await ctx.editMessageText(result.ok ? `✅ Done\n${(result.output || '').slice(0, 500)}` : `❌ ${result.error}`);
    }
    removePendingAction(actionId);
  } catch (e) {
    await ctx.editMessageText(`❌ Error: ${e.message}`);
    removePendingAction(actionId);
  }
  await ctx.answerCallbackQuery();
});

// Cancel action
bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
  removePendingAction(ctx.match[1]);
  await ctx.editMessageText('❌ Cancelled');
  await ctx.answerCallbackQuery();
});

// Edit action
bot.callbackQuery(/^edit:(.+)$/, async (ctx) => {
  await ctx.editMessageText('✏️ Send the edited version as your next message');
  await ctx.answerCallbackQuery();
});

// --- Message Handlers ---

bot.on('message:voice', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  try {
    const file = await ctx.getFile();
    const filePath = `/tmp/telegram-voice-${Date.now()}.ogg`;
    const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);
    await ctx.reply('🎤 Transcribing...');
    const text = await transcribe(filePath);
    await ctx.reply(`🎤 "${text}"`);
    // Feed into Claude
    ctx.message.text = text;
    await handleTextMessage(ctx);
  } catch (e) {
    await ctx.reply(`Voice error: ${e.message}`);
  }
});

// --- Message Handlers ---

bot.on('message:document', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  try {
    const file = await ctx.getFile();
    const filePath = `/tmp/telegram-${ctx.message.document.file_unique_id}-${ctx.message.document.file_name}`;

    // Download file (Grammy doesn't have built-in download, use fetch)
    const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);

    const caption = ctx.message.caption || '';
    const userMessage = `${caption}\n\n[File uploaded: ${filePath} (${ctx.message.document.file_name})]`.trim();

    // Process with Claude (treat as regular message)
    ctx.message.text = userMessage;
    await handleTextMessage(ctx);
  } catch (e) {
    console.error('File download error:', e);
    await ctx.reply(`🐙 Failed to download file: ${e.message}`);
  }
});

bot.on('message:photo', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  try {
    const photos = ctx.message.photo;
    const processedPhotos = [];

    // Process all photos (Telegram sends multiple sizes)
    // We'll use the largest one
    const largestPhoto = photos[photos.length - 1];
    const file = await ctx.getFile();
    const filePath = `/tmp/telegram-photo-${largestPhoto.file_unique_id}.jpg`;

    // Download photo
    const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);

    // Check file size
    const stats = await import('fs/promises').then(m => m.stat(filePath));
    const sizeMB = stats.size / 1024 / 1024;

    let finalPath = filePath;
    if (sizeMB > 5) {
      // Warn about large file (compression would require sharp dependency)
      console.log(`[Photo] Large image: ${sizeMB.toFixed(2)}MB - compression skipped (sharp not installed)`);
      await ctx.reply(`⚠️ Large image (${sizeMB.toFixed(1)}MB) - processing may be slow`);
    }

    // Build image metadata for Claude
    const imageInfo = `[Photo uploaded: ${finalPath}, ${largestPhoto.width}x${largestPhoto.height}, ${sizeMB.toFixed(1)}MB]`;

    // Auto-describe image using Claude Haiku (quick, cheap)
    await ctx.reply('📸 Analyzing image...');
    let imageDescription = '';

    try {
      const descProcess = spawn(CLAUDE_CLI_PATH, [
        '--print',
        '--output-format', 'text',
        '--model', 'haiku',
        '--system-prompt', 'You are an image analysis assistant. Describe this image concisely in 1-2 sentences. Focus on key elements, text, and context.'
      ], { cwd: CLAUDE_WORKING_DIR, stdio: ['pipe', 'pipe', 'pipe'] });

      let descOutput = '';
      descProcess.stdout.on('data', d => descOutput += d.toString());
      descProcess.stdin.write(`Describe this image: ${finalPath}\n`);
      descProcess.stdin.end();

      await new Promise((resolve) => descProcess.on('close', resolve));
      imageDescription = descOutput.trim();

      if (imageDescription) {
        await ctx.reply(`🔍 ${imageDescription}`);
      }
    } catch (descError) {
      console.error('Image description failed:', descError.message);
    }

    const caption = ctx.message.caption || '';
    const userMessage = `${caption}\n\n${imageInfo}\nImage content: ${imageDescription}`.trim();

    // Process with Claude
    ctx.message.text = userMessage;
    await handleTextMessage(ctx);
  } catch (e) {
    console.error('Photo download error:', e);
    await ctx.reply(`🐙 Failed to download photo: ${e.message}`);
  }
});

bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  if (userMessage.startsWith('/')) return; // Skip commands
  if (!isAuthorized(ctx)) return;

  // Natural language job dispatch: "claw: fix the circus tests"
  if (/^claw[,:]\s+/i.test(userMessage)) {
    const description = userMessage.replace(/^claw[,:]\s+/i, '');
    try {
      const { enqueueJob: enqueueGlobalJob } = await import('/root/jobs/queue.mjs');
      const jobId = enqueueGlobalJob({
        title: description.slice(0, 60),
        description,
        submittedBy: 'octo',
        notifyChatId: String(ctx.chat.id)
      });
      await ctx.reply(`🐙 Job queued: ${jobId}\n\n"${description.slice(0, 80)}"\n\nI'll notify you when it's done.`);
      return;
    } catch (err) {
      await ctx.reply(`Job queue error: ${err.message}`);
      return;
    }
  }

  await handleTextMessage(ctx);
});

async function handleTextMessage(ctx) {
  const userMessage = ctx.message.text;
  const chatId = ctx.chat.id;

  console.log(`[${new Date().toISOString()}] ${userMessage.substring(0, 100)}`);

  // Detect and publish preference signals (non-blocking)
  const prefSignals = detectPreferenceSignals(userMessage);
  for (const sig of prefSignals) {
    publishPreference(sig.field, sig.value, sig.confidence, sig.reasoning)
      .catch(err => console.error('[Circus] Signal publish failed:', err.message));
  }

  // Check if user is correcting the bot
  const correctionSignal = detectCorrectionSignal(userMessage);
  if (correctionSignal.isCorrection) {
    console.log('[Circus] Correction signal detected:', correctionSignal.reason.slice(0, 80));
    writeCorrection(
      `User correction: ${correctionSignal.reason}`,
      correctionSignal.reason,
      'Octo'
    ).catch(e => console.error('[Circus] Correction write failed:', e.message));
  }

  // Add user message to context
  addToContext(chatId, 'user', userMessage);

  // BOT FACTORY INTERCEPTS — handle before Claude CLI
  const text = userMessage;

  // Overnight task detection — disabled (triggers removed)
  const overnightMatch = null;
  const overnightStatusMatch = false;
  const overnightStopMatch = false;

  if (overnightStopMatch) {
    const stopped = stopOvernightRun();
    return ctx.reply(stopped ? '✅ Overnight run stopping after current iteration.\n— Octo 🐙' : 'No overnight run active.\n— Octo 🐙');
  }

  if (overnightStatusMatch) {
    const status = getOvernightStatus();
    if (!status) return ctx.reply('No overnight run active.\n— Octo 🐙');
    const last = status.lastResult;
    return ctx.reply([
      `🌙 *Overnight Run*`,
      ``,
      `Objective: ${status.objective.slice(0, 100)}`,
      `Progress: iteration ${status.iteration}/${status.maxIterations}`,
      `Commits: ${status.committedCount}`,
      `Last: ${last ? (last.committed ? '✅' : last.rollbacked ? '❌' : '⚪') + ' ' + last.summary.slice(0, 80) : 'starting...'}`,
      ``,
      `— Octo 🐙`
    ].join('\n'), { parse_mode: 'Markdown' });
  }

  if (overnightMatch) {
    const objective = overnightMatch[1].trim();
    const status = getOvernightStatus();
    if (status) {
      return ctx.reply(`❌ Overnight run already active: "${status.objective}"\nStop it first with "stop overnight".\n— Octo 🐙`);
    }

    // Infer working directory from objective
    const cwdMap = {
      'relay': '/root/hydra-note',
      'hydra': '/root/hydra-note',
      'whatsauction': '/root/whatsauction',
      'auction': '/root/whatsauction',
      'octo': '/root/octo-workspace',
      'circus': '/root/bot-circus',
    };
    let cwd = CLAUDE_WORKING_DIR || '/root/octo-workspace';
    for (const [key, dir] of Object.entries(cwdMap)) {
      if (objective.toLowerCase().includes(key)) { cwd = dir; break; }
    }

    await ctx.reply(`🌙 Starting overnight run...\n\n*Objective:* ${objective}\n*Repo:* ${cwd}\n*Max iterations:* 20\n\nI'll commit after each successful step and report back every 5 iterations.\n— Octo 🐙`, { parse_mode: 'Markdown' });

    // Start async (don't await — runs in background)
    startOvernightRun({
      objective,
      cwd,
      maxIterations: 20,
      onProgress: async (iteration, result) => {
        // Report every 5 iterations or on final iteration
        if (iteration % 5 === 0 || result.isDone || result.isStuck) {
          const icon = result.committed ? '✅' : result.rollbacked ? '❌' : '⚪';
          await bot.api.sendMessage(
            ALLOWED_USER_ID,
            `${icon} *Overnight iter ${iteration}*\n${result.summary.slice(0, 150)}\n— Octo 🐙`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      },
      onComplete: async (summary) => {
        const msg = [
          `🌙 *Overnight Run Complete*`,
          ``,
          `Objective: ${summary.objective.slice(0, 100)}`,
          `Iterations: ${summary.iterations}`,
          `Commits: ${summary.committed}`,
          `Duration: ${Math.round((new Date(summary.completedAt) - new Date(summary.startedAt)) / 60000)}min`,
          summary.stopped ? '⚠️ Stopped manually' : summary.history.at(-1)?.isDone ? '✅ Objective complete' : '⏹️ Max iterations reached',
          ``,
          `Branch: ${summary.startCommit} → ${summary.endCommit}`,
          `— Octo 🐙`
        ].join('\n');
        await bot.api.sendMessage(ALLOWED_USER_ID, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
    }).catch(err => {
      bot.api.sendMessage(ALLOWED_USER_ID, `❌ Overnight run failed: ${err.message}\n— Octo 🐙`).catch(() => {});
    });

    return; // Don't pass to Claude
  }

  const spawnMatch = text.match(/(?:create|spawn|make|build)\s+a\s+(?:(?:new|specialist|general)\s+)?bot\s+(?:called\s+|named\s+)?([a-zA-Z][a-zA-Z0-9\s-]{1,30})?/i);
  const listBotsMatch = /(?:list|show)\s+(?:my\s+)?bots?/i.test(text);
  const killMatch = text.match(/(?:kill|stop|delete|remove)\s+(?:bot\s+@?|@)([a-zA-Z][a-zA-Z0-9-]{1,30})/i);

  if (listBotsMatch) {
    const bots = await loadManagedBots();
    if (bots.length === 0) {
      return ctx.reply('No managed bots yet. Say "create a bot that..." to spawn one.\n— Octo 🐙');
    }
    const list = bots.map(b => `• @${b.username} (${b.type}) — ${b.rolePrompt.slice(0, 60)}`).join('\n');
    return ctx.reply(`*My Bots:*\n${list}`, { parse_mode: 'Markdown' });
  }

  if (killMatch) {
    const safeName = killMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await killBot(safeName);
    return ctx.reply(`✅ @${killMatch[1]} stopped and removed.\n— Octo 🐙`);
  }

  if (spawnMatch) {
    const name = spawnMatch[1]?.trim() || 'NewBot';
    const isSpecialist = /specialist|lightweight|simple|monitor|alert|watch/i.test(text);
    const type = isSpecialist ? 'specialist' : 'general';
    const rolePrompt = text.replace(/(?:create|spawn|make|build)\s+a\s+(?:(?:new|specialist|general)\s+)?bot\s+(?:called\s+|named\s+)?[a-zA-Z][a-zA-Z0-9\s-]*/i, '').trim() || `Bot named ${name}`;

    await ctx.reply(`Creating *${name}* (${type} bot)...\n\n_Role: ${rolePrompt.slice(0, 100)}_\n\nThis takes ~60 seconds. ⏳`, { parse_mode: 'Markdown' });

    try {
      const result = await spawnBot({
        octoToken: BOT_TOKEN,
        name,
        type,
        rolePrompt,
        allowedUserId: ALLOWED_USER_ID
      });
      await ctx.reply(`✅ *${result.name}* is live!\n\nUsername: ${result.username}\nType: ${result.type}\nPM2: \`${result.pm2Name}\`\n\nAdd it to any group or start a DM.\n— Octo 🐙`, { parse_mode: 'Markdown' });
    } catch (err) {
      if (err.message.includes('Token required')) {
        // Token needs to be obtained from BotFather manually
        await ctx.reply(`To create *${name}*, I need a BotFather token:\n\n${err.message}`, { parse_mode: 'Markdown' });
        // TODO: store pending spawn state for token reply
      } else {
        await ctx.reply(`❌ Failed to spawn bot: ${err.message}\n— Octo 🐙`);
      }
    }
    return; // Don't pass to Claude
  }

  // Start typing indicator immediately (loops every 4s until stopped)
  const stopTyping = startTypingIndicator(ctx);

  // Send placeholder message immediately for streaming updates
  let thinkingMsg = await ctx.reply('🐙 thinking...');

  // Hoisted so catch block can always reference it safely
  let accumulatedText = '';

  try {
    // Build system prompt with context (now includes AI-IQ memory + feedback + session summary)
    const systemPrompt = await getSystemPrompt(userMessage, chatId);

    // Get or create session
    const { sessionId, isNew } = getOrCreateSession(chatId);

    // Load previous session context if this is a new session
    let handoffContext = '';
    if (isNew) {
      const prevContext = await loadSessionContext(chatId);
      handoffContext = formatSessionContext(prevContext);
      if (handoffContext) {
        console.log('[Handoff] Loaded previous session context');
      }
    }

    // New session: --session-id creates it. Existing: --resume continues it.
    const sessionArgs = isNew
      ? ['--session-id', sessionId]
      : ['--resume', sessionId];

    const claudeArgs = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', getModel(ctx.from?.id || userId),
      ...sessionArgs,
      '--system-prompt', systemPrompt,
    ];

    console.log(`Using session: ${sessionId} (${isNew ? 'new' : 'resume'})`);

    const claudeProcess = spawn(CLAUDE_CLI_PATH, claudeArgs, {
      cwd: CLAUDE_WORKING_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    accumulatedText = '';
    let lastSentLength = 0;
    let isTimedOut = false;

    // Stream updates to this message
    let lastEditTime = 0;
    const EDIT_INTERVAL_MS = 500; // Lowered to 500ms for more responsive streaming

    const timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      claudeProcess.kill('SIGTERM');
    }, CLAUDE_TIMEOUT);

    // Heartbeat: if no new output for 30s, edit the message so Kobus knows it's alive
    let lastOutputTime = Date.now();
    let heartbeatDots = 0;
    const HEARTBEAT_INTERVAL_MS = 30000;
    const heartbeatHandle = setInterval(() => {
      if (Date.now() - lastOutputTime > HEARTBEAT_INTERVAL_MS && !isTimedOut) {
        heartbeatDots = (heartbeatDots + 1) % 4;
        const dots = '.'.repeat(heartbeatDots + 1);
        const elapsed = Math.round((Date.now() - lastOutputTime) / 1000);
        const preview = accumulatedText
          ? accumulatedText.slice(0, 3900) + `\n\n🐙 _still working${dots} (${elapsed}s)_`
          : `🐙 _thinking${dots} (${elapsed}s)_`;
        ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, preview).catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Buffer for incomplete JSON lines (stream may split mid-line)
    let lineBuffer = '';

    claudeProcess.stdout.on('data', (data) => {
      lastOutputTime = Date.now();
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // Keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Text content from assistant messages
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                accumulatedText += block.text;
              }
            }
          }

          // Also capture from result event (final text)
          if (event.type === 'result' && event.result) {
            // Only use result if we didn't get text from assistant events
            if (!accumulatedText.trim()) {
              accumulatedText = event.result;
            }
          }
        } catch {}
      }

      // Stream updates to Telegram (throttled by EDIT_INTERVAL_MS)
      const now = Date.now();
      if (accumulatedText.length > lastSentLength && now - lastEditTime > EDIT_INTERVAL_MS) {
        lastEditTime = now;
        lastSentLength = accumulatedText.length;
        const preview = accumulatedText.slice(0, 4000); // Telegram message limit is 4096
        ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, preview).catch(() => {
          // Ignore edit errors (rate limit, same text, etc.)
        });
      }
    });

    // Inject handoff context if new session
    const messageToSend = handoffContext ? userMessage + handoffContext : userMessage;
    claudeProcess.stdin.write(messageToSend + '\n');
    claudeProcess.stdin.end();

    await new Promise((resolve, reject) => {
      claudeProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);
        clearInterval(heartbeatHandle);
        if (isTimedOut) reject(new Error('Timed out'));
        else if (code !== 0) reject(new Error(`Exit code ${code}`));
        else resolve();
      });
      claudeProcess.on('error', (err) => {
        clearTimeout(timeoutHandle);
        clearInterval(heartbeatHandle);
        reject(err);
      });
    });

    const response = accumulatedText.trim();

    // One final edit with complete response before deleting placeholder
    if (response && response.length > lastSentLength) {
      const preview = response.slice(0, 4000);
      await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, preview).catch(() => {});
    }

    if (!response) {
      // Delete thinking message and send empty response
      await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
      stopTyping();
      await ctx.reply('🐙 *crickets*');
      return;
    }

    console.log(`Response: ${response.length} chars`);

    // Check for file mentions in response (e.g., "I've created /path/to/file")
    const fileMatches = response.match(/\/[\w\/\-\.]+\.(pdf|png|jpg|jpeg|txt|md|json|csv|log)/gi);

    // Delete thinking message before sending final response
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});

    // Send text response
    for (const chunk of splitMessage(response)) {
      await ctx.reply(chunk);
    }

    // Stop typing indicator after all messages sent
    stopTyping();

    // Send any files mentioned
    if (fileMatches) {
      for (const filePath of fileMatches) {
        if (existsSync(filePath)) {
          try {
            await ctx.replyWithDocument({ source: filePath });
          } catch (e) {
            console.error(`Failed to send file ${filePath}:`, e.message);
          }
        }
      }
    }

    // POST-RESPONSE LEARNING AND MEMORY

    // 1. Add assistant response to context
    addToContext(chatId, 'assistant', response);

    // 2. Update conversation topic tracking
    try {
      updateContext(chatId, userMessage, response);
    } catch (ctxError) {
      console.error('[Context] Update failed:', ctxError.message);
    }

    // 3. Detect feedback signal in user message
    const signal = detectSignal(userMessage);
    if (signal) {
      const responseSummary = response.substring(0, 200);
      storeFeedback(userMessage, responseSummary, signal);
      console.log(`[Learning] Captured ${signal} feedback`);
    }

    // 4. Auto-store conversation in AI-IQ memory
    try {
      await autoStoreConversation(userMessage, response);
    } catch (memError) {
      console.error('[Memory] Auto-store failed:', memError.message);
    }

    // 5. Share significant learnings to Circus (cross-agent knowledge)
    try {
      const { shouldShare, category, domain, confidence, content } = shouldShareKnowledge(userMessage, response);
      if (shouldShare) {
        const written = await writeSharedKnowledge(content, category, confidence, domain, 'Octo');
        if (written) console.log(`[Circus] Shared ${category} knowledge to Circus (domain: ${domain})`);
      }
    } catch (circusErr) {
      console.error('[Circus] Knowledge share failed (non-fatal):', circusErr.message);
    }

  } catch (error) {
    stopTyping();
    console.error('Error:', error.message);

    // Capture session snapshot before context death
    const sessionInfo = getSessionInfo(chatId);
    if (sessionInfo) {
      const recentMsgs = [];
      const history = getTopicHistory(chatId, 3);
      for (const h of history) {
        recentMsgs.push({ role: 'user', text: h.topic });
      }
      try {
        await captureSessionSnapshot(sessionInfo.sessionId, recentMsgs, accumulatedText);
        console.log('[Handoff] Session snapshot captured on error');
      } catch (snapErr) {
        console.error('[Handoff] Snapshot failed:', snapErr.message);
      }
    }

    // Try to delete thinking message if it exists
    if (typeof thinkingMsg !== 'undefined') {
      await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    }

    if (error.message.includes('Timed out')) {
      await ctx.reply(`🐙 That took too long (${CLAUDE_TIMEOUT / 1000}s). Try something simpler?`);
    } else if (error.message.includes('Exit code')) {
      // Session might be corrupted — clear and retry
      console.log('Session error, clearing session for retry');
      clearSession(chatId);
      await ctx.reply(`🐙 Session glitched. Cleared it — send your message again.`);
    } else {
      await ctx.reply(`🐙 Something broke: ${error.message.slice(0, 200)}`);
    }
  }
}

// --- Error Handler ---

bot.catch((err) => console.error('Bot error:', err));

// --- Start Bot ---

console.log('🐙 Bot starting with long polling...');

// Start background task scheduler with alert callback
startScheduler(
  // Send task results to Telegram
  (chatId, message) => {
    return bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  },
  // Alert callback - check if task output should trigger alert
  (output, exitCode, chatId, taskName) => {
    if (shouldAlert(output, exitCode)) {
      const alertMsg = `Task "${taskName}" triggered alert:\n\n${output.substring(0, 500)}`;
      sendAlert(bot, chatId, alertMsg);
    }
  }
);

// Start queue processor (checks every 5 seconds)
setInterval(() => {
  processQueue(bot).catch(err => {
    console.error('[Queue] Processor error:', err.message);
  });
}, 5000);

// Flush queued alerts at 08:00 SAST (check every hour)
setInterval(() => {
  const now = new Date();
  const sastHour = (now.getUTCHours() + 2) % 24;
  const minute = now.getUTCMinutes();

  // At 08:00 SAST (within first 5 minutes of the hour)
  if (sastHour === 8 && minute < 5) {
    flushQueuedAlerts(bot, ALLOWED_USER_ID).catch(err => {
      console.error('[Alerts] Flush failed:', err.message);
    });
  }
}, 60 * 60 * 1000); // Check every hour

// 409 retry wrapper — Telegram holds old polling connections for ~30s after restart.
// grammy crashes hard on 409; this catches it and retries with backoff.
const WEBHOOK_PORT = 7712;
const WEBHOOK_URL = 'https://whatshubb.co.za/webhook/octo';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'octo-webhook-x9k2m7p4';

async function startWebhook() {
  try {
    // Initialize bot (fetches bot info)
    await bot.init();
    console.log(`🐙 Bot initialized: @${bot.botInfo.username}`);

    // Register webhook with Telegram — drop pending so stale queued messages don't flood on start
    await bot.api.setWebhook(WEBHOOK_URL, {
      drop_pending_updates: true,
      secret_token: WEBHOOK_SECRET,
    });
    console.log(`🐙 Webhook registered: ${WEBHOOK_URL}`);

    // Per-chat lock: only one Claude response at a time per chat
    const processingChats = new Set();

    // Custom HTTP server: immediately ACKs Telegram (200 OK), then processes in background.
    // Grammy's default webhookCallback has a 10s timeout which causes retries for long Claude responses.
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
      const secret = req.headers['x-telegram-bot-api-secret-token'];
      if (secret !== WEBHOOK_SECRET) { res.writeHead(401); res.end('Unauthorized'); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        // ACK immediately so Telegram doesn't retry
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        try {
          const update = JSON.parse(body);
          const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
          // Skip if already processing a message for this chat
          if (chatId && processingChats.has(chatId)) {
            console.log(`[Webhook] Chat ${chatId} busy, skipping duplicate update`);
            return;
          }
          if (chatId) processingChats.add(chatId);
          bot.handleUpdate(update).catch(err => {
            console.error('[Webhook] Error handling update:', err.message);
          }).finally(() => {
            if (chatId) processingChats.delete(chatId);
          });
        } catch (err) {
          console.error('[Webhook] Failed to parse update:', err.message);
        }
      });
    });

    server.listen(WEBHOOK_PORT, () => {
      console.log(`🐙 Webhook server listening on port ${WEBHOOK_PORT}`);

      // Add built-in heartbeat task
      addHeartbeatTask(ALLOWED_USER_ID);

      // Register default monitoring tasks if they don't exist
      if (!getTask('docker-health')) {
        addTask(
          'docker-health',
          'docker ps --format "{{.Names}} {{.Status}}" | grep -v Up || echo "All containers running"',
          '10m',
          ALLOWED_USER_ID
        );
        console.log('[Tasks] Registered docker-health task');
      }

      if (!getTask('api-health')) {
        addTask(
          'api-health',
          'curl -sf http://localhost:4000/health && curl -sf http://localhost:3000/health && echo "APIs healthy" || echo "API health check failed"',
          '5m',
          ALLOWED_USER_ID
        );
        console.log('[Tasks] Registered api-health task');
      }

      if (!getTask('disk-check')) {
        addTask(
          'disk-check',
          'df -h / | awk \'NR==2{if(int($5) > 85) print "CRITICAL: Disk usage at "$5; else print "Disk OK: "$5}\'',
          '30m',
          ALLOWED_USER_ID
        );
        console.log('[Tasks] Registered disk-check task');
      }

      console.log('🐙 Octo is online and listening (webhook mode)!');
      console.log('🐙 All systems online. Monitoring active.');

      // Register with Circus + start task inbox poller (non-fatal if Circus is down)
      circusRegister('Octo', 'builder', ['memory', 'preference', 'code', 'monitoring'])
        .then(token => {
          if (token) {
            // Join troupe for scoped memory sharing
            joinTroupe('telegram-bots').catch(e => console.error('[Circus] troupe join failed:', e.message));

            // Register Octo's task handlers
            registerTaskHandler('build', async (payload) => {
              // Log the build request — Octo will see it in logs
              const brief = payload.brief || payload.description || JSON.stringify(payload);
              console.log(`[Circus] Build task received:\n${brief}`);
              return { received: true, brief, note: 'Logged for review — Octo processes via Claude' };
            });

            registerTaskHandler('code_review', async (payload) => {
              const target = payload.file || payload.target || 'unknown';
              console.log(`[Circus] Code review task for: ${target}`);
              return { received: true, target };
            });

            // Start polling inbox every 60s
            startTaskInboxPoller(60_000);
          }
        })
        .catch(err => console.error('[Circus] Startup register failed:', err.message));
    });

    server.on('error', (err) => {
      console.error('🐙 Webhook server error:', err.message);
    });

  } catch (err) {
    console.error('🐙 Fatal startup error:', err.message);
    await new Promise(r => setTimeout(r, 10000));
    return startWebhook();
  }
}

async function withDnsRetry(fn, { maxAttempts = 10, baseDelayMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isDns = err.message?.includes('name resolution')
                 || err.message?.includes('ECONNRESET')
                 || err.message?.includes('ENOTFOUND')
                 || err.message?.includes('ETIMEDOUT');

      if (!isDns || attempt === maxAttempts) throw err;

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 60_000); // cap 60s
      console.log(`🤖 DNS not ready (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function startPolling() {
  await bot.init();
  console.log(`🐙 Bot initialized: @${bot.botInfo.username}`);
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  addHeartbeatTask(ALLOWED_USER_ID);
  console.log('🐙 Octo is online and listening (polling mode)!');
  console.log('🐙 All systems online. Monitoring active.');

  // Register with Circus (non-fatal)
  circusRegister('Octo', 'assistant', ['memory', 'preference', 'code', 'monitoring'])
    .then(token => {
      if (token) {
        startHeartbeat();
        joinTroupe('telegram-bots').catch(e => console.error('[Circus] troupe join failed:', e.message));
        registerTaskHandler('build', async (payload) => {
          const brief = payload.brief || payload.description || JSON.stringify(payload);
          console.log(`[Circus] Build task received:\n${brief}`);
          return { received: true, brief };
        });
        startTaskInboxPoller();
        console.log('[Circus] ✅ Octo registered, heartbeat + task poller started');
      }
    })
    .catch(e => console.error('[Circus] Registration failed (non-fatal):', e.message));

  await bot.start();
}

const USE_POLLING = process.env.USE_POLLING === 'true';
if (USE_POLLING) {
  startPolling().catch(err => {
    console.error('🐙 Polling startup failed:', err.message);
    process.exit(1);
  });
} else {
  withDnsRetry(startWebhook).catch(err => {
    console.error('🐙 Startup failed after retries:', err.message);
    process.exit(1);
  });
}

const shutdown = async (sig) => {
  console.log(`🐙 ${sig} received, shutting down...`);
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
