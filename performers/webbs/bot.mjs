#!/usr/bin/env node
import http from 'node:http';
import { Bot, InputFile } from 'grammy';
import { config } from 'dotenv';
import { writeFile, unlink, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
import { circusRegister, joinTroupe, circusJoinRooms, startHeartbeat, buildPreferenceContext, getRelevantSharedKnowledge, writeSharedKnowledge, shouldShareKnowledge, registerTaskHandler, startTaskInboxPoller, enableAutoReconnect } from '../../lib/circus-bridge.mjs';
import { buildMemoryContext, autoStoreConversation } from './memory-bridge.mjs';
import { dispatch as spawnWorker, poolStats as workerPoolStats } from '../../dispatch.mjs';
import { getOrCreateSession, clearSession, getSessionInfo, cleanExpiredSessions, getStats } from './sessions.mjs';

config();

const BOT_TOKEN = process.env.WEBBS_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID || '0', 10);
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || '/root/.local/bin/claude';
const WORKING_DIR = __dirname;

if (!BOT_TOKEN) {
  console.error('WEBBS_BOT_TOKEN missing in .env');
  process.exit(1);
}

process.on('uncaughtException', err => console.error('[crash guard]', err.message));
process.on('unhandledRejection', r => console.error('[crash guard]', r?.message || r));

const bot = new Bot(BOT_TOKEN);
const BOT_START = Date.now();

// Per-user model selection
const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const DEFAULT_MODEL = 'sonnet';
const userModels = new Map(); // userId -> preferred model

// Message queue state
const busyUsers = new Set();
const userQueues = new Map(); // userId -> [{msg, ctx}]

async function processNext(userId) {
  const queue = userQueues.get(userId) || [];
  if (queue.length === 0) {
    busyUsers.delete(userId);
    return;
  }
  const next = queue.shift();
  userQueues.set(userId, queue);
  await handleDesignRequest(next.ctx, next.msg, next.imagePath || null);
}

const SYSTEM_PROMPT = await readFile(join(__dirname, 'SOUL.md'), 'utf8');

function isAuthorized(ctx) {
  if (!ALLOWED_USER_ID) return true;
  return ctx.from?.id === ALLOWED_USER_ID;
}

function getModel(userId) {
  return userModels.get(userId) || DEFAULT_MODEL;
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
  const resp = await fetch(url);
  const ext = (fileInfo.file_path.split('.').pop() || 'bin').toLowerCase();
  const tmp = `/tmp/webbs-upload-${Date.now()}.${ext}`;
  await writeFile(tmp, Buffer.from(await resp.arrayBuffer()));
  return { path: tmp, ext, filePath: fileInfo.file_path };
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv', 'm4v', 'wmv']);
const PDF_EXTS   = new Set(['pdf']);
const TEXT_EXTS  = new Set(['html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx', 'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'toml', 'vue', 'svelte']);

async function extractVideoFrame(videoPath) {
  const framePath = videoPath + '-frame.jpg';
  await execFileAsync('ffmpeg', [
    '-i', videoPath, '-ss', '00:00:01', '-frames:v', '1',
    '-q:v', '2', framePath, '-y'
  ]);
  return framePath;
}

async function extractPdfText(pdfPath) {
  const { stdout } = await execFileAsync('pdftotext', ['-l', '5', pdfPath, '-']);
  return stdout.slice(0, 8000);
}

async function askClaude(prompt, imagePath = null, sessionId = null, isNew = false, userId = 0) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print', '--output-format', 'stream-json', '--verbose',
      '--model', getModel(userId),
    ];

    // Add session arguments if provided
    if (sessionId) {
      if (isNew) {
        args.push('--session-id', sessionId);
      } else {
        args.push('--resume', sessionId);
      }
    }

    args.push('--system-prompt', SYSTEM_PROMPT);

    // Prepend image path — Claude Code's Read tool handles images natively
    const fullPrompt = imagePath
      ? `Image file to analyze: ${imagePath}\n\n${prompt}`
      : prompt;
    const proc = spawn(CLAUDE_CLI, args, { cwd: WORKING_DIR, stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    let stderr = '';
    let buffer = '';

    proc.stdout.on('data', d => {
      buffer += d.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'assistant' && evt.message?.content) {
            for (const block of evt.message.content) {
              if (block.type === 'text') {
                output += block.text;
              }
            }
          }
        } catch {}
      }
    });

    proc.stderr.on('data', d => stderr += d.toString());
    proc.stdin.write(fullPrompt + '\n');
    proc.stdin.end();

    // 5 min timeout — GSAP pages take time
    const timeout = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Timeout after 5min')); }, 300000);

    proc.on('close', code => {
      clearTimeout(timeout);
      if (output.trim()) resolve(output.trim());
      else reject(new Error(`Claude exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

// Session state now managed by sessions.mjs (sqlite-backed)

bot.command('start', ctx => ctx.reply(
  '🕸️ *webbs* — web designer bot\n\nTell me what to build.\n\nExamples:\n• Dark landing page for auction app\n• Pricing section with 3 tiers\n• Bid button with pulse animation\n• Glassmorphism login form\n\n/clear — reset',
  { parse_mode: 'Markdown' }
));

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

bot.command('clear', ctx => {
  const cleared = clearSession(ctx.from?.id);
  ctx.reply(cleared ? '🕸️ Session cleared.' : '🕸️ No session to clear.');
});

async function handleDesignRequest(ctx, msg, imagePath = null) {
  const userId = ctx.from.id;
  const cleanupFiles = imagePath ? [imagePath] : [];

  try {
    // Get or create persistent session
    const { sessionId, isNew } = getOrCreateSession(userId);

    let fullPrompt = msg;

    // Get Kobus preferences + shared knowledge from Circus (non-blocking, non-fatal)
    let circusContext = '';
    try {
      const prefs = await buildPreferenceContext();
      if (prefs) circusContext = `\nUser preferences:\n${prefs}\n`;
    } catch {}
    try {
      const shared = await getRelevantSharedKnowledge(msg.slice(0, 500));
      if (shared) circusContext += `\n## Shared Knowledge from Fleet\n${shared}\n`;
    } catch {}

    // Add memory context from AI-IQ (non-blocking, non-fatal)
    try {
      const memCtx = await buildMemoryContext(msg);
      if (memCtx) circusContext += memCtx;
    } catch {}

    // Add Circus context if available
    if (circusContext) fullPrompt = circusContext + '\n' + fullPrompt;

    const thinking = await ctx.reply(imagePath ? '🕸️ reading image...' : '🕸️ spinning...');
    let dots = 0;
    // Keep typing indicator alive (Telegram clears it after 5s)
    const typingInterval = setInterval(() => {
      ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
    }, 4000);
    const heartbeat = setInterval(() => {
      dots = (dots + 1) % 4;
      ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `🕸️ spinning${'.'.repeat(dots + 1)}`).catch(() => {});
    }, 15000);

    try {
      const reply = await askClaude(fullPrompt, imagePath, sessionId, isNew, userId);
      clearInterval(typingInterval);
      clearInterval(heartbeat);

      // Auto-store conversation in AI-IQ (non-blocking)
      autoStoreConversation(msg, reply).catch(() => {});

      // Share significant design learnings to Circus fleet (non-blocking)
      try {
        const { shouldShare, category, domain, confidence, content } = shouldShareKnowledge(msg, reply);
        if (shouldShare) {
          writeSharedKnowledge(content, category, confidence, domain, 'webbs').catch(() => {});
        }
      } catch {}

      const htmlMatch = reply.match(/```(?:html|HTML)?\n([\s\S]+?)```/);
      const short = reply.length > 4000
        ? reply.replace(/```[\s\S]*?```/g, '[see attached file]').slice(0, 4000)
        : reply;

      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, short, { parse_mode: 'Markdown' })
        .catch(() => ctx.api.editMessageText(ctx.chat.id, thinking.message_id, short.replace(/[*_`[\]]/g, '')));

      if (htmlMatch) {
        const tmp = `/tmp/webbs-${Date.now()}.html`;
        await writeFile(tmp, htmlMatch[1]);
        await ctx.replyWithDocument(new InputFile(tmp, 'webbs.html'));
        unlink(tmp).catch(() => {});
      }

    } catch (err) {
      clearInterval(typingInterval);
      clearInterval(heartbeat);
      console.error(err);
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `❌ ${err.message}`).catch(() => {});
    }
  } finally {
    // Cleanup uploaded files
    for (const f of cleanupFiles) unlink(f).catch(() => {});
    // Always process next queued message for this user
    await processNext(userId);
  }
}

// Helper: queue or dispatch
function dispatch(ctx, msg, imagePath = null) {
  if (!isAuthorized(ctx)) return;
  if (ctx.message.date * 1000 < BOT_START - 30000) return;
  const userId = ctx.from.id;
  if (busyUsers.has(userId)) {
    const queue = userQueues.get(userId) || [];
    if (queue.length >= 3) return ctx.reply('🕸️ Queue full (3 pending). Wait for current job.');
    queue.push({ ctx, msg, imagePath });
    userQueues.set(userId, queue);
    return ctx.reply(`🕸️ Queued (#${queue.length}). Will process after current job.`);
  }
  busyUsers.add(userId);
  return handleDesignRequest(ctx, msg, imagePath);
}

bot.on('message:text', async ctx => {
  if (!isAuthorized(ctx)) return;
  const msg = ctx.message.text;
  if (msg.startsWith('/')) return;
  dispatch(ctx, msg);
});

// Photos: download + pass as image to Claude
bot.on('message:photo', async ctx => {
  if (!isAuthorized(ctx)) return;
  if (ctx.message.date * 1000 < BOT_START - 30000) return;
  try {
    const photo = ctx.message.photo.at(-1); // largest size
    const { path: imgPath } = await downloadTelegramFile(photo.file_id);
    const caption = ctx.message.caption || 'Analyze this design/screenshot. What would you build or improve?';
    dispatch(ctx, caption, imgPath);
  } catch (e) {
    ctx.reply(`❌ Failed to download image: ${e.message}`);
  }
});

// Documents: route by type — image, video, PDF, text, or reject
bot.on('message:document', async ctx => {
  if (!isAuthorized(ctx)) return;
  if (ctx.message.date * 1000 < BOT_START - 30000) return;
  const doc = ctx.message.document;
  const caption = ctx.message.caption || '';
  let filePath = null;
  let extraCleanup = null;
  try {
    const dl = await downloadTelegramFile(doc.file_id);
    filePath = dl.path;
    const ext = dl.ext;

    if (IMAGE_EXTS.has(ext)) {
      const msg = caption || 'Analyze this design/screenshot. What would you build or improve?';
      dispatch(ctx, msg, filePath);
      filePath = null; // dispatch owns cleanup

    } else if (VIDEO_EXTS.has(ext)) {
      await ctx.reply('🕸️ Extracting frame...');
      const framePath = await extractVideoFrame(filePath);
      extraCleanup = framePath;
      const msg = caption || 'Analyze this UI/design from the video frame. What would you build?';
      dispatch(ctx, msg, framePath);
      framePath = null; // dispatch owns cleanup

    } else if (PDF_EXTS.has(ext)) {
      const text = await extractPdfText(filePath);
      if (!text.trim()) return ctx.reply('🕸️ PDF has no extractable text (scanned image?).');
      const msg = caption
        ? `${caption}\n\nPDF contents (${doc.file_name}):\n${text}`
        : `Design a web page or component based on this PDF content (${doc.file_name}):\n${text}`;
      dispatch(ctx, msg);

    } else if (TEXT_EXTS.has(ext)) {
      const contents = await readFile(filePath, 'utf8');
      const msg = caption
        ? `${caption}\n\nFile contents (${doc.file_name}):\n\`\`\`\n${contents.slice(0, 8000)}\n\`\`\``
        : `Review and improve this code (${doc.file_name}):\n\`\`\`\n${contents.slice(0, 8000)}\n\`\`\``;
      dispatch(ctx, msg);

    } else {
      ctx.reply(`🕸️ Unsupported: .${ext}\nSupported: images, video, PDF, HTML/CSS/JS/TS/JSON`);
    }
  } catch (e) {
    ctx.reply(`❌ Failed to process file: ${e.message}`);
  } finally {
    if (filePath) unlink(filePath).catch(() => {});
    if (extraCleanup) unlink(extraCleanup).catch(() => {});
  }
});

bot.start();
console.log('🕸️ webbs bot started');

// Register task handlers unconditionally — no token needed
registerTaskHandler('design', async (payload) => {
  console.log('[Task] design task received:', payload.description?.slice(0, 100));
  return { status: 'acknowledged' };
}, { useWorker: true });
registerTaskHandler('notify', async (payload) => {
  console.log('[Task] notify task received:', payload.message?.slice(0, 100));
  return { status: 'ok' };
});
console.log('[Circus] Task handlers registered');

// Register with Circus (non-fatal)
circusRegister('webbs', 'builder')
  .then(token => {
    if (token) {
      // Join troupe for scoped memory sharing
      joinTroupe('telegram-bots').catch(e => console.error('[Circus] troupe join failed:', e.message));

      circusJoinRooms(['memory-commons', 'engineering']);
      startHeartbeat();
      startTaskInboxPoller(60_000);
    }
  })
  .catch(e => console.log('[circus] registration skipped:', e.message));
enableAutoReconnect('webbs', 'builder');

// Task injection server — router POSTs here instead of Telegram self-message
const WEBBS_TASK_PORT = 4206;
const webbsTaskServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/task') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message, chatId } = JSON.parse(body);
      if (!message || !chatId) { res.writeHead(400); res.end('missing fields'); return; }
      res.writeHead(200); res.end('ok');
      console.log(`[TaskServer] Received task: "${message.substring(0, 60)}"`);
      const syntheticCtx = {
        chat: { id: chatId },
        from: { id: ALLOWED_USER_ID || chatId },
        message: { text: message, message_id: Date.now(), date: Math.floor(Date.now() / 1000) },
        reply: (text) => bot.api.sendMessage(chatId, text),
        replyWithChatAction: () => Promise.resolve(),
      };
      // Call dispatch directly — bypassing Telegram routing
      handleDesignRequest(syntheticCtx, message);
    } catch (err) {
      console.error('[TaskServer] Error:', err.message);
      res.writeHead(500); res.end(err.message);
    }
  });
});
webbsTaskServer.listen(WEBBS_TASK_PORT, '127.0.0.1', () => {
  console.log(`✓ Webbs task server on 127.0.0.1:${WEBBS_TASK_PORT}`);
});
