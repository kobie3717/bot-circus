import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { TelegramClient } from './telegram-client.js';
import { ClaudeWorkerPool } from './worker-pool.js';
import { BotMessageQueue } from './message-queue.js';
import { MemoryManager } from './memory-manager.js';
import { MetricsCollector } from './metrics.js';
import { RateLimiter } from './rate-limiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Main orchestrator for bot-circus
 */
export class Orchestrator {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(ROOT_DIR, 'circus.config.json');
    this.config = this.#loadConfig();

    // Initialize logger
    this.logger = pino({
      level: this.config.logging?.level || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    });

    // Initialize components
    this.memoryManager = new MemoryManager(this.logger);
    this.workerPool = new ClaudeWorkerPool(
      this.config.worker_pool?.max_workers || 10,
      this.config.worker_pool?.request_timeout_ms || 120000,
      this.logger
    );

    // Global rate limiter for Claude API
    this.globalRateLimiter = new RateLimiter(
      this.config.global_rate_limits?.claude_requests_per_minute || 100,
      'global-claude'
    );

    // Bot management
    this.bots = new Map(); // botId → {client, queue, config, startTime, messageCount}
    this.running = false;

    // Metrics
    if (this.config.telemetry?.enable_metrics) {
      this.metrics = new MetricsCollector(
        this.config.telemetry?.metrics_port || 9090,
        this.logger
      );
    }

    // State persistence
    this.stateDir = path.join(ROOT_DIR, '.state');
    this.#ensureDir(this.stateDir);
    this.#ensureDir(path.join(ROOT_DIR, 'logs'));
  }

  /**
   * Load configuration
   * @private
   */
  #loadConfig() {
    try {
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return config;
    } catch (error) {
      console.error('Failed to load config, using defaults:', error.message);
      return {
        worker_pool: { max_workers: 10, request_timeout_ms: 120000 },
        global_rate_limits: { claude_requests_per_minute: 100 },
        logging: { level: 'info' }
      };
    }
  }

  /**
   * Ensure directory exists
   * @private
   */
  #ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load all bot configurations from performers directory
   * @private
   */
  async #loadBots() {
    const performersDir = path.join(ROOT_DIR, 'performers');
    if (!fs.existsSync(performersDir)) {
      this.logger.warn('No performers directory found');
      return;
    }

    const entries = fs.readdirSync(performersDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const botId = entry.name;
      const configPath = path.join(performersDir, botId, 'config.json');

      if (!fs.existsSync(configPath)) {
        this.logger.warn({ botId }, 'No config.json found, skipping');
        continue;
      }

      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (!config.enabled) {
          this.logger.info({ botId }, 'Bot disabled in config, skipping');
          continue;
        }

        await this.#startBot(botId, config);
      } catch (error) {
        this.logger.error({ error, botId }, 'Failed to load bot');
      }
    }
  }

  /**
   * Start a single bot
   * @private
   */
  async #startBot(botId, config) {
    if (this.bots.has(botId)) {
      this.logger.warn({ botId }, 'Bot already running');
      return;
    }

    try {
      // Create message processor
      const processMessage = async (message) => {
        const startTime = Date.now();

        try {
          // Send typing indicator
          const client = this.bots.get(botId)?.client;
          if (client) {
            await client.sendTyping(message.chatId);
          }

          // Acquire global rate limit token
          await this.globalRateLimiter.acquire();

          // Get workspace path
          const workspacePath = this.memoryManager.getWorkspacePath(botId);

          // Execute Claude CLI
          const response = await this.workerPool.execute(
            botId,
            workspacePath,
            message.text
          );

          // Send response (split if needed)
          if (client) {
            await this.#sendResponse(client, message.chatId, response);
          }

          // Update metrics
          const duration = Date.now() - startTime;
          if (this.metrics) {
            this.metrics.recordRequest(botId, duration);
          }

          // Increment message count
          const bot = this.bots.get(botId);
          if (bot) {
            bot.messageCount++;
          }

        } catch (error) {
          this.logger.error({ error, botId }, 'Error processing message');

          if (this.metrics) {
            this.metrics.recordError(botId);
          }

          // Send error message to user
          const client = this.bots.get(botId)?.client;
          if (client) {
            await client.sendMessage(
              message.chatId,
              '❌ Sorry, I encountered an error processing your message. Please try again.'
            ).catch(() => {});
          }
        }
      };

      // Create message queue
      const queue = new BotMessageQueue(
        botId,
        config.rate_limits,
        processMessage,
        this.logger
      );

      // Create Telegram client
      const onMessage = async (botId, chatId, userId, text) => {
        try {
          queue.enqueue({ chatId, userId, text });

          // Update metrics
          if (this.metrics) {
            this.metrics.updateQueueDepth(botId, queue.size());
          }
        } catch (error) {
          // Queue full
          const client = this.bots.get(botId)?.client;
          if (client) {
            await client.sendMessage(
              chatId,
              '⚠️ Message queue is full. Please try again in a moment.'
            ).catch(() => {});
          }
        }
      };

      const client = new TelegramClient(
        botId,
        config.token,
        config,
        onMessage,
        this.logger
      );

      await client.start();

      // Store bot state
      this.bots.set(botId, {
        client,
        queue,
        config,
        startTime: Date.now(),
        messageCount: 0
      });

      this.logger.info({ botId, name: config.name }, 'Bot started');

    } catch (error) {
      this.logger.error({ error, botId }, 'Failed to start bot');
      throw error;
    }
  }

  /**
   * Send response to Telegram (split if > 4096 chars)
   * @private
   */
  async #sendResponse(client, chatId, text) {
    const MAX_LENGTH = 4096;

    if (text.length <= MAX_LENGTH) {
      await client.sendMessage(chatId, text);
      return;
    }

    // Split into chunks
    const chunks = [];
    let current = '';

    for (const line of text.split('\n')) {
      if ((current + line + '\n').length > MAX_LENGTH) {
        chunks.push(current);
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    }

    if (current) {
      chunks.push(current);
    }

    // Send chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const prefix = i === 0 ? '' : `(${i + 1}/${chunks.length})\n\n`;
      await client.sendMessage(chatId, prefix + chunk);
    }
  }

  /**
   * Stop a single bot
   * @private
   */
  async #stopBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) {
      this.logger.warn({ botId }, 'Bot not running');
      return;
    }

    try {
      await bot.client.stop();
      this.bots.delete(botId);
      this.logger.info({ botId }, 'Bot stopped');
    } catch (error) {
      this.logger.error({ error, botId }, 'Error stopping bot');
    }
  }

  /**
   * Start the orchestrator
   */
  async start(botId = null) {
    if (this.running && !botId) {
      this.logger.warn('Orchestrator already running');
      return;
    }

    this.logger.info('Starting bot-circus orchestrator');

    // Start metrics server
    if (this.metrics) {
      await this.metrics.start();
    }

    // Load and start bots
    if (botId) {
      // Start specific bot
      const configPath = path.join(ROOT_DIR, 'performers', botId, 'config.json');
      if (!fs.existsSync(configPath)) {
        throw new Error(`Bot ${botId} not found`);
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      await this.#startBot(botId, config);
    } else {
      // Start all bots
      await this.#loadBots();
    }

    this.running = true;

    // Setup graceful shutdown
    const shutdown = async (signal) => {
      this.logger.info({ signal }, 'Received shutdown signal');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Periodic metrics update
    if (this.metrics) {
      this.metricsInterval = setInterval(() => {
        const stats = this.workerPool.getStats();
        this.metrics.updateActiveWorkers(stats.activeWorkers);

        for (const [botId, bot] of this.bots.entries()) {
          this.metrics.updateQueueDepth(botId, bot.queue.size());
        }
      }, 5000);
    }

    this.logger.info({ botCount: this.bots.size }, 'Orchestrator started');
  }

  /**
   * Stop the orchestrator
   */
  async stop(botId = null) {
    if (botId) {
      // Stop specific bot
      await this.#stopBot(botId);
      return;
    }

    this.logger.info('Stopping orchestrator');

    // Clear metrics interval
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Stop all bots
    const stopPromises = [];
    for (const botId of this.bots.keys()) {
      stopPromises.push(this.#stopBot(botId));
    }
    await Promise.all(stopPromises);

    // Shutdown worker pool
    await this.workerPool.shutdown();

    // Stop metrics server
    if (this.metrics) {
      await this.metrics.stop();
    }

    this.running = false;
    this.logger.info('Orchestrator stopped');
  }

  /**
   * Restart a bot
   */
  async restart(botId) {
    await this.#stopBot(botId);

    const configPath = path.join(ROOT_DIR, 'performers', botId, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Bot ${botId} not found`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    await this.#startBot(botId, config);
  }

  /**
   * Pause a bot's queue
   */
  pause(botId) {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} not running`);
    }
    bot.queue.pause();
    this.logger.info({ botId }, 'Bot paused');
  }

  /**
   * Resume a bot's queue
   */
  resume(botId) {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} not running`);
    }
    bot.queue.resume();
    this.logger.info({ botId }, 'Bot resumed');
  }

  /**
   * Get orchestrator status
   */
  getStatus() {
    const bots = [];

    for (const [botId, bot] of this.bots.entries()) {
      const uptime = Date.now() - bot.startTime;
      const queueStats = bot.queue.getStats();

      bots.push({
        id: botId,
        name: bot.config.name,
        troupe: bot.config.troupe || '(ringfenced)',
        status: queueStats.paused ? 'paused' : 'online',
        queue: queueStats.queueSize,
        messagesProcessed: bot.messageCount,
        uptimeMs: uptime
      });
    }

    const workerStats = this.workerPool.getStats();
    const globalStats = this.metrics ? this.metrics.getStats() : null;

    return {
      running: this.running,
      bots,
      workerPool: workerStats,
      globalStats
    };
  }
}

export default Orchestrator;
