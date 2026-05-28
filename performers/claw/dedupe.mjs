/**
 * DedupeCache — LRU+TTL in-memory cache to prevent duplicate message processing.
 * Telegram can retry delivery, causing the same message to be processed twice.
 * Key: `${chatId}:${messageId}` — 30s TTL, max 200 entries (LRU eviction).
 */

const TTL_MS = 30_000;       // 30 second window
const MAX_ENTRIES = 200;     // LRU eviction threshold

/** @type {Map<string, number>} key → timestamp (monotonic) */
const cache = new Map();

/**
 * Returns true if this message was already seen (duplicate).
 * Side effect: marks message as seen if first time.
 * @param {number|string} chatId
 * @param {number|string} messageId
 */
export function isDuplicate(chatId, messageId) {
  const key = `${chatId}:${messageId}`;
  const now = Date.now();

  // Evict expired entries (scan on every call — cheap for 200 entries)
  for (const [k, ts] of cache) {
    if (now - ts > TTL_MS) cache.delete(k);
  }

  if (cache.has(key)) return true;

  // LRU eviction: drop oldest if at capacity
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  cache.set(key, now);
  return false;
}

/** Stats for debugging */
export function getDedupeStats() {
  return { size: cache.size, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
}
