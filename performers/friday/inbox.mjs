#!/usr/bin/env node
/**
 * Unified Inbox - SQLite-backed message storage for WhatsApp, Email, and Outbound
 *
 * Stores all incoming and outgoing messages in a single database with:
 * - WAL mode for concurrent access from multiple PM2 processes
 * - Full-text search capability
 * - Source filtering (whatsapp, email, outbound)
 * - Read/unread tracking
 * - Priority levels
 * - Automatic cleanup of old messages
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure data directory exists
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, 'claw-inbox.db');

// Initialize database with WAL mode and busy timeout
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Create messages table
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    from_name TEXT,
    from_address TEXT,
    to_address TEXT,
    chat_name TEXT,
    chat_id TEXT,
    subject TEXT,
    body TEXT,
    media_path TEXT,
    media_type TEXT,
    timestamp INTEGER NOT NULL,
    is_read INTEGER DEFAULT 0,
    is_group INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'normal',
    created_at INTEGER DEFAULT (unixepoch())
  )
`);

// Create indexes for efficient queries
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
  CREATE INDEX IF NOT EXISTS idx_messages_from_address ON messages(from_address);
`);

// Prepared statements for better performance
const stmts = {
  addMessage: db.prepare(`
    INSERT INTO messages (
      source, direction, from_name, from_address, to_address,
      chat_name, chat_id, subject, body, media_path, media_type,
      timestamp, is_read, is_group, priority
    ) VALUES (
      @source, @direction, @from_name, @from_address, @to_address,
      @chat_name, @chat_id, @subject, @body, @media_path, @media_type,
      @timestamp, @is_read, @is_group, @priority
    )
  `),

  markRead: db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?'),

  markAllRead: db.prepare('UPDATE messages SET is_read = 1 WHERE source = ?'),

  markAllReadGlobal: db.prepare('UPDATE messages SET is_read = 1'),

  getUnread: db.prepare(`
    SELECT * FROM messages
    WHERE is_read = 0
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  getUnreadBySource: db.prepare(`
    SELECT * FROM messages
    WHERE is_read = 0 AND source = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  getRecent: db.prepare(`
    SELECT * FROM messages
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  getRecentBySource: db.prepare(`
    SELECT * FROM messages
    WHERE source = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  getBySource: db.prepare(`
    SELECT * FROM messages
    WHERE source = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  search: db.prepare(`
    SELECT * FROM messages
    WHERE body LIKE ? OR subject LIKE ? OR from_name LIKE ? OR from_address LIKE ?
    ORDER BY timestamp DESC
    LIMIT ?
  `),

  getStats: db.prepare(`
    SELECT
      source,
      COUNT(*) as total,
      SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
      SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) as incoming,
      SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) as outgoing
    FROM messages
    GROUP BY source
  `),

  cleanupOld: db.prepare(`
    DELETE FROM messages
    WHERE timestamp < ?
  `)
};

/**
 * Add a message to the inbox
 * @param {Object} message - Message object
 * @param {string} message.source - Source: 'whatsapp', 'email', 'outbound'
 * @param {string} [message.direction='in'] - Direction: 'in' or 'out'
 * @param {string} [message.from_name] - Sender name
 * @param {string} [message.from_address] - Sender address/number
 * @param {string} [message.to_address] - Recipient address/number
 * @param {string} [message.chat_name] - Chat/group name
 * @param {string} [message.chat_id] - Chat/group ID
 * @param {string} [message.subject] - Email subject or message title
 * @param {string} [message.body] - Message body
 * @param {string} [message.media_path] - Path to media file
 * @param {string} [message.media_type] - Media MIME type
 * @param {number} [message.timestamp] - Unix timestamp (default: now)
 * @param {boolean} [message.is_read=false] - Read status
 * @param {boolean} [message.is_group=false] - Group message flag
 * @param {string} [message.priority='normal'] - Priority: 'low', 'normal', 'high'
 * @returns {number} - Inserted message ID
 */
export function addMessage(message) {
  const data = {
    source: message.source,
    direction: message.direction || 'in',
    from_name: message.from_name || null,
    from_address: message.from_address || null,
    to_address: message.to_address || null,
    chat_name: message.chat_name || null,
    chat_id: message.chat_id || null,
    subject: message.subject || null,
    body: message.body || null,
    media_path: message.media_path || null,
    media_type: message.media_type || null,
    timestamp: message.timestamp || Math.floor(Date.now() / 1000),
    is_read: message.is_read ? 1 : 0,
    is_group: message.is_group ? 1 : 0,
    priority: message.priority || 'normal'
  };

  const result = stmts.addMessage.run(data);
  return result.lastInsertRowid;
}

/**
 * Get unread messages
 * @param {string} [source] - Filter by source (optional)
 * @param {number} [limit=50] - Maximum number of messages
 * @returns {Array} - Array of message objects
 */
export function getUnread(source = null, limit = 50) {
  if (source) {
    return stmts.getUnreadBySource.all(source, limit);
  }
  return stmts.getUnread.all(limit);
}

/**
 * Mark a message as read
 * @param {number} id - Message ID
 * @returns {boolean} - Success status
 */
export function markRead(id) {
  const result = stmts.markRead.run(id);
  return result.changes > 0;
}

/**
 * Mark all messages as read
 * @param {string} [source] - Filter by source (optional)
 * @returns {number} - Number of messages marked as read
 */
export function markAllRead(source = null) {
  if (source) {
    const result = stmts.markAllRead.run(source);
    return result.changes;
  }
  const result = stmts.markAllReadGlobal.run();
  return result.changes;
}

/**
 * Search messages by content
 * @param {string} query - Search query
 * @param {number} [limit=20] - Maximum number of results
 * @returns {Array} - Array of matching message objects
 */
export function search(query, limit = 20) {
  const pattern = `%${query}%`;
  return stmts.search.all(pattern, pattern, pattern, pattern, limit);
}

/**
 * Get recent messages
 * @param {string} [source] - Filter by source (optional)
 * @param {number} [limit=20] - Maximum number of messages
 * @returns {Array} - Array of message objects
 */
export function getRecent(source = null, limit = 20) {
  if (source) {
    return stmts.getRecentBySource.all(source, limit);
  }
  return stmts.getRecent.all(limit);
}

/**
 * Get messages by source
 * @param {string} source - Source: 'whatsapp', 'email', 'outbound'
 * @param {number} [limit=50] - Maximum number of messages
 * @returns {Array} - Array of message objects
 */
export function getBySource(source, limit = 50) {
  return stmts.getBySource.all(source, limit);
}

/**
 * Get statistics by source
 * @returns {Array} - Array of stats objects with: source, total, unread, incoming, outgoing
 */
export function getStats() {
  return stmts.getStats.all();
}

/**
 * Clean up old messages
 * @param {number} [daysOld=30] - Delete messages older than this many days
 * @returns {number} - Number of messages deleted
 */
export function cleanup(daysOld = 30) {
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
  const result = stmts.cleanupOld.run(cutoffTimestamp);
  return result.changes;
}

/**
 * Close database connection
 */
export function close() {
  db.close();
}

// Graceful shutdown handlers
process.on('SIGINT', () => {
  console.log('\n[inbox] Closing database...');
  close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[inbox] Closing database...');
  close();
  process.exit(0);
});

// Export for direct CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[inbox] Unified Inbox initialized');
  console.log(`[inbox] Database: ${dbPath}`);
  console.log(`[inbox] WAL mode: ${db.pragma('journal_mode', { simple: true })}`);
  console.log(`[inbox] Stats:`, getStats());
}
