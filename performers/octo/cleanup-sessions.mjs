#!/usr/bin/env node

import { cleanExpiredSessions, getStats } from '../../lib/sessions.mjs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { appendFile } from 'fs/promises';

const execAsync = promisify(exec);
const LOG_FILE = '/root/claude-telegram-bot/logs/cleanup.log';

async function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(line.trim());
  try {
    await appendFile(LOG_FILE, line);
  } catch {}
}

async function main() {
  await log('🧹 Session cleanup started');

  // Clean sessions older than 48h
  const deletedSessions = cleanExpiredSessions(48);

  // Clean tmp files older than 24h
  try {
    const { stdout } = await execAsync(
      'find /tmp -name "telegram-*" -type f -mtime +1 -delete -print 2>/dev/null',
      { timeout: 10000 }
    );
    const deletedFiles = stdout.trim().split('\n').filter(l => l).length;
    await log(`🗑️  Deleted ${deletedFiles} tmp files`);
  } catch (e) {
    await log(`⚠️  Tmp cleanup failed: ${e.message}`);
  }

  // Stats
  const stats = getStats();
  await log(`📊 Stats: ${stats.total} total sessions, ${stats.active24h} active in 24h`);

  await log(`✅ Cleanup complete: ${deletedSessions} sessions deleted`);
}

main().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
