#!/usr/bin/env node

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = '/root/007-bot/data/sessions.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    chat_id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0
  )
`);

// Create index
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_last_used ON sessions(last_used)
`);

/**
 * Get existing session or create new one for chat
 * @param {number} chatId - Telegram chat ID
 * @returns {object} - {sessionId, isNew}
 */
export function getOrCreateSession(chatId) {
  const now = Date.now();

  // Try to get existing session
  const existing = db.prepare('SELECT session_id FROM sessions WHERE chat_id = ?').get(chatId);

  if (existing) {
    // Update last_used and increment message count
    db.prepare('UPDATE sessions SET last_used = ?, message_count = message_count + 1 WHERE chat_id = ?')
      .run(now, chatId);
    return { sessionId: existing.session_id, isNew: false };
  }

  // Create new session
  const sessionId = randomUUID();
  db.prepare('INSERT INTO sessions (chat_id, session_id, created_at, last_used, message_count) VALUES (?, ?, ?, ?, ?)')
    .run(chatId, sessionId, now, now, 1);

  console.log(`[007] Created new session ${sessionId} for chat ${chatId}`);
  return { sessionId, isNew: true };
}

/**
 * Clear session for chat
 * @param {number} chatId - Telegram chat ID
 */
export function clearSession(chatId) {
  const result = db.prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId);
  if (result.changes > 0) {
    console.log(`[007] Cleared session for chat ${chatId}`);
  }
}

/**
 * Get session info for chat
 * @param {number} chatId - Telegram chat ID
 * @returns {object|null} - Session info or null
 */
export function getSessionInfo(chatId) {
  const row = db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get(chatId);
  if (!row) return null;

  const now = Date.now();
  const age = Math.floor((now - row.created_at) / 1000 / 60); // minutes
  const lastUsed = Math.floor((now - row.last_used) / 1000 / 60); // minutes ago

  return {
    sessionId: row.session_id,
    age,
    lastUsed,
    messageCount: row.message_count
  };
}

/**
 * Clean up expired sessions (older than specified hours)
 * @param {number} hours - Age threshold in hours (default: 24)
 * @returns {number} - Number of sessions deleted
 */
export function cleanExpiredSessions(hours = 24) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  const result = db.prepare('DELETE FROM sessions WHERE last_used < ?').run(cutoff);

  if (result.changes > 0) {
    console.log(`[007] Cleaned ${result.changes} expired sessions (older than ${hours}h)`);
  }

  return result.changes;
}

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

export default {
  getOrCreateSession,
  clearSession,
  getSessionInfo,
  cleanExpiredSessions
};
