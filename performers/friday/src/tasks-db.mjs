#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = '/root/bot-circus/performers/friday/data/tasks.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

let db;

/**
 * Initialize database and create schema
 */
export function initDb() {
  if (db) return; // Already initialized

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      subject TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      result TEXT,
      error TEXT,
      parent_task_id INTEGER,
      reply_to_message_id INTEGER,
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_subject_status ON tasks(subject, status);
    CREATE INDEX IF NOT EXISTS idx_user_created ON tasks(user_id, created_at DESC);
  `);

  // Create subject_context table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subject_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      fact TEXT NOT NULL,
      source_task_id INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_task_id) REFERENCES tasks(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_subject ON subject_context(subject);
  `);

  console.log('[TasksDB] Initialized at', DB_PATH);
}

/**
 * Create a new task
 * @param {object} params
 * @param {number} params.userId - Telegram user ID
 * @param {number} params.chatId - Telegram chat ID
 * @param {string|null} params.subject - Subject/project name
 * @param {string} params.prompt - User prompt
 * @param {number} params.priority - Priority (default 0)
 * @param {number} params.replyToMessageId - Telegram message ID to reply to
 * @param {number|null} params.parentTaskId - Parent task ID if this is a subtask
 * @returns {number} Task ID
 */
export function createTask({ userId, chatId, subject = null, prompt, priority = 0, replyToMessageId, parentTaskId = null }) {
  const stmt = db.prepare(`
    INSERT INTO tasks (user_id, chat_id, subject, prompt, priority, created_at, reply_to_message_id, parent_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(userId, chatId, subject, prompt, priority, Date.now(), replyToMessageId, parentTaskId);
  return result.lastInsertRowid;
}

/**
 * Update task status and metadata
 * @param {number} taskId - Task ID
 * @param {string} status - New status (queued|running|done|failed|cancelled)
 * @param {object} options - Optional fields
 * @param {string} options.result - Result text
 * @param {string} options.error - Error text
 * @param {number} options.startedAt - Started timestamp
 * @param {number} options.finishedAt - Finished timestamp
 */
export function updateTaskStatus(taskId, status, { result, error, startedAt, finishedAt } = {}) {
  const updates = ['status = ?'];
  const values = [status];

  if (result !== undefined) {
    updates.push('result = ?');
    values.push(result);
  }
  if (error !== undefined) {
    updates.push('error = ?');
    values.push(error);
  }
  if (startedAt !== undefined) {
    updates.push('started_at = ?');
    values.push(startedAt);
  }
  if (finishedAt !== undefined) {
    updates.push('finished_at = ?');
    values.push(finishedAt);
  }

  values.push(taskId);

  const stmt = db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

/**
 * Get task by ID
 * @param {number} taskId
 * @returns {object|null}
 */
export function getTask(taskId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

/**
 * Get queued tasks by priority (highest first)
 * @param {number} limit - Max tasks to return
 * @returns {Array}
 */
export function getQueuedTasks(limit = 50) {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'queued'
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Get all running tasks
 * @returns {Array}
 */
export function getRunningTasks() {
  return db.prepare("SELECT * FROM tasks WHERE status = 'running'").all();
}

/**
 * Get tasks by subject
 * @param {string} subject
 * @param {number} limit
 * @returns {Array}
 */
export function getTasksBySubject(subject, limit = 20) {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE subject = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(subject, limit);
}

/**
 * Get recent tasks by user
 * @param {number} userId
 * @param {number} limit
 * @returns {Array}
 */
export function getRecentTasksByUser(userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

/**
 * Get subjects summary (for /topics)
 * @returns {Array<{subject, total, running, queued, done}>}
 */
export function getSubjectsSummary() {
  const rows = db.prepare(`
    SELECT
      subject,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
    FROM tasks
    WHERE subject IS NOT NULL
    GROUP BY subject
    ORDER BY total DESC
  `).all();

  return rows;
}

/**
 * Add a fact to subject context
 * @param {string} subject
 * @param {string} fact
 * @param {number} sourceTaskId
 */
export function addSubjectFact(subject, fact, sourceTaskId) {
  db.prepare(`
    INSERT INTO subject_context (subject, fact, source_task_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(subject, fact, sourceTaskId, Date.now());
}

/**
 * Get subject context (recent facts)
 * @param {string} subject
 * @param {number} limit
 * @returns {Array<string>} Array of fact strings
 */
export function getSubjectContext(subject, limit = 10) {
  const rows = db.prepare(`
    SELECT fact FROM subject_context
    WHERE subject = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(subject, limit);

  return rows.map(r => r.fact);
}

/**
 * Clean up stale running tasks on startup
 * Mark any tasks still marked 'running' as failed (bot restarted)
 */
export function cleanupOnStartup() {
  const result = db.prepare(`
    UPDATE tasks
    SET status = 'failed', error = 'Bot restarted', finished_at = ?
    WHERE status = 'running'
  `).run(Date.now());

  if (result.changes > 0) {
    console.log(`[TasksDB] Marked ${result.changes} stale running tasks as failed`);
  }
}

/**
 * Count queued + running tasks for a user (rate limiting)
 * @param {number} userId
 * @returns {number}
 */
export function countActiveTasks(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE user_id = ? AND status IN ('queued', 'running')
  `).get(userId);

  return row.count;
}

// Graceful shutdown
process.on('SIGINT', () => db?.close());
process.on('SIGTERM', () => db?.close());
