#!/usr/bin/env node

import Database from 'better-sqlite3';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const execFileAsync = promisify(execFile);

const DB_PATH = '/root/claude-telegram-bot/data/tasks.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create tasks table
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    command TEXT NOT NULL,
    interval_ms INTEGER NOT NULL,
    last_run INTEGER,
    next_run INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    chat_id INTEGER NOT NULL,
    last_output TEXT,
    created_at INTEGER NOT NULL
  )
`);

// Create index
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_next_run ON tasks(next_run, enabled)
`);

// Store for active timers
const activeTimers = new Map();

/**
 * Parse interval string to milliseconds
 * @param {string} interval - e.g., "5m", "1h", "30s"
 * @returns {number} - Milliseconds
 */
export function parseInterval(interval) {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error('Invalid interval format. Use: 5m, 1h, 30s, 2d');
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

/**
 * Add a new task
 * @param {string} name - Task name
 * @param {string} command - Shell command to execute
 * @param {string} interval - Interval (e.g., "5m")
 * @param {number} chatId - Telegram chat ID to send results
 * @returns {{ok: boolean, error?: string, taskId?: number}}
 */
export function addTask(name, command, interval, chatId) {
  try {
    const intervalMs = parseInterval(interval);
    const now = Date.now();
    const nextRun = now + intervalMs;

    const result = db.prepare(`
      INSERT INTO tasks (name, command, interval_ms, next_run, chat_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, command, intervalMs, nextRun, chatId, now);

    console.log(`[Tasks] Added: ${name} (every ${interval})`);
    return { ok: true, taskId: result.lastInsertRowid };
  } catch (error) {
    console.error('[Tasks] Add failed:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Remove a task
 * @param {string} name - Task name
 * @returns {{ok: boolean, error?: string}}
 */
export function removeTask(name) {
  try {
    const result = db.prepare('DELETE FROM tasks WHERE name = ?').run(name);

    // Clear timer if active
    if (activeTimers.has(name)) {
      clearTimeout(activeTimers.get(name));
      activeTimers.delete(name);
    }

    if (result.changes === 0) {
      return { ok: false, error: 'Task not found' };
    }

    console.log(`[Tasks] Removed: ${name}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Enable/disable a task
 * @param {string} name - Task name
 * @param {boolean} enabled - Enable or disable
 * @returns {{ok: boolean, error?: string}}
 */
export function toggleTask(name, enabled) {
  try {
    const result = db.prepare('UPDATE tasks SET enabled = ? WHERE name = ?')
      .run(enabled ? 1 : 0, name);

    if (result.changes === 0) {
      return { ok: false, error: 'Task not found' };
    }

    if (!enabled && activeTimers.has(name)) {
      clearTimeout(activeTimers.get(name));
      activeTimers.delete(name);
    }

    console.log(`[Tasks] ${enabled ? 'Enabled' : 'Disabled'}: ${name}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * List all tasks
 * @param {boolean} enabledOnly - Only show enabled tasks
 * @returns {Array} - Task list
 */
export function listTasks(enabledOnly = false) {
  const query = enabledOnly
    ? 'SELECT * FROM tasks WHERE enabled = 1 ORDER BY next_run'
    : 'SELECT * FROM tasks ORDER BY created_at DESC';

  return db.prepare(query).all();
}

/**
 * Get single task
 * @param {string} name - Task name
 * @returns {object|null} - Task or null
 */
export function getTask(name) {
  return db.prepare('SELECT * FROM tasks WHERE name = ?').get(name);
}

/**
 * Execute a task
 * @param {object} task - Task object from DB
 * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
 */
async function executeTask(task) {
  try {
    // Use shell mode for commands with pipes/redirects, execFile for simple commands
    const needsShell = /[|&;<>`$(){}]/.test(task.command);

    const { stdout, stderr } = needsShell
      ? await execFileAsync('bash', ['-c', task.command], {
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        })
      : await execFileAsync(task.command.split(/\s+/)[0], task.command.split(/\s+/).slice(1), {
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        });

    const output = (stdout + stderr).trim();
    console.log(`[Tasks] ${task.name} executed: ${output.substring(0, 100)}`);

    return { ok: true, output };
  } catch (error) {
    console.error(`[Tasks] ${task.name} failed:`, error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Update task after run
 * @param {number} taskId - Task ID
 * @param {string} output - Last output
 */
function updateTaskAfterRun(taskId, output) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;

  const now = Date.now();
  const nextRun = now + task.interval_ms;

  db.prepare(`
    UPDATE tasks
    SET last_run = ?, next_run = ?, last_output = ?
    WHERE id = ?
  `).run(now, nextRun, output, taskId);
}

/**
 * Check if output changed from last run
 * @param {string} currentOutput - Current output
 * @param {string} lastOutput - Last output
 * @returns {boolean} - True if changed
 */
function hasOutputChanged(currentOutput, lastOutput) {
  if (!lastOutput) return true; // First run
  return currentOutput !== lastOutput;
}

/**
 * Start task scheduler
 * @param {Function} sendToTelegram - Callback to send message to Telegram (chatId, message)
 * @param {Function} alertCallback - Optional callback to check and send alerts (output, exitCode, chatId)
 */
export function startScheduler(sendToTelegram, alertCallback = null) {
  console.log('[Tasks] Starting scheduler...');

  // Check for due tasks every 10 seconds
  const checkInterval = setInterval(() => {
    const now = Date.now();
    const dueTasks = db.prepare('SELECT * FROM tasks WHERE enabled = 1 AND next_run <= ?')
      .all(now);

    for (const task of dueTasks) {
      // Execute task
      executeTask(task).then(result => {
        const output = result.ok ? result.output : `Error: ${result.error}`;
        const exitCode = result.ok ? 0 : 1;

        // Check if we should send proactive alert
        if (alertCallback) {
          try {
            alertCallback(output, exitCode, task.chat_id, task.name);
          } catch (alertErr) {
            console.error('[Tasks] Alert callback failed:', alertErr.message);
          }
        }

        // Check if output changed
        if (hasOutputChanged(output, task.last_output)) {
          // Send to Telegram only if output changed
          const message = `🤖 *Task: ${task.name}*\n\n\`\`\`\n${output.substring(0, 3000)}\n\`\`\``;
          sendToTelegram(task.chat_id, message).catch(err => {
            console.error(`[Tasks] Failed to send result to Telegram:`, err.message);
          });
        } else {
          console.log(`[Tasks] ${task.name} output unchanged, skipping notification`);
        }

        // Update task
        updateTaskAfterRun(task.id, output);
      }).catch(err => {
        console.error(`[Tasks] Unhandled task error (${task.name}):`, err.message);
      });
    }
  }, 10000); // Check every 10 seconds

  // Store interval for cleanup
  activeTimers.set('__scheduler__', checkInterval);

  console.log('[Tasks] Scheduler started');
}

/**
 * Stop scheduler
 */
export function stopScheduler() {
  if (activeTimers.has('__scheduler__')) {
    clearInterval(activeTimers.get('__scheduler__'));
    activeTimers.delete('__scheduler__');
    console.log('[Tasks] Scheduler stopped');
  }
}

/**
 * Add built-in heartbeat task
 * @param {number} chatId - Telegram chat ID
 */
export function addHeartbeatTask(chatId) {
  const existing = getTask('heartbeat');
  if (existing) {
    console.log('[Tasks] Heartbeat task already exists');
    return;
  }

  addTask(
    'heartbeat',
    '/root/claude-telegram-bot/heartbeat.mjs',
    '30m',
    chatId
  );

  console.log('[Tasks] Heartbeat task added (every 30 minutes)');
}

// Graceful shutdown
process.on('SIGINT', () => {
  stopScheduler();
  db.close();
});

process.on('SIGTERM', () => {
  stopScheduler();
  db.close();
});

export default {
  parseInterval,
  addTask,
  removeTask,
  toggleTask,
  listTasks,
  getTask,
  startScheduler,
  stopScheduler,
  addHeartbeatTask
};
