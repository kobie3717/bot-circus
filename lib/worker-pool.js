import { spawn } from 'child_process';
import path from 'path';

/**
 * Claude CLI worker pool with fair scheduling
 */
export class ClaudeWorkerPool {
  /**
   * @param {number} maxWorkers - Maximum concurrent workers
   * @param {number} timeoutMs - Request timeout in milliseconds
   * @param {Object} logger - Pino logger instance
   */
  constructor(maxWorkers = 10, timeoutMs = 120000, logger) {
    this.maxWorkers = maxWorkers;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.activeWorkers = new Map(); // workerId → { botId, proc, timeout }
    this.queue = []; // {botId, workspacePath, message, resolve, reject, queuedAt}
    this.processing = false;
  }

  /**
   * Execute a Claude CLI request
   * @param {string} botId - Bot identifier
   * @param {string} workspacePath - Path to bot workspace
   * @param {string} message - User message
   * @returns {Promise<string>} - Claude response
   */
  async execute(botId, workspacePath, message) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        botId,
        workspacePath,
        message,
        resolve,
        reject,
        queuedAt: Date.now()
      });

      this.#processQueue();
    });
  }

  /**
   * Process the work queue with fair scheduling
   * @private
   */
  async #processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.activeWorkers.size < this.maxWorkers) {
      // Count active workers per bot for fairness
      const botCounts = new Map();
      for (const { botId } of this.activeWorkers.values()) {
        botCounts.set(botId, (botCounts.get(botId) || 0) + 1);
      }

      // Sort queue: bots with fewer active workers first, then FIFO
      this.queue.sort((a, b) => {
        const aCount = botCounts.get(a.botId) || 0;
        const bCount = botCounts.get(b.botId) || 0;
        if (aCount !== bCount) {
          return aCount - bCount;
        }
        return a.queuedAt - b.queuedAt;
      });

      const task = this.queue.shift();
      if (!task) break;

      this.#spawnWorker(task);
    }

    this.processing = false;
  }

  /**
   * Spawn a Claude CLI worker for a task
   * @private
   */
  #spawnWorker(task) {
    const { botId, workspacePath, message, resolve, reject } = task;
    const workerId = `${botId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const absWorkspacePath = path.resolve(workspacePath);

      this.logger.debug({ botId, workerId, workspacePath: absWorkspacePath }, 'Spawning worker');

      const proc = spawn('claude', ['--print', '--cwd', absWorkspacePath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      // Set timeout
      const timeout = setTimeout(() => {
        this.logger.warn({ botId, workerId }, 'Worker timeout, killing process');
        proc.kill('SIGTERM');
        this.activeWorkers.delete(workerId);
        reject(new Error(`Claude CLI timeout after ${this.timeoutMs}ms`));
        this.#processQueue();
      }, this.timeoutMs);

      this.activeWorkers.set(workerId, { botId, proc, timeout });

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        this.activeWorkers.delete(workerId);
        this.logger.error({ error, botId, workerId }, 'Worker spawn error');
        reject(error);
        this.#processQueue();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        this.activeWorkers.delete(workerId);

        if (code === 0) {
          this.logger.debug({ botId, workerId, outputLength: stdout.length }, 'Worker completed');
          resolve(stdout.trim());
        } else {
          this.logger.error({ botId, workerId, code, stderr }, 'Worker failed');
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }

        this.#processQueue();
      });

      // Write message to stdin
      proc.stdin.write(message + '\n');
      proc.stdin.end();

    } catch (error) {
      this.logger.error({ error, botId, workerId }, 'Failed to spawn worker');
      reject(error);
      this.#processQueue();
    }
  }

  /**
   * Get pool statistics
   * @returns {Object}
   */
  getStats() {
    const botCounts = new Map();
    for (const { botId } of this.activeWorkers.values()) {
      botCounts.set(botId, (botCounts.get(botId) || 0) + 1);
    }

    const queueByBot = new Map();
    for (const task of this.queue) {
      queueByBot.set(task.botId, (queueByBot.get(task.botId) || 0) + 1);
    }

    return {
      activeWorkers: this.activeWorkers.size,
      maxWorkers: this.maxWorkers,
      queuedTasks: this.queue.length,
      activeByBot: Object.fromEntries(botCounts),
      queuedByBot: Object.fromEntries(queueByBot)
    };
  }

  /**
   * Shutdown all workers gracefully
   */
  async shutdown() {
    this.logger.info('Shutting down worker pool');

    // Clear queue
    for (const task of this.queue) {
      task.reject(new Error('Worker pool shutting down'));
    }
    this.queue = [];

    // Kill active workers
    for (const [workerId, { proc, timeout }] of this.activeWorkers.entries()) {
      clearTimeout(timeout);
      proc.kill('SIGTERM');
      this.activeWorkers.delete(workerId);
    }
  }
}
