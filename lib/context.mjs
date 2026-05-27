#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const DB_PATH = join(process.env.BOT_DATA_DIR || '/root/claude-telegram-bot/data', 'context.db');

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create context table
db.exec(`
  CREATE TABLE IF NOT EXISTS context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    topic TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    message_preview TEXT NOT NULL
  )
`);

// Create index
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON context(chat_id, timestamp DESC)
`);

// Project keywords for topic extraction
const PROJECT_KEYWORDS = [
  'whatsauction',
  'memzy',
  'friday',
  'circus',
  'flashvault',
  'baileys',
  'wasp',
  'whatshub',
  'ai-iq',
  'autoclaw',
  'claw',
  'openclaw',
  'paybridge',
  'softycomp',
  'overwatch',
  'vpn',
  'telegram',
  'bot'
];

/**
 * Extract topic from message
 * @param {string} message - Message text
 * @param {string} response - Response text (optional)
 * @returns {string} - Detected topic or 'general'
 */
export function extractTopic(message, response = '') {
  const combined = (message + ' ' + response).toLowerCase();

  // Check for project keywords
  for (const keyword of PROJECT_KEYWORDS) {
    if (combined.includes(keyword)) {
      return keyword;
    }
  }

  // Check for technical topics
  if (combined.match(/\b(deploy|deployment|server|service|restart|logs|error|fix|bug)\b/)) {
    return 'devops';
  }

  if (combined.match(/\b(code|function|class|api|database|schema|query|sql)\b/)) {
    return 'coding';
  }

  if (combined.match(/\b(memory|remember|learn|feedback|context)\b/)) {
    return 'meta';
  }

  return 'general';
}

/**
 * Update context for a chat
 * @param {number} chatId - Telegram chat ID
 * @param {string} message - User message
 * @param {string} response - Assistant response
 */
export function updateContext(chatId, message, response = '') {
  const topic = extractTopic(message, response);
  const timestamp = Date.now();
  const messagePreview = message.substring(0, 200);

  db.prepare(`
    INSERT INTO context (chat_id, topic, timestamp, message_preview)
    VALUES (?, ?, ?, ?)
  `).run(chatId, topic, timestamp, messagePreview);

  console.log(`[Context] Updated: chat=${chatId}, topic=${topic}`);

  // Keep only last 100 entries per chat
  const count = db.prepare('SELECT COUNT(*) as count FROM context WHERE chat_id = ?').get(chatId).count;
  if (count > 100) {
    db.prepare(`
      DELETE FROM context
      WHERE id IN (
        SELECT id FROM context
        WHERE chat_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
      )
    `).run(chatId, count - 100);
  }
}

/**
 * Get current context for a chat
 * @param {number} chatId - Telegram chat ID
 * @returns {object} - Current topic and recent transitions
 */
export function getContext(chatId) {
  const recent = db.prepare(`
    SELECT topic, timestamp, message_preview
    FROM context
    WHERE chat_id = ?
    ORDER BY timestamp DESC
    LIMIT 4
  `).all(chatId);

  if (recent.length === 0) {
    return {
      currentTopic: 'general',
      transitions: []
    };
  }

  // Current topic is the most recent
  const currentTopic = recent[0].topic;

  // Track topic transitions (when topic changes)
  const transitions = [];
  let lastTopic = null;

  for (const entry of recent.reverse()) {
    if (lastTopic && entry.topic !== lastTopic) {
      transitions.push({
        from: lastTopic,
        to: entry.topic,
        timestamp: entry.timestamp
      });
    }
    lastTopic = entry.topic;
  }

  return {
    currentTopic,
    transitions,
    recentMessages: recent.slice(0, 3)
  };
}

/**
 * Get topic history for a chat
 * @param {number} chatId - Telegram chat ID
 * @param {number} limit - Max results
 * @returns {Array} - Topic timeline
 */
export function getTopicHistory(chatId, limit = 20) {
  return db.prepare(`
    SELECT topic, timestamp, message_preview
    FROM context
    WHERE chat_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(chatId, limit);
}

/**
 * Get topic statistics for a chat
 * @param {number} chatId - Telegram chat ID
 * @returns {Array} - Topic counts
 */
export function getTopicStats(chatId) {
  return db.prepare(`
    SELECT topic, COUNT(*) as count
    FROM context
    WHERE chat_id = ?
    GROUP BY topic
    ORDER BY count DESC
  `).all(chatId);
}

/**
 * Clear context for a chat
 * @param {number} chatId - Telegram chat ID
 */
export function clearContext(chatId) {
  const result = db.prepare('DELETE FROM context WHERE chat_id = ?').run(chatId);
  console.log(`[Context] Cleared ${result.changes} entries for chat ${chatId}`);
}

/**
 * Build context summary for system prompt
 * @param {number} chatId - Telegram chat ID
 * @returns {string} - Formatted context summary
 */
export function buildContextSummary(chatId) {
  const context = getContext(chatId);

  if (context.recentMessages.length === 0) {
    return '';
  }

  let summary = '\n## Conversation Context\n\n';
  summary += `Current topic: ${context.currentTopic}\n`;

  if (context.transitions.length > 0) {
    summary += '\nRecent topic shifts:\n';
    for (const t of context.transitions) {
      const timeAgo = Math.floor((Date.now() - t.timestamp) / 1000 / 60); // minutes
      summary += `• ${t.from} → ${t.to} (${timeAgo}m ago)\n`;
    }
  }

  return summary;
}

// Graceful shutdown
process.on('SIGINT', () => db.close());
process.on('SIGTERM', () => db.close());

export default {
  extractTopic,
  updateContext,
  getContext,
  getTopicHistory,
  getTopicStats,
  clearContext,
  buildContextSummary
};
