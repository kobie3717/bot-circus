import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, 'data');
const STATE_FILE = join(DATA_DIR, 'token-usage.json');
const DEFAULT_DAILY_BUDGET = 1000000000000000; // 1 quadrillion — effectively unlimited
const MAX_LOG_ENTRIES = 200;

class TokenBudget {
  constructor() {
    this.dailyBudget = DEFAULT_DAILY_BUDGET;
    this.dailyUsed = 0;
    this.currentDate = this._getToday();
    this.log = []; // { timestamp, inputTokens, outputTokens, cacheCreation, cacheRead, costUsd }
    this.forceAllow = false; // Override for one request
    this.conversationUsage = {}; // sessionId -> tokens used

    this._load();
  }

  _getToday() {
    return new Date().toISOString().split('T')[0];
  }

  async _load() {
    try {
      if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
      }

      if (existsSync(STATE_FILE)) {
        const data = JSON.parse(await readFile(STATE_FILE, 'utf-8'));
        this.dailyBudget = data.dailyBudget || DEFAULT_DAILY_BUDGET;
        this.dailyUsed = data.dailyUsed || 0;
        this.currentDate = data.currentDate || this._getToday();
        this.log = data.log || [];
        this.conversationUsage = data.conversationUsage || {};

        // Auto-reset if date changed
        this._checkDateReset();
      } else {
        await this._persist();
      }
    } catch (err) {
      console.error('[TokenBudget] Load error:', err.message);
    }
  }

  async _persist() {
    try {
      if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
      }

      const data = {
        dailyBudget: this.dailyBudget,
        dailyUsed: this.dailyUsed,
        currentDate: this.currentDate,
        log: this.log.slice(-MAX_LOG_ENTRIES), // Keep last 200
        conversationUsage: this.conversationUsage,
      };

      await writeFile(STATE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[TokenBudget] Persist error:', err.message);
    }
  }

  _checkDateReset() {
    const today = this._getToday();
    if (today !== this.currentDate) {
      console.log(`[TokenBudget] Date changed from ${this.currentDate} to ${today}, resetting usage`);
      this.currentDate = today;
      this.dailyUsed = 0;
      // Keep log for history, just reset counter
    }
  }

  async recordUsage({ inputTokens, outputTokens, cacheCreation, cacheRead, costUsd, sessionId }) {
    this._checkDateReset();

    const total = (inputTokens || 0) + (outputTokens || 0) + (cacheCreation || 0);
    this.dailyUsed += total;

    // Track per-conversation usage
    if (sessionId) {
      this.conversationUsage[sessionId] = (this.conversationUsage[sessionId] || 0) + total;
    }

    this.log.push({
      timestamp: new Date().toISOString(),
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      cacheCreation: cacheCreation || 0,
      cacheRead: cacheRead || 0,
      costUsd: costUsd || 0,
      sessionId: sessionId || null,
    });

    // Keep only last 200 entries
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(-MAX_LOG_ENTRIES);
    }

    await this._persist();

    console.log(`[TokenBudget] Recorded: ${total} tokens, $${costUsd?.toFixed(4) || '0.0000'} | Daily: ${this.dailyUsed.toLocaleString()} / ${this.dailyBudget.toLocaleString()}`);
  }

  isOverBudget() {
    // Backwards compatibility - delegates to isExhausted()
    return this.isExhausted();
  }

  isExhausted() {
    this._checkDateReset();

    if (this.forceAllow) {
      console.log('[TokenBudget] Force allow active, ignoring budget');
      this.forceAllow = false; // Reset after use
      return false;
    }

    return this.dailyUsed >= this.dailyBudget;
  }

  forceAllowNext() {
    this.forceAllow = true;
  }

  getRemaining() {
    this._checkDateReset();
    return Math.max(0, this.dailyBudget - this.dailyUsed);
  }

  getUsagePercentage() {
    this._checkDateReset();
    if (this.dailyBudget === 0) return 100;
    return Math.min(100, (this.dailyUsed / this.dailyBudget) * 100);
  }

  getDailyCost() {
    this._checkDateReset();
    const today = this._getToday();
    return this.log
      .filter(e => e.timestamp.startsWith(today))
      .reduce((sum, e) => sum + (e.costUsd || 0), 0);
  }

  getRequestCount() {
    this._checkDateReset();
    const today = this._getToday();
    return this.log.filter(e => e.timestamp.startsWith(today)).length;
  }

  getStatusText() {
    this._checkDateReset();

    const pct = this.getUsagePercentage();
    const remaining = this.getRemaining();
    const cost = this.getDailyCost();
    const requests = this.getRequestCount();

    // Last 24h stats
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = this.log.filter(e => new Date(e.timestamp).getTime() > oneDayAgo);
    const requests24h = last24h.length;

    return `📊 Token budget: ${this.dailyUsed.toLocaleString()} / ${this.dailyBudget.toLocaleString()} used (${pct.toFixed(1)}%), ${remaining.toLocaleString()} remaining\n💰 Today's cost: $${cost.toFixed(2)}\n📝 Last 24h: ${requests24h} requests`;
  }

  async setBudget(n) {
    this.dailyBudget = n;
    await this._persist();
  }

  async resetUsage() {
    this.dailyUsed = 0;
    await this._persist();
  }

  // ========== Tiered Throttling ==========

  getTier() {
    const pct = this.getUsagePercentage();
    if (pct >= 100) return 'exhausted';
    if (pct >= 95) return 'red';
    if (pct >= 85) return 'orange';
    if (pct >= 70) return 'yellow';
    return 'green';
  }

  getDelay() {
    const tier = this.getTier();
    if (tier === 'exhausted' || tier === 'red') return 5000;
    if (tier === 'orange') return 2000;
    return 0;
  }

  shouldSkipProactive() {
    const tier = this.getTier();
    return tier === 'red' || tier === 'exhausted';
  }

  getRefusalMessage() {
    return "I'm conserving tokens today, back tomorrow at midnight. /budget to check status.";
  }

  // ========== Per-Conversation Caps ==========

  isConvOver(sessionId, cap = 100000) {
    if (!sessionId) return false;
    const used = this.conversationUsage[sessionId] || 0;
    return used >= cap;
  }

  getConvUsage(sessionId) {
    if (!sessionId) return 0;
    return this.conversationUsage[sessionId] || 0;
  }

  async clearConv(sessionId) {
    if (sessionId && this.conversationUsage[sessionId]) {
      delete this.conversationUsage[sessionId];
      await this._persist();
      console.log(`[TokenBudget] Cleared conversation ${sessionId}`);
    }
  }

  // ========== Circus Pool Coordination ==========

  async checkCircusPool(botName, sessionId) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      // Dynamically import getRingToken to avoid circular dependency
      const { getRingToken } = await import('./circus-bridge.mjs');
      const token = getRingToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('http://localhost:6200/api/v1/tokens/check', {
        method: 'POST',
        headers,
        body: JSON.stringify({ bot_id: botName, session_id: sessionId }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return data.tier || null;
      }
      return null;
    } catch (err) {
      // Circus unreachable - fall back to local
      return null;
    }
  }

  async recordCircusUsage(botName, sessionId, tokens) {
    // Fire-and-forget, non-blocking
    try {
      // Dynamically import getRingToken to avoid circular dependency
      const { getRingToken } = await import('./circus-bridge.mjs');
      const token = getRingToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      fetch('http://localhost:6200/api/v1/tokens/record', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bot_id: botName,
          session_id: sessionId,
          tokens
        }),
      }).catch(() => {}); // Silently ignore errors
    } catch (err) {
      // Non-fatal, ignore
    }
  }
}

// Export both default instance and named class
const instance = new TokenBudget();
export { TokenBudget };
export default instance;
