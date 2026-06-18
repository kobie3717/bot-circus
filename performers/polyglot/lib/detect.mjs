import { callHaiku } from './anthropic-client.mjs';
import { createHash } from 'crypto';

// In-memory cache: hash(text) -> {lang, expires}
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Detect language from text
 * @param {string} text - Text to detect
 * @returns {Promise<string>} - ISO 639-1 code (e.g., 'en', 'af', 'es')
 */
export async function detectLanguage(text) {
  const hash = hashText(text);
  const cached = cache.get(hash);

  if (cached && cached.expires > Date.now()) {
    return cached.lang;
  }

  const systemPrompt = `You are a language detection expert. Return ONLY the ISO 639-1 language code (2 letters) for the text provided. No explanation. Examples: en, af, es, zu, fr, it, de, pt, nl.`;

  const userPrompt = `Detect language:\n\n${text.slice(0, 500)}`; // First 500 chars sufficient

  const result = await callHaiku(systemPrompt, userPrompt, 10);
  const detectedLang = result.text.trim().toLowerCase().slice(0, 2);

  // Cache result
  cache.set(hash, {
    lang: detectedLang,
    expires: Date.now() + CACHE_TTL
  });

  return detectedLang;
}
