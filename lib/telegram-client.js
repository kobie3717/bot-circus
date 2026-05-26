import TelegramBot from 'node-telegram-bot-api';
import { RateLimiter } from './rate-limiter.js';
import https from 'https';

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

          // Trusted bots bypass the allowed_users filter (bot-to-bot communication)
          const trustedBots = this.config.telegram_config?.trusted_bots || [];
          const isFromBot = msg.from?.is_bot === true;
          const isTrustedBot = isFromBot && trustedBots.some(u =>
            u === `@${username}` || u === String(userId)
          );

          if (!isTrustedBot) {
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

      // Handle guest_message updates (Bot API 10.0 — not supported by library)
      this.bot.on('update', (update) => {
        if (update.guest_message) {
          this.#handleGuestMessage(update.guest_message).catch(e =>
            this.logger.error({ error: e.message }, 'Guest message handler error')
          );
        }
      });

      this.bot.startPolling({
        allowed_updates: ['message', 'guest_message']
      });
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

  async #handleGuestMessage(guestMsg) {
    const queryId = guestMsg.guest_query_id;
    const text = guestMsg.text || '';
    const callerUser = guestMsg.guest_bot_caller_user;
    const callerChat = guestMsg.guest_bot_caller_chat;

    this.logger.info({
      queryId,
      callerUser: callerUser?.username,
      chat: callerChat?.id,
      text: text.substring(0, 50)
    }, 'Guest query received');

    // Route through normal message handler — treat as DM from caller
    const fakeUserId = callerUser?.id || 0;
    const fakeUsername = callerUser?.username || 'guest';

    // Generate response via worker pool (reuse existing pipeline)
    await this.onMessage(this.botId, `guest:${queryId}`, fakeUserId, text, async (responseText) => {
      await this.#answerGuestQuery(queryId, responseText);
    });
  }

  async #answerGuestQuery(guestQueryId, text) {
    const MAX = 4096;
    const chunk = text.length > MAX ? text.substring(0, MAX) : text;
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ guest_query_id: guestQueryId, text: chunk, parse_mode: 'Markdown' });
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${this.token}/answerGuestQuery`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (parsed.ok) resolve(parsed.result);
          else reject(new Error(parsed.description));
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
