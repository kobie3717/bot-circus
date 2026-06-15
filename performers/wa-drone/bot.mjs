#!/usr/bin/env node

import http from 'node:http';
import { Bot } from 'grammy';
import { spawn } from 'child_process';
import { config } from 'dotenv';
import { readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getOrCreateSession, clearSession, getSessionInfo, getStats } from './sessions.mjs';
import { transcribe } from './voice.mjs';
import { createConfirmKeyboard, addPendingAction, getPendingAction, removePendingAction, generateActionId } from './confirm.mjs';
import { getUnread, getStats as getInboxStats, search as searchInbox, markAllRead } from './inbox.mjs';
import { sendEmail, verifySmtp } from './email-sender.mjs';
import { fullDashboard, serverDashboard } from './dashboards.mjs';
import { executeAction, listActions, getAction } from './actions.mjs';
import { buildMemoryContext, autoStoreConversation, storeMemory, searchMemory } from './memory-bridge.mjs';
import { circusRegister, joinTroupe, buildPreferenceContext, detectPreferenceSignals, publishPreference, getRelevantSharedKnowledge, writeSharedKnowledge, shouldShareKnowledge, writeCorrection, detectCorrectionSignal, registerTaskHandler, startTaskInboxPoller, submitTask, getAgentId } from './circus-bridge.mjs';

// ESM __dirname polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables (override to prevent inherited env vars from clobbering .env)
config({ override: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID, 10);
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH;
const CLAUDE_WORKING_DIR = process.env.CLAUDE_WORKING_DIR || '/root';
const CLAUDE_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT, 10) || 300000; // 5 min default
const CLAW_API_KEY = process.env.CLAW_API_KEY;

// Internal API auth headers
const internalHeaders = CLAW_API_KEY
  ? { 'Content-Type': 'application/json', 'X-API-Key': CLAW_API_KEY }
  : { 'Content-Type': 'application/json' };

// WA-Drone workspace paths (local to this performer)
const WORKSPACE = __dirname;
const MEMORY_DIR = join(WORKSPACE, 'memory');

if (!BOT_TOKEN || !ALLOWED_USER_ID || !CLAUDE_CLI_PATH) {
  console.error('Error: TELEGRAM_BOT_TOKEN, ALLOWED_USER_ID, and CLAUDE_CLI_PATH required in .env');
  process.exit(1);
}

console.log('🛸 Starting WA-Drone Telegram Bot...');
console.log(`Allowed user ID: ${ALLOWED_USER_ID}`);
console.log(`Claude CLI: ${CLAUDE_CLI_PATH}`);
console.log(`Timeout: ${CLAUDE_TIMEOUT / 1000}s`);

const bot = new Bot(BOT_TOKEN);

// Per-user model selection
const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const DEFAULT_MODEL = 'sonnet';
const userModels = new Map(); // userId -> preferred model

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

async function buildSystemPrompt(userMessage = '') {
  // Core persona files
  const soul = await readFileOrEmpty(join(WORKSPACE, 'SOUL.md'));
  const identity = await readFileOrEmpty(join(WORKSPACE, 'IDENTITY.md'));
  const user = await readFileOrEmpty(join(WORKSPACE, 'USER.md'));
  const agents = await readFileOrEmpty(join(WORKSPACE, 'AGENTS.md'));
  const memory = trimMemory(await readFileOrEmpty(join(WORKSPACE, 'MEMORY.md')));
  const tools = await readFileOrEmpty(join(WORKSPACE, 'TOOLS.md'));
  const heartbeat = await readFileOrEmpty(join(WORKSPACE, 'HEARTBEAT.md'));

  // Smart topic loading — only load files relevant to userMessage keywords
  let topicMemories = '';
  try {
    const files = await readdir(MEMORY_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('.'));

    const keywords = (userMessage || '').toLowerCase().match(/\b\w{4,}\b/g) || [];
    const relevantFiles = new Set();

    for (const f of mdFiles) {
      const fileName = f.toLowerCase().replace('.md', '');
      for (const keyword of keywords) {
        if (fileName.includes(keyword) || keyword.includes(fileName)) {
          relevantFiles.add(f);
          break;
        }
      }
    }

    // If no match, load nothing (MEMORY.md has the index)
    for (const f of relevantFiles) {
      const content = await readFileOrEmpty(join(MEMORY_DIR, f));
      if (content.trim()) {
        topicMemories += `\n## memory/${f}\n${content}\n`;
      }
    }

    if (relevantFiles.size > 0) {
      console.log(`[Context] Loaded ${relevantFiles.size} relevant topic files: ${[...relevantFiles].join(', ')}`);
    }
  } catch {}

  // Today's date
  const today = new Date().toISOString().split('T')[0];

  return `You are WA-Drone 🛸 — an AI super assistant. You are running via Claude Code CLI, connected to Telegram.

Embody the persona in SOUL.md fully. Be casual, direct, no-nonsense. Lead with answers, not explanations.
Keep responses SHORT for Telegram — no markdown tables, use bullet lists. Bold for emphasis.
This is a Telegram DM with Kobus (your human). Be yourself.

Today: ${today}
Platform: Telegram DM
Runtime: Claude Code CLI (legitimate, full tool access)
Working directory: ${CLAUDE_WORKING_DIR}

You have full access to the VPS via Claude Code tools (Bash, Read, Edit, Write, Grep, Glob).
You can check servers, read logs, edit code, run commands — everything you can do.

**MEMORY MANAGEMENT**: You can update your memory by editing files in ${WORKSPACE}:
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

## TOOLS.md
${tools}

## HEARTBEAT.md
${heartbeat}

## Key Rules (from AGENTS.md)
${agents}

---

**IMPORTANT**: Lead with the answer. "Done ✅" > 10-line explanation. Be concise. Silence is valid.
`;
}

// Cache the system prompt (rebuild every 10 minutes)
let cachedSystemPrompt = '';
let promptCacheTime = 0;
const PROMPT_CACHE_TTL = 10 * 60 * 1000;

async function getSystemPrompt(userMessage = '') {
  // Always rebuild base + preferences if cache expired
  if (!cachedSystemPrompt || Date.now() - promptCacheTime > PROMPT_CACHE_TTL) {
    const basePrompt = await buildSystemPrompt(userMessage);
    const circusContext = await buildPreferenceContext();
    cachedSystemPrompt = basePrompt + circusContext;
    promptCacheTime = Date.now();
    console.log(`System prompt loaded (${cachedSystemPrompt.length} chars, Circus: ${circusContext ? 'active' : 'none'})`);
  }

  // W11: Add shared knowledge context dynamically (not cached, per-message)
  const sharedKnowledge = userMessage ? await getRelevantSharedKnowledge(userMessage.slice(0, 500)) : '';
  return cachedSystemPrompt + sharedKnowledge;
}

// Preload on startup
getSystemPrompt();

// Register with Circus + start task inbox poller (non-fatal if Circus is down)
circusRegister('WA-Drone', 'wa-drone', ['memory', 'preference', 'inbox', 'messaging'])
  .then(token => {
    if (token) {
      // Join troupe for scoped memory sharing
      joinTroupe('telegram-bots').catch(e => console.error('[Circus] troupe join failed:', e.message));

      // Register WA-Drone's task handlers
      registerTaskHandler('notify', async (payload) => {
        // Deliver a notification to Kobus via Telegram
        const msg = payload.message || payload.text || JSON.stringify(payload);
        try {
          const KOBUS_CHAT_ID = process.env.KOBUS_CHAT_ID || process.env.ADMIN_CHAT_ID;
          if (KOBUS_CHAT_ID) {
            await bot.api.sendMessage(KOBUS_CHAT_ID, `📩 Circus task:\n${msg}`);
          }
        } catch (_) {}
        return { delivered: true, message: msg };
      });

      registerTaskHandler('remind', async (payload) => {
        const msg = payload.message || payload.text || JSON.stringify(payload);
        try {
          const KOBUS_CHAT_ID = process.env.KOBUS_CHAT_ID || process.env.ADMIN_CHAT_ID;
          if (KOBUS_CHAT_ID) {
            await bot.api.sendMessage(KOBUS_CHAT_ID, `⏰ Reminder:\n${msg}`);
          }
        } catch (_) {}
        return { reminded: true };
      });

      // Start polling inbox every 60s
      startTaskInboxPoller(60_000);
    }
  })
  .catch(err => console.error('[Circus] Startup register failed:', err.message));

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
  const interval = setInterval(async () => {
    try { await ctx.replyWithChatAction('typing'); } catch {}
  }, 4000);
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
  await ctx.reply('🛸 WA-Drone is online. What do you need?');
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

  // Clear session
  clearSession(ctx.chat.id);

  // Invalidate prompt cache to reload fresh memories
  cachedSystemPrompt = '';
  promptCacheTime = 0;

  await ctx.reply('🛸 Fresh start. Session cleared, memories reloaded. Go.');
});

bot.command('session', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const info = getSessionInfo(ctx.chat.id);
  const stats = getStats();

  if (!info) {
    await ctx.reply(`🛸 No active session.\n\nGlobal: ${stats.total} sessions (${stats.active24h} active in 24h)`);
  } else {
    await ctx.reply(
      `🛸 Session: \`${info.sessionId}\`\n` +
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
      '--system-prompt', 'You are WA-Drone 🛸. Run a quick health check: docker ps --format "{{.Names}} {{.Status}}", pm2 jlist | jq -r ".[] | .name + \" \" + .pm2_env.status", curl -sf http://localhost:4000/health | jq .status, df -h / | tail -1. Report concisely with bullet points.',
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

  const query = ctx.message.text.replace('/memory', '').trim();
  if (!query) {
    await ctx.reply('🛸 Usage: /memory <search query>');
    return;
  }

  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Search WA-Drone workspace memory files (safe: no shell interpolation)
    const { spawnSync } = await import('child_process');
    const grepResult = spawnSync('grep', ['-ri', query, WORKSPACE, '--include=*.md', '-n'], {
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const results = (grepResult.stdout || '').trim().split('\n').slice(0, 20).join('\n');

    stopTyping();

    if (!results) {
      await ctx.reply(`🛸 No memory matches for: ${query}`);
    } else {
      const formatted = results.split('\n').slice(0, 10).join('\n');
      await ctx.reply(`🛸 Memory search: ${query}\n\n${formatted}`);
    }
  } catch (e) {
    stopTyping();
    if (e.status === 1) {
      await ctx.reply(`🛸 No memory matches for: ${query}`);
    } else {
      await ctx.reply(`Memory search failed: ${e.message}`);
    }
  }
});

bot.command('heartbeat', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.reply('🛸 Running heartbeat check...');

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
  let msg = '🛸 *Inbox Summary*\n\n';
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

// Job queue commands
bot.command('job', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const description = ctx.message.text.replace('/job', '').trim();
  if (!description) {
    await ctx.reply('Usage: /job <task description>');
    return;
  }
  try {
    const { enqueueJob } = await import('/root/jobs/queue.mjs');
    const jobId = enqueueJob({
      title: description.slice(0, 60),
      description,
      submittedBy: 'friday',
      notifyChatId: String(ctx.chat.id)
    });
    await ctx.reply(`🤖 Job queued: ${jobId}\n\n"${description.slice(0, 80)}"\n\nI'll notify you when it's done.`);
  } catch (err) {
    await ctx.reply(`Job queue error: ${err.message}`);
  }
});

bot.command('jobs', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  try {
    const { listJobs } = await import('/root/jobs/queue.mjs');
    const jobs = listJobs(8);
    if (jobs.length === 0) {
      await ctx.reply('No jobs yet.');
      return;
    }
    const lines = jobs.map(j => {
      const icon = j.status === 'done' ? '✅' : j.status === 'running' ? '🔄' : j.status === 'failed' ? '❌' : '⏳';
      return `${icon} ${j.title.slice(0,40)} (${j.status})`;
    });
    await ctx.reply(`**Recent Jobs:**\n${lines.join('\n')}`);
  } catch (err) {
    await ctx.reply(`Job list error: ${err.message}`);
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
    await ctx.reply(`🛸 Failed to download file: ${e.message}`);
  }
});

bot.on('message:photo', async (ctx) => {
  if (!isAuthorized(ctx)) return;

  try {
    // Get largest photo
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const file = await ctx.getFile();
    const filePath = `/tmp/telegram-photo-${largestPhoto.file_unique_id}.jpg`;

    // Download photo
    const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);

    const caption = ctx.message.caption || '';
    const userMessage = `${caption}\n\n[Photo uploaded: ${filePath}]`.trim();

    // Process with Claude
    ctx.message.text = userMessage;
    await handleTextMessage(ctx);
  } catch (e) {
    console.error('Photo download error:', e);
    await ctx.reply(`🛸 Failed to download photo: ${e.message}`);
  }
});

bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  if (userMessage.startsWith('/')) return; // Skip commands
  if (!isAuthorized(ctx)) return;

  // Natural language job dispatch: "friday: fix the circus tests"
  if (/^friday[,:]\s+/i.test(userMessage)) {
    const description = userMessage.replace(/^friday[,:]\s+/i, '');
    try {
      const { enqueueJob } = await import('/root/jobs/queue.mjs');
      const jobId = enqueueJob({
        title: description.slice(0, 60),
        description,
        submittedBy: 'friday',
        notifyChatId: String(ctx.chat.id)
      });
      await ctx.reply(`🤖 Job queued: ${jobId}\n\n"${description.slice(0, 80)}"\n\nI'll notify you when it's done.`);
      return;
    } catch (err) {
      await ctx.reply(`Job queue error: ${err.message}`);
      return;
    }
  }

  await handleTextMessage(ctx);
});

// Streaming response helper - edits placeholder message as text accumulates
async function streamReplyToTelegram(ctx, claudeProcess, timeoutMs) {
  let accumulatedText = '';
  let placeholderMsg = null;
  let lastEditTime = 0;
  let pendingEdit = false;
  let isTimedOut = false;

  const EDIT_DEBOUNCE_MS = 400; // Conservative rate limit
  const MAX_CHUNK_SIZE = 4096; // Telegram message limit

  // Send initial placeholder
  placeholderMsg = await ctx.reply('💁‍♀️ _thinking..._', { parse_mode: 'Markdown' });

  const timeoutHandle = setTimeout(() => {
    isTimedOut = true;
    claudeProcess.kill('SIGTERM');
  }, timeoutMs);

  // Debounced edit function
  const tryEdit = async (force = false) => {
    if (pendingEdit) return;

    const now = Date.now();
    const timeSinceLastEdit = now - lastEditTime;

    if (!force && timeSinceLastEdit < EDIT_DEBOUNCE_MS) {
      // Schedule a deferred edit
      pendingEdit = true;
      setTimeout(() => {
        pendingEdit = false;
        tryEdit(false);
      }, EDIT_DEBOUNCE_MS - timeSinceLastEdit);
      return;
    }

    if (!accumulatedText.trim()) return;

    try {
      const suffix = force ? '' : '...▎';
      const overflowNote = '\n\n_[continues below...]_';
      const textToShow = accumulatedText.length + suffix.length <= MAX_CHUNK_SIZE
        ? accumulatedText + suffix
        : accumulatedText.slice(0, MAX_CHUNK_SIZE - overflowNote.length) + overflowNote;

      await ctx.api.editMessageText(
        ctx.chat.id,
        placeholderMsg.message_id,
        textToShow
      );
      lastEditTime = Date.now();
    } catch (e) {
      // Silently ignore "message is not modified" errors
      if (!e.description?.includes('message is not modified')) {
        console.error('Edit error:', e.description || e.message);
      }
    }
  };

  // Buffer for incomplete JSON lines
  let lineBuffer = '';

  claudeProcess.stdout.on('data', (data) => {
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
              tryEdit(false); // Trigger debounced edit
            }
          }
        }

        // Also capture from result event (final text)
        if (event.type === 'result' && event.result) {
          if (!accumulatedText.trim()) {
            accumulatedText = event.result;
          }
        }
      } catch {}
    }
  });

  // Wait for process to complete
  await new Promise((resolve, reject) => {
    claudeProcess.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (isTimedOut) reject(new Error('Timed out'));
      else if (code !== 0) reject(new Error(`Exit code ${code}`));
      else resolve();
    });
    claudeProcess.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
  });

  // Final edit with clean text (no typing indicator)
  await tryEdit(true);

  return accumulatedText.trim();
}

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
      'WA-Drone'
    ).catch(e => console.error('[Circus] Correction write failed:', e.message));
  }

  await ctx.replyWithChatAction('typing');
  const stopTyping = startTypingIndicator(ctx);

  try {
    // Build system prompt with memory context
    const memoryContext = await buildMemoryContext(userMessage);
    const baseSystemPrompt = await getSystemPrompt(userMessage);  // W11: Pass message for shared knowledge
    const systemPrompt = memoryContext
      ? baseSystemPrompt + memoryContext
      : baseSystemPrompt;

    // Get or create session
    const { sessionId, isNew } = getOrCreateSession(chatId);

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

    claudeProcess.stdin.write(userMessage + '\n');
    claudeProcess.stdin.end();

    // Stream response with live updates
    const response = await streamReplyToTelegram(ctx, claudeProcess, CLAUDE_TIMEOUT);

    stopTyping();

    if (!response) {
      await ctx.reply('🛸 *crickets*');
      return;
    }

    console.log(`Response: ${response.length} chars`);

    // Auto-store conversation to memory
    await autoStoreConversation(userMessage, response);

    // Share significant learnings to Circus (cross-agent knowledge)
    try {
      const { shouldShare, category, domain, confidence, content } = shouldShareKnowledge(userMessage, response);
      if (shouldShare) {
        const written = await writeSharedKnowledge(content, category, confidence, domain, 'WA-Drone');
        if (written) console.log(`[Circus] Shared ${category} knowledge to Circus (domain: ${domain})`);
      }
    } catch (circusErr) {
      console.error('[Circus] Knowledge share failed (non-fatal):', circusErr.message);
    }

    // If response exceeds Telegram limit, send remaining chunks
    if (response.length > 4096) {
      const chunks = splitMessage(response);
      // First chunk already sent via streaming edits, send remaining
      for (let i = 1; i < chunks.length; i++) {
        await ctx.reply(chunks[i]);
      }
    }

    // Check for file mentions in response
    const fileMatches = response.match(/\/[\w\/\-\.]+\.(pdf|png|jpg|jpeg|txt|md|json|csv|log)/gi);

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

  } catch (error) {
    stopTyping();
    console.error('Error:', error.message);

    if (error.message.includes('Timed out')) {
      await ctx.reply(`🛸 That took too long (${CLAUDE_TIMEOUT / 1000}s). Try something simpler?`);
    } else if (error.message.includes('Exit code')) {
      // Session might be corrupted — clear and retry
      console.log('Session error, clearing session for retry');
      clearSession(chatId);
      await ctx.reply(`🛸 Session glitched. Cleared it — send your message again.`);
    } else {
      await ctx.reply(`🛸 Something broke: ${error.message.slice(0, 200)}`);
    }
  }
}

// --- Error Handler ---

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[Friday] Error handling update ${ctx?.update?.update_id}:`, err.error?.message || err.message);
});

// --- Start Bot ---

console.log('🛸 Bot starting with long polling...');

async function startBot(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    // Wait for Telegram to release old polling connection
    if (attempt > 1) {
      const wait = Math.min(attempt * 5, 30);
      console.log(`🛸 Waiting ${wait}s for Telegram to release old connection...`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
    await bot.start({
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query'],
      onStart: () => console.log('🛸 WA-Drone is online and polling!'),
    });
  } catch (err) {
    if (err?.error_code === 409 && attempt < MAX_ATTEMPTS) {
      const wait = attempt * 10;
      console.log(`🛸 409 conflict (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return startBot(attempt + 1);
    }
    console.error(`🛸 Fatal start error (attempt ${attempt}):`, err.description || err.message);
    // Wait before exit so PM2 exponential backoff kicks in
    await new Promise(r => setTimeout(r, 10000));
    process.exit(1);
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
      console.log(`💁‍♀️ DNS not ready (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Task injection server — router POSTs here instead of Telegram self-message
const WA_DRONE_TASK_PORT = 4205;
const waDroneTaskServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/task') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message, chatId } = JSON.parse(body);
      if (!message || !chatId) { res.writeHead(400); res.end('missing fields'); return; }
      res.writeHead(200); res.end('ok'); // respond immediately; errors logged below
      console.log(`[TaskServer] Received task: "${message.substring(0, 60)}"`);
      const syntheticCtx = {
        chat: { id: chatId },
        from: { id: chatId },
        message: { text: message, message_id: Date.now(), date: Math.floor(Date.now() / 1000) },
        reply: (text) => bot.api.sendMessage(chatId, text),
        replyWithChatAction: () => Promise.resolve(),
      };
      handleTextMessage(syntheticCtx).catch(err => console.error('[TaskServer] Handler error:', err.message));
    } catch (err) {
      console.error('[TaskServer] Parse error:', err.message);
      if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
    }
  });
});
waDroneTaskServer.listen(WA_DRONE_TASK_PORT, '127.0.0.1', () => {
  console.log(`✓ WA-Drone task server on 127.0.0.1:${WA_DRONE_TASK_PORT}`);
});

withDnsRetry(startBot).catch(err => {
  console.error('💁‍♀️ Startup failed after retries:', err.message);
  process.exit(1);
});

// Graceful shutdown — stop polling BEFORE exit
async function gracefulShutdown(signal) {
  console.log(`🛸 ${signal} received, stopping bot...`);
  try {
    bot.stop();
  } catch {}
  // Give Grammy time to close the polling connection
  await new Promise(r => setTimeout(r, 2000));
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
