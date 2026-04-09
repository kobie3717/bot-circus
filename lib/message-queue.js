/**
 * Per-bot FIFO message queue with rate limiting
 */
export class BotMessageQueue {
  /**
   * @param {string} botId - Bot identifier
   * @param {Object} rateLimits - Rate limit configuration
   * @param {Function} processMessage - Message processor function
   * @param {Object} logger - Pino logger instance
   */
  constructor(botId, rateLimits, processMessage, logger) {
    this.botId = botId;
    this.messagesPerMinute = rateLimits.messages_per_minute || 20;
    this.maxQueueSize = rateLimits.max_queue_size || 100;
    this.processMessage = processMessage;
    this.logger = logger.child({ botId, component: 'queue' });

    this.queue = [];
    this.processing = false;
    this.messageTimestamps = []; // Track message times for rate limiting
    this.paused = false;
  }

  /**
   * Enqueue a message for processing
   * @param {Object} message - Message object {chatId, userId, text}
   * @throws {Error} If queue is full
   */
  enqueue(message) {
    if (this.queue.length >= this.maxQueueSize) {
      this.logger.warn({ queueSize: this.queue.length }, 'Queue full, rejecting message');
      throw new Error(`Queue full for bot ${this.botId}`);
    }

    this.queue.push({
      ...message,
      enqueuedAt: Date.now()
    });

    this.logger.debug({ queueSize: this.queue.length }, 'Message enqueued');
    this.#process();
  }

  /**
   * Process the queue
   * @private
   */
  async #process() {
    if (this.processing || this.queue.length === 0 || this.paused) {
      return;
    }

    // Rate limit check
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter(ts => now - ts < 60000);

    if (this.messageTimestamps.length >= this.messagesPerMinute) {
      const oldestTimestamp = this.messageTimestamps[0];
      const waitMs = 60000 - (now - oldestTimestamp);

      this.logger.debug({ waitMs }, 'Rate limit reached, waiting');
      setTimeout(() => this.#process(), waitMs + 100);
      return;
    }

    this.processing = true;
    const message = this.queue.shift();
    this.messageTimestamps.push(now);

    try {
      const waitTime = now - message.enqueuedAt;
      this.logger.info({ waitTime, queueSize: this.queue.length }, 'Processing message');

      await this.processMessage(message);
    } catch (error) {
      this.logger.error({ error }, 'Error processing message');
    } finally {
      this.processing = false;

      // Continue processing if queue has items
      if (this.queue.length > 0) {
        // Small delay to prevent tight loop
        setTimeout(() => this.#process(), 100);
      }
    }
  }

  /**
   * Pause queue processing
   */
  pause() {
    this.paused = true;
    this.logger.info('Queue paused');
  }

  /**
   * Resume queue processing
   */
  resume() {
    this.paused = false;
    this.logger.info('Queue resumed');
    this.#process();
  }

  /**
   * Get queue size
   * @returns {number}
   */
  size() {
    return this.queue.length;
  }

  /**
   * Check if queue is processing
   * @returns {boolean}
   */
  isProcessing() {
    return this.processing;
  }

  /**
   * Clear the queue
   */
  clear() {
    const cleared = this.queue.length;
    this.queue = [];
    this.logger.info({ cleared }, 'Queue cleared');
  }

  /**
   * Get queue statistics
   * @returns {Object}
   */
  getStats() {
    const now = Date.now();
    const recentMessages = this.messageTimestamps.filter(ts => now - ts < 60000).length;

    return {
      queueSize: this.queue.length,
      processing: this.processing,
      paused: this.paused,
      messagesLastMinute: recentMessages,
      messagesPerMinuteLimit: this.messagesPerMinute,
      maxQueueSize: this.maxQueueSize
    };
  }
}
