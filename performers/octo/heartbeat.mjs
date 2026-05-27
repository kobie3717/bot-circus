#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from 'dotenv';
import { appendFile } from 'fs/promises';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
const LOG_FILE = '/root/claude-telegram-bot/logs/heartbeat.log';

function isQuietHours() {
  const now = new Date();
  const sastHour = (now.getUTCHours() + 2) % 24;
  return sastHour >= 23 || sastHour < 8;
}

async function sendTelegram(message, silent = false) {
  if (silent && isQuietHours()) {
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
        disable_notification: silent
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

async function runCheck(name, command, critical = false) {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 10000 });
    const output = stdout.trim() || stderr.trim();
    await log(`✅ ${name}: ${output.substring(0, 200)}`);
    return { ok: true, output };
  } catch (e) {
    const error = e.message || e.stderr || String(e);
    await log(`❌ ${name}: ${error.substring(0, 200)}`);
    if (critical) {
      await sendTelegram(`🚨 *CRITICAL*: ${name}\n\`\`\`\n${error.substring(0, 300)}\n\`\`\``, false);
    }
    return { ok: false, error };
  }
}

async function checkNewSignups() {
  try {
    // Query all client databases for new signups in last 24h
    const query = `SELECT email, created_at FROM users WHERE created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC`;

    const { stdout: whatsauction } = await execAsync(
      `psql -U whatsauction_user -d whatsauction -t -c "${query}" 2>/dev/null || echo ""`,
      { timeout: 10000 }
    );

    const { stdout: flashvault } = await execAsync(
      `psql -U vpn_user -d vpn_business -t -c "${query}" 2>/dev/null || echo ""`,
      { timeout: 10000 }
    );

    const signups = [];
    [whatsauction, flashvault].forEach((output, idx) => {
      const db = idx === 0 ? 'WhatsAuction' : 'FlashVault';
      output.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && trimmed !== '(0 rows)') {
          signups.push(`${db}: ${trimmed}`);
        }
      });
    });

    if (signups.length > 0) {
      await log(`🎉 New signups (24h): ${signups.length}`);
      const message = `🎉 *New Signups (24h)*\n\n${signups.map(s => `• ${s}`).join('\n')}`;
      await sendTelegram(message, false);

      // Generate CSV for export
      const csv = `Database,Email,Created At\n${signups.join('\n')}`;
      const csvPath = `/tmp/signups-${new Date().toISOString().split('T')[0]}.csv`;
      await import('fs/promises').then(fs => fs.writeFile(csvPath, csv));

      // Send CSV via Telegram
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ALLOWED_USER_ID,
          document: { source: csvPath },
          caption: '📊 Signups CSV'
        })
      });
    }

    return signups.length;
  } catch (e) {
    await log(`❌ Signup check failed: ${e.message}`);
    return 0;
  }
}

async function main() {
  await log('🦀 Heartbeat started');

  const checks = [
    { name: 'Docker containers', cmd: 'docker ps --format "{{.Names}} {{.Status}}" | head -10', critical: true },
    { name: 'PM2 processes', cmd: 'pm2 jlist | jq -r ".[] | .name + \\" \\" + .pm2_env.status" 2>/dev/null || pm2 status', critical: true },
    { name: 'WhatsAuction API', cmd: 'curl -sf http://localhost:4000/health | jq -r .status', critical: false },
    { name: 'FlashVault API', cmd: 'curl -sf http://localhost:3000/health | jq -r .status', critical: false },
    { name: 'Disk space', cmd: 'df -h / | tail -1', critical: true },
    { name: 'Memory usage', cmd: 'free -h | grep Mem', critical: false },
    { name: 'Load average', cmd: 'uptime | awk -F"load average:" \'{print $2}\'', critical: false }
  ];

  const results = [];
  for (const check of checks) {
    const result = await runCheck(check.name, check.cmd, check.critical);
    results.push({ ...check, ...result });
  }

  // Check for new signups
  const signupCount = await checkNewSignups();

  // Summary
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0 && !isQuietHours()) {
    const summary = failed.map(f => `• ${f.name}`).join('\n');
    await sendTelegram(`⚠️ *Heartbeat Issues*\n\n${summary}`, true);
  }

  await log(`🦀 Heartbeat complete: ${results.filter(r => r.ok).length}/${results.length} checks passed, ${signupCount} new signups`);
}

main().catch(err => {
  console.error('Heartbeat error:', err);
  process.exit(1);
});
