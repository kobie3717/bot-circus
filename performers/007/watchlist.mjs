#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = '/root/007-bot/data/intel.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create watchlist table
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL UNIQUE,
    category TEXT,
    added_at INTEGER NOT NULL,
    last_checked INTEGER
  )
`);

// Create intel reports table
db.exec(`
  CREATE TABLE IF NOT EXISTS intel_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Create indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_watchlist_keyword ON watchlist(keyword);
  CREATE INDEX IF NOT EXISTS idx_reports_created ON intel_reports(created_at DESC);
`);

/**
 * Add keyword to watchlist
 * @param {string} keyword - Keyword to watch
 * @param {string} category - Optional category (competitors, market, tech, etc.)
 * @returns {boolean} - Success
 */
export function addWatch(keyword, category = null) {
  try {
    const now = Date.now();
    db.prepare('INSERT INTO watchlist (keyword, category, added_at) VALUES (?, ?, ?)')
      .run(keyword, category, now);
    console.log(`[Watchlist] Added: ${keyword} (${category || 'general'})`);
    return true;
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      console.log(`[Watchlist] Already watching: ${keyword}`);
      return false;
    }
    throw error;
  }
}

/**
 * Remove keyword from watchlist
 * @param {string} keyword - Keyword to remove
 * @returns {boolean} - Success
 */
export function removeWatch(keyword) {
  const result = db.prepare('DELETE FROM watchlist WHERE keyword = ?').run(keyword);
  if (result.changes > 0) {
    console.log(`[Watchlist] Removed: ${keyword}`);
    return true;
  }
  return false;
}

/**
 * Get all watchlist keywords
 * @param {string} category - Optional category filter
 * @returns {Array} - Watchlist items
 */
export function getWatchlist(category = null) {
  if (category) {
    return db.prepare('SELECT * FROM watchlist WHERE category = ? ORDER BY added_at DESC').all(category);
  }
  return db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC').all();
}

/**
 * Update last checked timestamp for keyword
 * @param {string} keyword - Keyword
 */
export function updateLastChecked(keyword) {
  const now = Date.now();
  db.prepare('UPDATE watchlist SET last_checked = ? WHERE keyword = ?').run(now, keyword);
}

/**
 * Save intel report
 * @param {string} topic - Report topic
 * @param {string} summary - Report content
 * @returns {number} - Report ID
 */
export function saveReport(topic, summary) {
  const now = Date.now();
  const result = db.prepare('INSERT INTO intel_reports (topic, summary, created_at) VALUES (?, ?, ?)')
    .run(topic, summary, now);
  console.log(`[Reports] Saved: ${topic} (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

/**
 * Get recent intel reports
 * @param {number} limit - Number of reports to fetch (default: 10)
 * @returns {Array} - Recent reports
 */
export function getRecentReports(limit = 10) {
  return db.prepare('SELECT * FROM intel_reports ORDER BY created_at DESC LIMIT ?').all(limit);
}

/**
 * Get watchlist statistics
 * @returns {object} - Stats
 */
export function getStats() {
  const totalWatched = db.prepare('SELECT COUNT(*) as count FROM watchlist').get().count;
  const totalReports = db.prepare('SELECT COUNT(*) as count FROM intel_reports').get().count;
  const categories = db.prepare('SELECT DISTINCT category FROM watchlist WHERE category IS NOT NULL').all();

  return {
    totalWatched,
    totalReports,
    categories: categories.map(c => c.category)
  };
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
  addWatch,
  removeWatch,
  getWatchlist,
  updateLastChecked,
  saveReport,
  getRecentReports,
  getStats
};
