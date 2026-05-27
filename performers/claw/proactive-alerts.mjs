#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import crypto from 'crypto';

const DB_PATH = '/root/claude-telegram-bot/data/proactive-alerts.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create alerts table
db.exec(`
  CREATE TABLE IF NOT EXISTS proactive_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    message TEXT NOT NULL,
    critical INTEGER DEFAULT 0,
    last_sent INTEGER NOT NULL,
    count INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
  )
`);

// Create index on hash for dedup
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_hash ON proactive_alerts(hash, last_sent)
`);

// Alert keywords that trigger notifications
const ERROR_KEYWORDS = [
  'error', 'failed', 'down', 'critical', 'not running',
  'not online', 'offline', 'timeout', 'unavailable', 'crash'
];

// Critical keywords that bypass quiet hours
const CRITICAL_KEYWORDS = [
  'critical', 'down', 'offline', 'database', 'payment'
];

// Dedup window (30 minutes)
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

// Quiet hours queue
const quietHoursQueue = [];

/**
 * Check if current time is in quiet hours (23:00-08:00 SAST)
 * @returns {boolean}
 */
function isQuietHours() {
  const now = new Date();
  // SAST is UTC+2
  const sastHour = (now.getUTCHours() + 2) % 24;
  return sastHour >= 23 || sastHour < 8;
}

/**
 * Generate hash for alert deduplication
 * @param {string} message - Alert message
 * @returns {string} - Hash
 */
function hashAlert(message) {
  // Normalize message (remove timestamps, line numbers) for dedup
  const normalized = message
    .toLowerCase()
    .replace(/\d{2}:\d{2}:\d{2}/g, '') // remove times
    .replace(/line \d+/g, '') // remove line numbers
    .replace(/\d{4}-\d{2}-\d{2}/g, '') // remove dates
    .trim();

  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Check if message contains error indicators
 * @param {string} message - Message text
 * @param {number} exitCode - Process exit code
 * @returns {boolean}
 */
export function shouldAlert(message, exitCode = 0) {
  if (exitCode !== 0 && exitCode !== null && exitCode !== undefined) {
    return true;
  }

  const lower = message.toLowerCase();
  return ERROR_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Check if alert is critical (bypasses quiet hours)
 * @param {string} message - Alert message
 * @returns {boolean}
 */
function isCritical(message) {
  const lower = message.toLowerCase();
  return CRITICAL_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Check if alert should be sent (handles deduplication)
 * @param {string} message - Alert message
 * @param {boolean} critical - Is critical alert
 * @returns {{shouldSend: boolean, reason?: string}}
 */
function checkDedup(message, critical) {
  const hash = hashAlert(message);
  const now = Date.now();
  const cutoff = now - DEDUP_WINDOW_MS;

  // Check if same alert was sent recently
  const recent = db.prepare(`
    SELECT * FROM proactive_alerts
    WHERE hash = ? AND last_sent > ?
    ORDER BY last_sent DESC
    LIMIT 1
  `).get(hash, cutoff);

  if (recent) {
    // Update count
    db.prepare('UPDATE proactive_alerts SET count = count + 1 WHERE id = ?').run(recent.id);

    return {
      shouldSend: false,
      reason: `Deduplicated (last sent ${Math.floor((now - recent.last_sent) / 1000 / 60)}m ago)`
    };
  }

  // Record this alert
  db.prepare(`
    INSERT INTO proactive_alerts (hash, message, critical, last_sent, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hash, message, critical ? 1 : 0, now, now);

  return { shouldSend: true };
}

/**
 * Send alert to Telegram
 * @param {object} bot - Grammy bot instance
 * @param {number} chatId - Telegram chat ID
 * @param {string} message - Alert message
 * @param {boolean} force - Force send even in quiet hours
 */
export async function sendAlert(bot, chatId, message, force = false) {
  const critical = isCritical(message);

  // Check dedup
  const dedupResult = checkDedup(message, critical);
  if (!dedupResult.shouldSend) {
    console.log(`[ProactiveAlerts] ${dedupResult.reason}`);
    return;
  }

  // Check quiet hours
  if (isQuietHours() && !critical && !force) {
    console.log('[ProactiveAlerts] Quiet hours - queuing non-critical alert for morning');
    quietHoursQueue.push({ message, timestamp: Date.now() });
    return;
  }

  // Send alert
  const icon = critical ? '🚨' : '⚠️';
  const prefix = critical ? '*CRITICAL ALERT*' : '*Alert*';
  const fullMessage = `${icon} ${prefix}\n\n${message}`;

  try {
    await bot.api.sendMessage(chatId, fullMessage, {
      parse_mode: 'Markdown',
      disable_notification: !critical
    });
    console.log(`[ProactiveAlerts] Sent: ${message.substring(0, 100)}`);
  } catch (error) {
    console.error('[ProactiveAlerts] Send failed:', error.message);
  }
}

/**
 * Flush queued alerts (call this at 08:00 SAST)
 * @param {object} bot - Grammy bot instance
 * @param {number} chatId - Telegram chat ID
 */
export async function flushQueuedAlerts(bot, chatId) {
  if (quietHoursQueue.length === 0) {
    return;
  }

  console.log(`[ProactiveAlerts] Flushing ${quietHoursQueue.length} queued alerts`);

  const summary = quietHoursQueue.map((a, i) =>
    `${i + 1}. ${a.message.substring(0, 100)}`
  ).join('\n\n');

  const message = `🌅 *Overnight Alerts (${quietHoursQueue.length})*\n\n${summary}`;

  try {
    await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    quietHoursQueue.length = 0; // Clear queue
  } catch (error) {
    console.error('[ProactiveAlerts] Flush failed:', error.message);
  }
}

/**
 * Get recent alerts
 * @param {number} limit - Number of alerts to return
 * @returns {Array}
 */
export function getRecentAlerts(limit = 20) {
  return db.prepare(`
    SELECT * FROM proactive_alerts
    ORDER BY last_sent DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get queued alerts count
 * @returns {number}
 */
export function getQueuedCount() {
  return quietHoursQueue.length;
}

/**
 * Get alert statistics
 * @returns {object}
 */
export function getAlertStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM proactive_alerts').get().count;
  const critical = db.prepare('SELECT COUNT(*) as count FROM proactive_alerts WHERE critical = 1').get().count;
  const last24h = db.prepare(`
    SELECT COUNT(*) as count FROM proactive_alerts
    WHERE last_sent > ?
  `).get(Date.now() - 24 * 60 * 60 * 1000).count;

  return {
    total,
    critical,
    last24h,
    queued: quietHoursQueue.length
  };
}

/**
 * Mute alerts temporarily
 * @param {number} minutes - Duration in minutes
 * @returns {number} - Unmute timestamp
 */
let muteUntil = 0;

export function muteAlerts(minutes) {
  muteUntil = Date.now() + (minutes * 60 * 1000);
  console.log(`[ProactiveAlerts] Muted for ${minutes} minutes`);
  return muteUntil;
}

/**
 * Check if alerts are currently muted
 * @returns {boolean}
 */
export function isMuted() {
  return Date.now() < muteUntil;
}

/**
 * Get mute status
 * @returns {{muted: boolean, until?: number, remainingMinutes?: number}}
 */
export function getMuteStatus() {
  if (!isMuted()) {
    return { muted: false };
  }

  const remaining = Math.ceil((muteUntil - Date.now()) / 1000 / 60);
  return {
    muted: true,
    until: muteUntil,
    remainingMinutes: remaining
  };
}

// Graceful shutdown
process.on('SIGINT', () => db.close());
process.on('SIGTERM', () => db.close());

export default {
  shouldAlert,
  sendAlert,
  flushQueuedAlerts,
  getRecentAlerts,
  getQueuedCount,
  getAlertStats,
  muteAlerts,
  isMuted,
  getMuteStatus
};
