#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const DB_PATH = join(process.env.BOT_DATA_DIR || '/root/claude-telegram-bot/data', 'learning.db');
const SESSIONS_DB_PATH = process.env.SESSIONS_DB_PATH || join(process.env.BOT_DATA_DIR || '/root/claude-telegram-bot/data', 'sessions.db');

// Ensure data directories exist
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}
const sessionsDir = dirname(SESSIONS_DB_PATH);
if (!existsSync(sessionsDir)) {
  mkdirSync(sessionsDir, { recursive: true });
}

// Initialize databases
const db = new Database(DB_PATH);
const sessionsDb = new Database(SESSIONS_DB_PATH);

// Create feedback table
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_text TEXT NOT NULL,
    response_summary TEXT NOT NULL,
    signal TEXT NOT NULL CHECK(signal IN ('positive', 'negative')),
    timestamp INTEGER NOT NULL,
    context TEXT
  )
`);

// Create index for similarity searches
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_timestamp ON feedback(timestamp)
`);

// Create sessions FTS5 tables
sessionsDb.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
    bot_id,
    chat_id,
    session_id,
    role,
    content,
    ts UNINDEXED,
    tokenize='porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS session_meta (
    session_id TEXT PRIMARY KEY,
    bot_id TEXT,
    chat_id TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    message_count INTEGER DEFAULT 0
  );
`);

// Positive signal patterns
const POSITIVE_PATTERNS = [
  /\b(good|great|perfect|excellent|nice|thanks|thank you|awesome|brilliant|exactly|yes|correct)\b/i,
  /\b(that works|well done|makes sense|got it|understood)\b/i,
  /👍|✅|💯|🎉|👌/
];

// Negative signal patterns
const NEGATIVE_PATTERNS = [
  /\b(no|wrong|incorrect|stop|fix|broke|broken|failed|error)\b/i,
  /\b(not working|doesn't work|that's not|try again)\b/i,
  /❌|👎|⛔/
];

/**
 * Detect feedback signal in user message
 * @param {string} message - User message
 * @returns {'positive'|'negative'|null} - Signal type or null
 */
export function detectSignal(message) {
  const text = message.toLowerCase();

  // Check positive patterns
  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return 'positive';
    }
  }

  // Check negative patterns
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) {
      return 'negative';
    }
  }

  return null;
}

/**
 * Store feedback
 * @param {string} messageText - Original user message
 * @param {string} responseSummary - Summary of assistant response
 * @param {'positive'|'negative'} signal - Feedback signal
 * @param {string} context - Optional context
 */
export function storeFeedback(messageText, responseSummary, signal, context = '') {
  const now = Date.now();

  db.prepare(`
    INSERT INTO feedback (message_text, response_summary, signal, timestamp, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageText, responseSummary, signal, now, context);

  console.log(`[Learning] Stored ${signal} feedback: ${messageText.substring(0, 50)}...`);
}

/**
 * Search for similar past feedback
 * @param {string} messageText - Message to search for
 * @param {number} limit - Max results
 * @returns {Array} - Similar feedback entries
 */
export function findSimilarFeedback(messageText, limit = 3) {
  // Simple keyword matching (can be enhanced with semantic search later)
  const keywords = messageText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  if (keywords.length === 0) return [];

  // Build search pattern
  const searchPattern = keywords.map(k => `%${k}%`).join('|');

  const results = db.prepare(`
    SELECT message_text, response_summary, signal, timestamp, context
    FROM feedback
    WHERE ${keywords.map(() => 'message_text LIKE ?').join(' OR ')}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...keywords.map(k => `%${k}%`), limit);

  return results;
}

/**
 * Build feedback context for system prompt
 * @param {string} messageText - Current user message
 * @returns {string} - Formatted feedback context
 */
export function buildFeedbackContext(messageText) {
  const similar = findSimilarFeedback(messageText, 3);

  if (similar.length === 0) {
    return '';
  }

  let context = '\n## Past Feedback on Similar Tasks\n\n';

  for (const entry of similar) {
    const signal = entry.signal === 'positive' ? '✅' : '❌';
    const timeAgo = Math.floor((Date.now() - entry.timestamp) / 1000 / 60 / 60); // hours
    context += `${signal} ${entry.message_text.substring(0, 60)}... (${timeAgo}h ago)\n`;
    context += `  Response: ${entry.response_summary.substring(0, 80)}...\n`;
    if (entry.context) {
      context += `  Note: ${entry.context}\n`;
    }
    context += '\n';
  }

  return context;
}

/**
 * Get learning statistics
 * @returns {object} - Stats object
 */
export function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM feedback').get().count;
  const positive = db.prepare('SELECT COUNT(*) as count FROM feedback WHERE signal = ?').get('positive').count;
  const negative = db.prepare('SELECT COUNT(*) as count FROM feedback WHERE signal = ?').get('negative').count;

  const recent = db.prepare(`
    SELECT signal, COUNT(*) as count
    FROM feedback
    WHERE timestamp > ?
    GROUP BY signal
  `).all(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

  const recentStats = {
    positive: recent.find(r => r.signal === 'positive')?.count || 0,
    negative: recent.find(r => r.signal === 'negative')?.count || 0
  };

  return {
    total,
    positive,
    negative,
    recent: recentStats,
    ratio: total > 0 ? (positive / total * 100).toFixed(1) : 0
  };
}

/**
 * Get top patterns that received positive feedback
 * @param {number} limit - Max results
 * @returns {Array} - Top patterns
 */
export function getTopPatterns(limit = 5) {
  // Group by response summary and count positive signals
  const patterns = db.prepare(`
    SELECT response_summary, COUNT(*) as count, signal
    FROM feedback
    WHERE signal = 'positive'
    GROUP BY response_summary
    ORDER BY count DESC
    LIMIT ?
  `).all(limit);

  return patterns;
}

/**
 * Index a message in the sessions FTS5 database
 * @param {string} botId - Bot identifier
 * @param {string} chatId - Chat identifier
 * @param {string} sessionId - Session identifier
 * @param {'user'|'assistant'} role - Message role
 * @param {string} content - Message content
 */
export function indexMessage(botId, chatId, sessionId, role, content) {
  const now = Date.now();

  // Insert into FTS5 table
  sessionsDb.prepare(`
    INSERT INTO session_fts (bot_id, chat_id, session_id, role, content, ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(botId, chatId, sessionId, role, content, now);

  // Upsert session_meta
  sessionsDb.prepare(`
    INSERT INTO session_meta (session_id, bot_id, chat_id, started_at, ended_at, message_count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(session_id) DO UPDATE SET
      ended_at = ?,
      message_count = message_count + 1
  `).run(sessionId, botId, chatId, now, now, now);
}

/**
 * Search sessions using FTS5
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Array} - Search results
 */
function sanitizeFtsQuery(query) {
  const clean = String(query).replace(/[^\w\s]/g, ' ').trim();
  if (!clean) return null;
  return clean.split(/\s+/).filter(Boolean).join(' ');
}

export function searchSessions(query, limit = 5) {
  const safeQuery = sanitizeFtsQuery(query);
  if (!safeQuery) return [];
  query = safeQuery;
  const results = sessionsDb.prepare(`
    SELECT bot_id, chat_id, session_id, role, content, ts
    FROM session_fts
    WHERE session_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);

  return results;
}

/**
 * Build session context from FTS5 search results
 * @param {string} query - Search query
 * @returns {string} - Formatted context string
 */
export function buildSessionContext(query) {
  const results = searchSessions(query, 5);

  if (results.length === 0) {
    return '';
  }

  let context = '\n## Relevant Past Sessions\n\n';

  for (const result of results) {
    const timeAgo = Math.floor((Date.now() - result.ts) / 1000 / 60 / 60); // hours
    context += `**[${result.bot_id}]** ${result.role === 'user' ? 'User' : 'Assistant'} (${timeAgo}h ago):\n`;
    context += `${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}\n\n`;
  }

  return context;
}

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  sessionsDb.close();
});
process.on('SIGTERM', () => {
  db.close();
  sessionsDb.close();
});

export default {
  detectSignal,
  storeFeedback,
  findSimilarFeedback,
  buildFeedbackContext,
  getStats,
  getTopPatterns,
  indexMessage,
  searchSessions,
  buildSessionContext
};
