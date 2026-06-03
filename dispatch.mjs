/**
 * dispatch.mjs — Star+Ephemeral sub-bot dispatcher
 *
 * Import this in any bot to spawn ephemeral Claude workers that share
 * the main bot's performer workspace (star topology). Workers are
 * fire-and-forget processes — they spawn, do the task, exit.
 *
 * Usage:
 *   import { dispatch, dispatchAll } from '/root/bot-circus/dispatch.mjs';
 *
 *   // Single sub-task:
 *   const result = await dispatch('octo', 'Summarise the last 10 Circus events');
 *
 *   // Parallel sub-tasks (fan-out):
 *   const results = await dispatchAll('octo', [
 *     'Analyse memory usage',
 *     'Check Circus heartbeats',
 *     'Scan 007 recon logs',
 *   ]);
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

const PERFORMERS_DIR = '/root/bot-circus/performers';
const MAX_WORKERS = 10;
const DEFAULT_TIMEOUT_MS = 120_000;
const AGENT_PACK_TIMEOUT_MS = 240_000; // Multi-agent packs need more time (flattened 5+ perspectives)
const BOT_QUEUE_LIMIT = 5;

// Path traversal validation
function validateBotPath(absPath, performersDir) {
  const resolvedPerformers = resolvePath(performersDir);
  const resolvedBot = resolvePath(absPath);
  if (!resolvedBot.startsWith(resolvedPerformers + '/')) {
    throw new Error(`Path traversal attempt: ${absPath} outside ${performersDir}`);
  }
  return resolvedBot;
}

// Singleton pool — shared across all dispatch calls in the same process
const _active = new Map();   // workerId → { proc, timer }
const _queue  = [];          // { botId, workspacePath, message, resolve, reject, queuedAt }

function _processQueue() {
  while (_queue.length > 0 && _active.size < MAX_WORKERS) {
    // Fair scheduling: bots with fewer active workers first
    const botCounts = new Map();
    for (const { botId } of _active.values()) {
      botCounts.set(botId, (botCounts.get(botId) || 0) + 1);
    }
    _queue.sort((a, b) => {
      const diff = (botCounts.get(a.botId) || 0) - (botCounts.get(b.botId) || 0);
      return diff !== 0 ? diff : a.queuedAt - b.queuedAt;
    });

    const task = _queue.shift();
    _spawnWorker(task);
  }
}

function _spawnWorker({ botId, workspacePath, message, resolve, reject }) {
  const id = `${botId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const abs = validateBotPath(resolvePath(workspacePath), PERFORMERS_DIR);

  let stdout = '';
  let stderr = '';

  // Read SOUL.md as system prompt context if present
  let soulContent = '';
  try {
    const soulPath = join(abs, 'SOUL.md');
    if (existsSync(soulPath)) {
      // Agent packs have large multi-perspective prompts, allow up to 10K
      const maxLen = botId.startsWith('agent-') ? 10000 : 2000;
      soulContent = readFileSync(soulPath, 'utf8').slice(0, maxLen);
    }
  } catch { /* non-fatal */ }

  const args = [
    '--print',
    '--output-format', 'text',
    '--model', 'claude-sonnet-4-6',
  ];
  if (soulContent) {
    args.push('--system-prompt', soulContent);
  }

  // cwd sets the working directory so MEMORY.md / CLAUDE.md are visible
  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: abs,
  });

  // Use longer timeout for agent-* packs (multi-perspective analysis)
  const timeout = botId.startsWith('agent-') ? AGENT_PACK_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
    _active.delete(id);
    reject(new Error(`[dispatch] Worker timeout (${timeout}ms) — botId: ${botId}`));
    _processQueue();
  }, timeout);

  _active.set(id, { botId, proc, timer });

  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('error', err => {
    clearTimeout(timer);
    _active.delete(id);
    reject(err);
    _processQueue();
  });

  proc.on('close', code => {
    clearTimeout(timer);
    _active.delete(id);
    if (code === 0) {
      resolve(stdout.trim());
    } else {
      reject(new Error(`[dispatch] Worker exited ${code}: ${stderr.slice(0, 200)}`));
    }
    _processQueue();
  });

  proc.stdin.write(message + '\n');
  proc.stdin.end();
}

/**
 * Ensure the performer workspace exists. Creates a minimal one if missing.
 */
function _ensureWorkspace(botId) {
  const dir = validateBotPath(join(PERFORMERS_DIR, botId), PERFORMERS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(join(dir, 'memory'), { recursive: true });
    writeFileSync(join(dir, 'SOUL.md'), `# ${botId}\n\nYou are a sub-worker for ${botId}. Complete the assigned task and return structured output.\n`);
    writeFileSync(join(dir, 'MEMORY.md'), `# ${botId} Worker Memory\n\n`);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ id: botId, sub_bot: true, created_at: new Date().toISOString() }, null, 2));
  }
  return dir;
}

/**
 * Dispatch a single sub-task to an ephemeral worker in the bot's performer workspace.
 *
 * @param {string} botId   - Bot ID (matches performers/{botId}/)
 * @param {string} message - Task prompt for Claude worker
 * @param {Object} opts    - { timeoutMs }
 * @returns {Promise<string>} Claude output
 */
export function dispatch(botId, message, opts = {}) {
  const workspacePath = _ensureWorkspace(botId);
  return new Promise((resolve, reject) => {
    // Check per-bot queue depth limit
    const botQueueDepth = _queue.filter(t => t.botId === botId).length;
    if (botQueueDepth >= BOT_QUEUE_LIMIT) {
      reject(new Error(`Queue full for bot ${botId} (${BOT_QUEUE_LIMIT} tasks pending)`));
      return;
    }
    _queue.push({ botId, workspacePath, message, resolve, reject, queuedAt: Date.now() });
    _processQueue();
  });
}

/**
 * Fan-out: dispatch multiple tasks in parallel, wait for all.
 * Respects pool limit — excess tasks queue until a slot opens.
 *
 * @param {string}   botId    - Bot ID
 * @param {string[]} messages - Array of task prompts
 * @returns {Promise<Array<{ok: boolean, result?: string, error?: string}>>}
 */
export async function dispatchAll(botId, messages) {
  return Promise.all(
    messages.map(async msg => {
      try {
        const result = await dispatch(botId, msg);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })
  );
}

/**
 * Pool stats — useful for health checks.
 */
export function poolStats() {
  const byBot = new Map();
  for (const { botId } of _active.values()) {
    byBot.set(botId, (byBot.get(botId) || 0) + 1);
  }
  return {
    active: _active.size,
    queued: _queue.length,
    maxWorkers: MAX_WORKERS,
    activeByBot: Object.fromEntries(byBot),
  };
}
