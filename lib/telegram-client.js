import TelegramBot from 'node-telegram-bot-api';
import { RateLimiter } from './rate-limiter.js';

/**
 * Telegram client wrapper for a single bot
 */
export class TelegramClient {
  /**
   * @param {string} botId - Unique bot identifier
   * @param {string} token - Telegram bot token
   * @param {Object} config - Bot configuration
   * @param {Function} onMessage - Callback for incoming messages
   * @param {Object} logger - Pino logger instance
   */
  constructor(botId, token, config, onMessage, logger) {
    this.botId = botId;
    this.token = token;
    this.config = config;
    this.onMessage = onMessage;
    this.logger = logger.child({ botId });
    this.bot = null;
    this.rateLimiter = new RateLimiter(30, `telegram-${botId}`); // 30 msg/sec Telegram limit
    this.running = false;
  }

  /**
   * Start polling for messages
   */
  async start() {
    if (this.running) {
      this.logger.warn('Already running');
      return;
    }

    try {
      this.bot = new TelegramBot(this.token, {
        polling: {
          interval: this.config.telegram_config?.polling_interval || 1000,
          autoStart: false
        }
      });

      // Handle incoming messages
      this.bot.on('message', async (msg) => {
        try {
          const chatId = msg.chat.id;
          const userId = msg.from.id;
          const username = msg.from.username;
          const text = msg.text || '';

          // Check allowed users if configured
          const allowedUsers = this.config.telegram_config?.allowed_users || [];
          if (allowedUsers.length > 0) {
            const userMatch = allowedUsers.some(u =>
              u === `@${username}` || u === String(userId)
            );
            if (!userMatch) {
              this.logger.info({ userId, username }, 'Ignored message from unauthorized user');
              return;
            }
          }

          // Check if should respond to groups
          const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
          if (isGroup && !this.config.telegram_config?.respond_to_groups) {
            this.logger.debug({ chatId }, 'Ignored group message (disabled)');
            return;
          }

          this.logger.info({ chatId, userId, text: text.substring(0, 50) }, 'Received message');

          // Call message handler
          await this.onMessage(this.botId, chatId, userId, text);
        } catch (error) {
          this.logger.error({ error }, 'Error handling message');
        }
      });

      // Handle errors
      this.bot.on('polling_error', (error) => {
        this.logger.error({ error: error.message }, 'Polling error');
      });

      this.bot.startPolling();
      this.running = true;
      this.logger.info('Started polling');
    } catch (error) {
      this.logger.error({ error }, 'Failed to start');
      throw error;
    }
  }

  /**
   * Stop polling
   */
  async stop() {
    if (!this.running) {
      return;
    }

    try {
      await this.bot.stopPolling();
      this.running = false;
      this.logger.info('Stopped polling');
    } catch (error) {
      this.logger.error({ error }, 'Error stopping');
    }
  }

  /**
   * Send message to chat
   * @param {number} chatId - Telegram chat ID
   * @param {string} text - Message text
   * @returns {Promise<Object>} - Sent message object
   */
  async sendMessage(chatId, text) {
    await this.rateLimiter.acquire();

    try {
      const message = await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      this.logger.debug({ chatId, msgId: message.message_id }, 'Sent message');
      return message;
    } catch (error) {
      this.logger.error({ error, chatId }, 'Failed to send message');
      throw error;
    }
  }

  /**
   * Edit existing message
   * @param {number} chatId - Telegram chat ID
   * @param {number} messageId - Message ID to edit
   * @param {string} text - New message text
   * @returns {Promise<Object>} - Edited message object
   */
  async editMessage(chatId, messageId, text) {
    await this.rateLimiter.acquire();

    try {
      const message = await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      this.logger.debug({ chatId, messageId }, 'Edited message');
      return message;
    } catch (error) {
      // Ignore "message is not modified" errors
      if (!error.message.includes('message is not modified')) {
        this.logger.error({ error, chatId, messageId }, 'Failed to edit message');
      }
      throw error;
    }
  }

  /**
   * Send typing action
   * @param {number} chatId - Telegram chat ID
   */
  async sendTyping(chatId) {
    try {
      await this.bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      this.logger.debug({ error, chatId }, 'Failed to send typing action');
    }
  }
}
