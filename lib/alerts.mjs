#!/usr/bin/env node

import { spawn } from 'child_process';
import { config } from 'dotenv';
import { appendFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
const LOG_FILE = '/root/claude-telegram-bot/logs/alerts.log';

// Track recent alerts to deduplicate
const recentAlerts = new Map(); // key -> timestamp
const DEDUP_WINDOW = 5 * 60 * 1000; // 5 minutes

function isQuietHours() {
  const now = new Date();
  const sastHour = (now.getUTCHours() + 2) % 24;
  return sastHour >= 23 || sastHour < 8;
}

async function sendTelegram(message, critical = false) {
  if (!critical && isQuietHours()) {
    console.log('[QUIET] Suppressed:', message.substring(0, 100));
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ALLOWED_USER_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_notification: !critical
      })
    });
  } catch (e) {
    console.error('Telegram send failed:', e.message);
  }
}

async function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(line.trim());
  try {
    await appendFile(LOG_FILE, line);
  } catch {}
}

function shouldAlert(key) {
  const now = Date.now();
  const lastAlert = recentAlerts.get(key);

  if (lastAlert && now - lastAlert < DEDUP_WINDOW) {
    return false; // Too recent, skip
  }

  recentAlerts.set(key, now);

  // Cleanup old entries
  for (const [k, timestamp] of recentAlerts.entries()) {
    if (now - timestamp > DEDUP_WINDOW) {
      recentAlerts.delete(k);
    }
  }

  return true;
}

async function watchDockerEvents() {
  await log('🐳 Starting Docker events monitor');

  const docker = spawn('docker', ['events', '--filter', 'type=container'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  docker.stdout.on('data', async (data) => {
    const line = data.toString().trim();

    // Parse docker event: "2024-01-01T12:00:00.000000000+00:00 container die 123abc (name=whatsauction-backend)"
    if (line.includes(' die ') || line.includes(' stop ')) {
      const nameMatch = line.match(/name=([^\s\)]+)/);
      const containerName = nameMatch ? nameMatch[1] : 'unknown';

      const key = `docker-${containerName}`;
      if (!shouldAlert(key)) return;

      await log(`❌ Docker event: ${containerName} died/stopped`);
      await sendTelegram(`🐳 *Docker Alert*\n\nContainer died: \`${containerName}\`\n\n${line}`, true);
    }
  });

  docker.on('close', async (code) => {
    await log(`Docker events monitor exited with code ${code}`);
    // Auto-restart after 5 seconds
    setTimeout(watchDockerEvents, 5000);
  });

  docker.on('error', async (err) => {
    await log(`Docker events error: ${err.message}`);
  });
}

async function watchPM2Logs() {
  await log('📋 Starting PM2 log monitor');

  const pm2LogPath = '/root/.pm2/pm2.log';

  // Tail the pm2.log file
  const tail = spawn('tail', ['-f', '-n', '0', pm2LogPath], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const rl = createInterface({
    input: tail.stdout,
    crlfDelay: Infinity
  });

  rl.on('line', async (line) => {
    // Detect process crashes/exits
    if (line.includes('PM2 error:') || line.includes('errored') || line.includes('Process exited')) {
      // Extract process name if possible
      const nameMatch = line.match(/app=([^\s\]]+)/);
      const processName = nameMatch ? nameMatch[1] : 'unknown';

      const key = `pm2-${processName}`;
      if (!shouldAlert(key)) return;

      await log(`❌ PM2 event: ${processName} errored/crashed`);
      await sendTelegram(`📋 *PM2 Alert*\n\nProcess crashed: \`${processName}\`\n\n\`\`\`\n${line.substring(0, 300)}\n\`\`\``, true);
    }
  });

  tail.on('close', async (code) => {
    await log(`PM2 log monitor exited with code ${code}`);
    // Auto-restart after 5 seconds
    setTimeout(watchPM2Logs, 5000);
  });

  tail.on('error', async (err) => {
    await log(`PM2 log monitor error: ${err.message}`);
  });
}

async function main() {
  await log('🦀 Claw Alert Monitor starting');

  // Start both watchers
  watchDockerEvents();
  watchPM2Logs();

  // Keep alive
  process.on('SIGINT', async () => {
    await log('🦀 Alert monitor stopping (SIGINT)');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await log('🦀 Alert monitor stopping (SIGTERM)');
    process.exit(0);
  });
}

main().catch(async (err) => {
  await log(`Fatal error: ${err.message}`);
  process.exit(1);
});
