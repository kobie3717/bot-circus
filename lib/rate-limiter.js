/**
 * Token bucket rate limiter
 */
export class RateLimiter {
  /**
   * @param {number} tokensPerMinute - Max tokens per minute
   * @param {string} name - Limiter name for logging
   */
  constructor(tokensPerMinute, name = 'global') {
    this.tokensPerMinute = tokensPerMinute;
    this.name = name;
    this.tokens = tokensPerMinute;
    this.lastRefill = Date.now();
    this.waitQueue = [];
  }

  /**
   * Refill tokens based on elapsed time
   */
  #refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const tokensToAdd = (elapsedMs / 60000) * this.tokensPerMinute;

    this.tokens = Math.min(this.tokensPerMinute, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Acquire a token (async, waits if needed)
   * @returns {Promise<void>}
   */
  async acquire() {
    this.#refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    // Wait for next refill
    return new Promise((resolve) => {
      const waitMs = (60000 / this.tokensPerMinute) * (1 - this.tokens);
      setTimeout(() => {
        this.tokens -= 1;
        resolve();
      }, waitMs);
    });
  }

  /**
   * Try to acquire a token (non-blocking)
   * @returns {boolean} - true if acquired, false otherwise
   */
  tryAcquire() {
    this.#refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get current available tokens
   * @returns {number}
   */
  available() {
    this.#refill();
    return Math.floor(this.tokens);
  }
}

/**
 * Per-bot rate limiter collection
 */
export class BotRateLimiters {
  constructor() {
    this.limiters = new Map();
  }

  /**
   * Get or create rate limiter for a bot
   * @param {string} botId
   * @param {number} tokensPerMinute
   * @returns {RateLimiter}
   */
  get(botId, tokensPerMinute) {
    if (!this.limiters.has(botId)) {
      this.limiters.set(botId, new RateLimiter(tokensPerMinute, `bot-${botId}`));
    }
    return this.limiters.get(botId);
  }

  /**
   * Remove rate limiter for a bot
   * @param {string} botId
   */
  remove(botId) {
    this.limiters.delete(botId);
  }
}
