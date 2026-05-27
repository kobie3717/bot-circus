#!/usr/bin/env node

import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const DB_PATH = join(process.env.BOT_DATA_DIR || '/root/claude-telegram-bot/data', 'queue.db');

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Create job queue table
db.exec(`
  CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    output TEXT,
    exit_code INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  )
`);

// Create index on status for queue processing
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_status ON job_queue(status, created_at)
`);

// Job timeout (10 minutes)
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

// Currently running job
let currentJob = null;

/**
 * Enqueue a new job
 * @param {number} chatId - Telegram chat ID
 * @param {string} description - Human-readable description
 * @param {string} command - Shell command to execute
 * @returns {number} - Job ID
 */
export function enqueueJob(chatId, description, command) {
  const now = Date.now();

  const result = db.prepare(`
    INSERT INTO job_queue (chat_id, description, command, created_at)
    VALUES (?, ?, ?, ?)
  `).run(chatId, description, command, now);

  console.log(`[Queue] Enqueued job #${result.lastInsertRowid}: ${description}`);

  return result.lastInsertRowid;
}

/**
 * Get job status
 * @param {number} jobId - Job ID
 * @returns {object|null} - Job info or null
 */
export function getJobStatus(jobId) {
  const job = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(jobId);

  if (!job) return null;

  // Calculate duration
  let duration = null;
  if (job.started_at) {
    const end = job.completed_at || Date.now();
    duration = Math.floor((end - job.started_at) / 1000); // seconds
  }

  return {
    id: job.id,
    description: job.description,
    status: job.status,
    output: job.output,
    exitCode: job.exit_code,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    duration
  };
}

/**
 * List jobs for a chat
 * @param {number} chatId - Telegram chat ID
 * @param {number} limit - Max number of jobs to return
 * @returns {Array} - Recent jobs
 */
export function listJobs(chatId, limit = 10) {
  return db.prepare(`
    SELECT * FROM job_queue
    WHERE chat_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(chatId, limit);
}

/**
 * Execute a job
 * @param {object} job - Job object from DB
 * @param {Function} sendToTelegram - Callback to send result to Telegram
 */
async function executeJob(job, sendToTelegram) {
  const now = Date.now();

  // Update status to running
  db.prepare(`
    UPDATE job_queue
    SET status = 'running', started_at = ?
    WHERE id = ?
  `).run(now, job.id);

  console.log(`[Queue] Running job #${job.id}: ${job.command}`);

  return new Promise((resolve) => {
    // Parse command (use shell for complex commands)
    const proc = spawn('bash', ['-c', job.command], {
      timeout: JOB_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024, // 5MB
      cwd: '/root'
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (exitCode) => {
      const output = (stdout + stderr).trim();
      const status = exitCode === 0 ? 'done' : 'failed';
      const completedAt = Date.now();

      // Update job in DB
      db.prepare(`
        UPDATE job_queue
        SET status = ?, output = ?, exit_code = ?, completed_at = ?
        WHERE id = ?
      `).run(status, output, exitCode, completedAt, job.id);

      console.log(`[Queue] Job #${job.id} ${status} (exit ${exitCode})`);

      // Send result to Telegram
      const icon = status === 'done' ? '✅' : '❌';
      const duration = Math.floor((completedAt - now) / 1000);
      let message = `${icon} *Job #${job.id} ${status}*\n\n`;
      message += `Description: ${job.description}\n`;
      message += `Duration: ${duration}s\n`;
      message += `Exit code: ${exitCode}\n\n`;

      if (output) {
        message += `\`\`\`\n${output.substring(0, 2000)}\n\`\`\``;
      }

      await sendToTelegram(job.chat_id, message);

      resolve();
    });

    proc.on('error', async (error) => {
      const errorMsg = error.message;
      const completedAt = Date.now();

      db.prepare(`
        UPDATE job_queue
        SET status = 'failed', output = ?, completed_at = ?
        WHERE id = ?
      `).run(errorMsg, completedAt, job.id);

      console.error(`[Queue] Job #${job.id} error:`, errorMsg);

      await sendToTelegram(
        job.chat_id,
        `❌ *Job #${job.id} failed*\n\n${job.description}\n\nError: ${errorMsg}`
      );

      resolve();
    });

    // Handle timeout
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGTERM');
        console.log(`[Queue] Job #${job.id} timed out after 10 minutes`);
      }
    }, JOB_TIMEOUT_MS);
  });
}

/**
 * Process queue (picks next job and runs it)
 * @param {object} bot - Grammy bot instance
 */
export async function processQueue(bot) {
  // Don't start new job if one is already running
  if (currentJob) {
    return;
  }

  // Get next queued job
  const nextJob = db.prepare(`
    SELECT * FROM job_queue
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `).get();

  if (!nextJob) {
    return; // No jobs in queue
  }

  currentJob = nextJob;

  // Execute job
  const sendToTelegram = async (chatId, message) => {
    try {
      await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('[Queue] Failed to send result:', error.message);
    }
  };

  await executeJob(nextJob, sendToTelegram);

  currentJob = null;
}

/**
 * Get queue statistics
 * @returns {object}
 */
export function getQueueStats() {
  const queued = db.prepare("SELECT COUNT(*) as count FROM job_queue WHERE status = 'queued'").get().count;
  const running = db.prepare("SELECT COUNT(*) as count FROM job_queue WHERE status = 'running'").get().count;
  const done = db.prepare("SELECT COUNT(*) as count FROM job_queue WHERE status = 'done'").get().count;
  const failed = db.prepare("SELECT COUNT(*) as count FROM job_queue WHERE status = 'failed'").get().count;

  return { queued, running, done, failed };
}

/**
 * Clean up old completed jobs (older than 7 days)
 * @returns {number} - Number of jobs deleted
 */
export function cleanupOldJobs() {
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const result = db.prepare(`
    DELETE FROM job_queue
    WHERE status IN ('done', 'failed') AND completed_at < ?
  `).run(cutoff);

  if (result.changes > 0) {
    console.log(`[Queue] Cleaned ${result.changes} old jobs`);
  }

  return result.changes;
}

// Graceful shutdown
process.on('SIGINT', () => db.close());
process.on('SIGTERM', () => db.close());

export default {
  enqueueJob,
  getJobStatus,
  listJobs,
  processQueue,
  getQueueStats,
  cleanupOldJobs
};
