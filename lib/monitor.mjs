#!/usr/bin/env node
/**
 * Proactive Monitor - Real-time watchers + periodic checks + daily digest
 *
 * Replaces heartbeat.mjs + alerts.mjs with unified monitoring system.
 * Runs as standalone PM2 process with docker/PM2 event watching + scheduled checks.
 */

import { spawn, exec } from 'child_process';
import { createInterface } from 'readline';
import dotenv from 'dotenv';
import pg from 'pg';
import { getUnread, getStats } from './inbox.mjs';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
const CLAW_API_KEY = process.env.CLAW_API_KEY;
const internalFetchOpts = CLAW_API_KEY
  ? { signal: AbortSignal.timeout(5000), headers: { 'X-API-Key': CLAW_API_KEY } }
  : { signal: AbortSignal.timeout(5000) };

if (!TELEGRAM_BOT_TOKEN || !ALLOWED_USER_ID) {
  console.error('[monitor] TELEGRAM_BOT_TOKEN and ALLOWED_USER_ID required in .env');
  process.exit(1);
}

// Alert deduplication window (5 minutes)
const alertWindow = new Map();
const ALERT_TTL = 5 * 60 * 1000; // 5 minutes

// Digest tracking
let lastDigestDate = null;

/**
 * Get current SAST hour (UTC+2)
 */
function getSastHour() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const sast = new Date(utc + (2 * 3600000)); // UTC+2
  return sast.getHours();
}

/**
 * Get current SAST minute
 */
function getSastMinute() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const sast = new Date(utc + (2 * 3600000)); // UTC+2
  return sast.getMinutes();
}

/**
 * Check if current time is in quiet hours (23:00-08:00 SAST)
 */
function isQuietHours() {
  const hour = getSastHour();
  return hour >= 23 || hour < 8;
}

/**
 * Check if alert should be sent (deduplication)
 */
function shouldAlert(key) {
  const now = Date.now();
  const last = alertWindow.get(key);

  if (last && (now - last) < ALERT_TTL) {
    return false; // Already alerted recently
  }

  alertWindow.set(key, now);
  return true;
}

/**
 * Send message via Telegram Bot API
 */
async function sendTelegram(message, critical = false) {
  // Suppress non-critical during quiet hours
  if (!critical && isQuietHours()) {
    console.log('[monitor] Suppressing non-critical alert during quiet hours');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: ALLOWED_USER_ID,
    text: message,
    parse_mode: 'Markdown',
    disable_notification: !critical
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[monitor] Telegram API error:', error);
    }
  } catch (error) {
    console.error('[monitor] Failed to send Telegram message:', error.message);
  }
}

/**
 * Watch Docker events for container failures
 */
function watchDockerEvents() {
  console.log('[monitor] Starting Docker events watcher...');

  const docker = spawn('docker', ['events', '--filter', 'type=container']);

  const rl = createInterface({
    input: docker.stdout,
    crlfDelay: Infinity
  });

  rl.on('line', (line) => {
    // Look for die/stop events
    if (line.includes(' die ') || line.includes(' stop ')) {
      // Extract container name from event line
      const nameMatch = line.match(/name=([^\s,)]+)/);
      const containerName = nameMatch ? nameMatch[1] : 'unknown';

      const key = `docker:${containerName}`;
      if (shouldAlert(key)) {
        const message = `🚨 *Docker Container Down*\n\nContainer: \`${containerName}\`\nStatus: stopped/died\n\nCheck with: \`docker ps -a\``;
        sendTelegram(message, true);
      }
    }
  });

  docker.on('close', (code) => {
    console.error('[monitor] Docker events watcher closed with code:', code);
    console.log('[monitor] Restarting Docker watcher in 5s...');
    setTimeout(watchDockerEvents, 5000);
  });

  docker.stderr.on('data', (data) => {
    console.error('[monitor] Docker watcher error:', data.toString());
  });
}

/**
 * Watch PM2 logs for process errors
 */
function watchPM2Logs() {
  console.log('[monitor] Starting PM2 log watcher...');

  const pm2log = spawn('tail', ['-f', '/root/.pm2/pm2.log']);

  const rl = createInterface({
    input: pm2log.stdout,
    crlfDelay: Infinity
  });

  rl.on('line', (line) => {
    // Look for errored or process exit events
    if (line.includes('errored') || line.includes('Process exited')) {
      // Extract process name from log line
      let processName = 'unknown';

      // Try to extract from patterns like "PM2 [app-name] errored"
      const nameMatch = line.match(/PM2\s+\[([^\]]+)\]/);
      if (nameMatch) {
        processName = nameMatch[1];
      } else {
        // Try pattern like "app-name" in the line
        const appMatch = line.match(/[\w-]+(?=\s+(errored|exited))/i);
        if (appMatch) {
          processName = appMatch[0];
        }
      }

      const key = `pm2:${processName}`;
      if (shouldAlert(key)) {
        const message = `🚨 *PM2 Process Error*\n\nProcess: \`${processName}\`\nStatus: errored/exited\n\nCheck with: \`pm2 status\``;
        sendTelegram(message, true);
      }
    }
  });

  pm2log.on('close', (code) => {
    console.error('[monitor] PM2 log watcher closed with code:', code);
    console.log('[monitor] Restarting PM2 log watcher in 5s...');
    setTimeout(watchPM2Logs, 5000);
  });

  pm2log.stderr.on('data', (data) => {
    console.error('[monitor] PM2 log watcher error:', data.toString());
  });
}

/**
 * Check WhatsApp service status
 */
async function checkWhatsAppStatus() {
  try {
    const response = await fetch('http://127.0.0.1:7700/status', internalFetchOpts);
    const data = await response.json();

    if (data.state !== 'connected') {
      const key = 'whatsapp:disconnected';
      if (shouldAlert(key)) {
        const message = `⚠️ *WhatsApp Disconnected*\n\nStatus: \`${data.state || 'unknown'}\`\n\nCheck service at port 7700`;
        sendTelegram(message, false);
      }
    }
  } catch (error) {
    const key = 'whatsapp:unreachable';
    if (shouldAlert(key)) {
      const message = `⚠️ *WhatsApp Service Unreachable*\n\nError: ${error.message}\n\nCheck if service is running on port 7700`;
      sendTelegram(message, false);
    }
  }
}

/**
 * Check Email service status
 */
async function checkEmailStatus() {
  try {
    const response = await fetch('http://127.0.0.1:7701/status', internalFetchOpts);
    const data = await response.json();

    // Check each account
    if (data.accounts) {
      for (const [account, status] of Object.entries(data.accounts)) {
        if (status.state !== 'connected') {
          const key = `email:${account}`;
          if (shouldAlert(key)) {
            const message = `⚠️ *Email Account Disconnected*\n\nAccount: \`${account}\`\nStatus: \`${status.state || 'unknown'}\`\n\nCheck service at port 7701`;
            sendTelegram(message, false);
          }
        }
      }
    }
  } catch (error) {
    const key = 'email:unreachable';
    if (shouldAlert(key)) {
      const message = `⚠️ *Email Service Unreachable*\n\nError: ${error.message}\n\nCheck if service is running on port 7701`;
      sendTelegram(message, false);
    }
  }
}

/**
 * Check disk space usage
 */
function checkDiskSpace() {
  exec("df -h / | awk 'NR==2 {print $5}' | sed 's/%//'", (error, stdout, stderr) => {
    if (error) {
      console.error('[monitor] Disk check error:', error);
      return;
    }

    const usage = parseInt(stdout.trim());
    if (usage > 85) {
      const key = 'disk:high';
      if (shouldAlert(key)) {
        const message = `⚠️ *High Disk Usage*\n\nUsage: ${usage}%\nThreshold: 85%\n\nRun: \`df -h\` and \`du -sh /*\``;
        sendTelegram(message, false);
      }
    }
  });
}

// Lazy WhatsAuction DB pool
let waPool = null;
function getWAPool() {
  if (!waPool) {
    waPool = new pg.Pool({
      connectionString: process.env.WA_DB_URL,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    waPool.on('error', (err) => {
      console.error('[monitor] WA pool error:', err.message);
    });
  }
  return waPool;
}

/**
 * Check for new WhatsAuction signups
 */
async function checkNewSignups() {
  try {
    const pool = getWAPool();
    const res = await pool.query(
      `SELECT email, "created_at" FROM users WHERE "created_at" > NOW() - INTERVAL '30 minutes' ORDER BY "created_at" DESC`
    );

    if (res.rows.length > 0) {
      const signups = res.rows.map(r => r.email).filter(Boolean);

      if (signups.length > 0) {
        const key = 'signups:new';
        if (shouldAlert(key)) {
          const message = `🎉 *New WhatsAuction Signup(s)*\n\n${signups.map(email => `• ${email}`).join('\n')}\n\nCount: ${signups.length}`;
          sendTelegram(message, false);
        }
      }
    }
  } catch (err) {
    console.error('[monitor] Signup check error:', err.message);
  }
}

/**
 * Check unread inbox count
 */
async function checkUnreadInbox() {
  try {
    const unread = getUnread(null, 100); // Get up to 100 unread

    if (unread.length > 10) {
      const key = 'inbox:unread';
      if (shouldAlert(key)) {
        const message = `📬 *High Unread Count*\n\nUnread messages: ${unread.length}\nThreshold: 10\n\nCheck your inbox`;
        sendTelegram(message, false);
      }
    }
  } catch (error) {
    console.error('[monitor] Inbox check error:', error);
  }
}

/**
 * Check SSL certificate expiry
 */
function checkSSLCerts() {
  const domains = [
    'whatsauction.co.za',
    'app.whatsauction.co.za',
    'api.whatsauction.co.za',
    'flashvault.co.za'
  ];

  domains.forEach(domain => {
    const cmd = `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[monitor] SSL check error for ${domain}:`, error);
        return;
      }

      const expiryDate = new Date(stdout.trim());
      const now = new Date();
      const daysLeft = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysLeft < 14) {
        const key = `ssl:${domain}`;
        if (shouldAlert(key)) {
          const message = `🔐 *SSL Certificate Expiring Soon*\n\nDomain: \`${domain}\`\nDays left: ${daysLeft}\nExpires: ${expiryDate.toDateString()}\n\nRenew with: \`certbot renew\``;
          sendTelegram(message, false);
        }
      }
    });
  });
}

/**
 * Send daily digest at 08:00 SAST
 */
async function sendDailyDigest() {
  console.log('[monitor] Generating daily digest...');

  try {
    // Get inbox stats
    const stats = getStats();
    const whatsappStat = stats.find(s => s.source === 'whatsapp') || { unread: 0 };
    const emailStat = stats.find(s => s.source === 'email') || { unread: 0 };

    // Get WhatsApp unread with top contacts
    const whatsappUnread = getUnread('whatsapp', 50);
    const contactCounts = {};
    whatsappUnread.forEach(msg => {
      const contact = msg.from_name || msg.from_address || 'Unknown';
      contactCounts[contact] = (contactCounts[contact] || 0) + 1;
    });

    const topContacts = Object.entries(contactCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `  • ${name} (${count})`);

    // Get email unread with urgent filter
    const emailUnread = getUnread('email', 50);
    const urgentEmails = emailUnread.filter(m =>
      m.priority === 'high' ||
      m.subject?.toLowerCase().includes('urgent') ||
      m.subject?.toLowerCase().includes('important')
    );

    // Check disk space
    const diskPromise = new Promise((resolve) => {
      exec("df -h / | awk 'NR==2 {print $5}'", (error, stdout) => {
        resolve(error ? 'N/A' : stdout.trim());
      });
    });

    // Get Docker status
    const dockerPromise = new Promise((resolve) => {
      exec("docker ps --format '{{.Names}}' | wc -l", (error, stdout) => {
        resolve(error ? 'N/A' : stdout.trim());
      });
    });

    const [diskUsage, dockerCount] = await Promise.all([diskPromise, dockerPromise]);

    // Build digest message
    let message = `🦀 *Morning Kobie. Here's your day:*\n\n`;

    // WhatsApp section
    message += `📱 *WhatsApp*\n`;
    if (whatsappStat.unread > 0) {
      message += `  Unread: ${whatsappStat.unread}\n`;
      if (topContacts.length > 0) {
        message += `  Top contacts:\n${topContacts.join('\n')}\n`;
      }
    } else {
      message += `  No unread messages\n`;
    }

    // Email section
    message += `\n📧 *Email*\n`;
    if (emailStat.unread > 0) {
      message += `  Unread: ${emailStat.unread}`;
      if (urgentEmails.length > 0) {
        message += ` (${urgentEmails.length} urgent)`;
      }
      message += `\n`;
    } else {
      message += `  No unread messages\n`;
    }

    // Server health
    message += `\n🖥 *Server Health*\n`;
    message += `  Disk usage: ${diskUsage}\n`;
    message += `  Docker containers: ${dockerCount} running\n`;

    // Top priorities
    message += `\n✅ *Top Priorities*\n`;
    const priorities = [];

    if (whatsappStat.unread > 5) {
      priorities.push(`  • Clear WhatsApp backlog (${whatsappStat.unread} unread)`);
    }
    if (urgentEmails.length > 0) {
      priorities.push(`  • Check ${urgentEmails.length} urgent email(s)`);
    }

    if (priorities.length > 0) {
      message += priorities.join('\n');
    } else {
      message += `  • All caught up! Focus on growth.`;
    }

    await sendTelegram(message, false);

  } catch (error) {
    console.error('[monitor] Digest generation error:', error);
  }
}

/**
 * Check if digest should be sent (08:00 SAST, once per day)
 */
function checkDigestSchedule() {
  const hour = getSastHour();
  const minute = getSastMinute();
  const today = new Date().toDateString();

  // Send if it's 08:00 hour, within first 5 minutes, and not sent today
  if (hour === 8 && minute < 5 && lastDigestDate !== today) {
    lastDigestDate = today;
    sendDailyDigest();
  }
}

/**
 * Start all periodic checks
 */
function startPeriodicChecks() {
  console.log('[monitor] Starting periodic checks...');

  // Every 5 minutes
  setInterval(() => {
    // checkWhatsAppStatus(); // DISABLED — service intentionally stopped
    // checkEmailStatus();    // DISABLED — service intentionally stopped
    checkDigestSchedule();
  }, 5 * 60 * 1000);

  // Every 30 minutes
  setInterval(() => {
    checkDiskSpace();
    checkNewSignups();
    checkUnreadInbox();
  }, 30 * 60 * 1000);

  // Daily at 09:00 SAST for SSL checks
  setInterval(() => {
    const hour = getSastHour();
    const minute = getSastMinute();
    if (hour === 9 && minute < 5) {
      checkSSLCerts();
    }
  }, 5 * 60 * 1000);
}

/**
 * Run initial checks after startup delay
 */
function runInitialChecks() {
  console.log('[monitor] Running initial checks in 10s...');

  setTimeout(() => {
    checkWhatsAppStatus();
    checkEmailStatus();
    checkDiskSpace();
    console.log('[monitor] Initial checks complete');
  }, 10000);
}

/**
 * Graceful shutdown
 */
function shutdown() {
  console.log('\n[monitor] Shutting down...');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Main startup
 */
console.log('[monitor] Proactive Monitor starting...');
console.log(`[monitor] Quiet hours: 23:00-08:00 SAST (currently ${isQuietHours() ? 'QUIET' : 'ACTIVE'})`);
console.log(`[monitor] Current SAST hour: ${getSastHour()}`);

// Start watchers immediately
watchDockerEvents();
watchPM2Logs();

// Start periodic checks
startPeriodicChecks();

// Run initial checks after delay
runInitialChecks();

console.log('[monitor] All systems operational');
