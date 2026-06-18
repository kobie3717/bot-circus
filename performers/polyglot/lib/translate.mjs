import { callHaiku } from './anthropic-client.mjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOSSARY = JSON.parse(readFileSync(join(__dirname, 'glossary.json'), 'utf-8'));
const LANGUAGES = JSON.parse(readFileSync(join(__dirname, 'languages.json'), 'utf-8'));

/**
 * Build system prompt for translation
 */
function buildSystemPrompt(sourceLang, targetLang, register = 'casual') {
  const sourceName = LANGUAGES[sourceLang]?.name || sourceLang.toUpperCase();
  const targetName = LANGUAGES[targetLang]?.name || targetLang.toUpperCase();

  const registerGuidance = {
    formal: 'Use formal business register. "Dear Sir/Madam", proper titles, polite phrasing.',
    casual: 'Use casual conversational register. Friendly, relaxed tone.',
    whatsapp: 'Use WhatsApp casual register. Short, informal, use common abbreviations. "bru", "lol", etc.'
  }[register] || registerGuidance.casual;

  const glossaryTerms = GLOSSARY.preserve_english.join(', ');

  return `You are Polyglot 🌍 — a native-level translation specialist.

Task: Translate from ${sourceName} to ${targetName}.

Guidelines:
1. **Idiomatic, not literal.** Use natural phrasing in the target language. Translate idioms to equivalent idioms, not word-for-word.
2. **Register:** ${registerGuidance}
3. **Preserve technical terms.** The following terms MUST stay in English exactly as written: ${glossaryTerms}
4. **Marine/technical terminology:** Keep STCW, AIS, bilge, winch, etc. in English (universal marine terms).
5. **Business terms:** Keep SaaS, API, MVP, KPI, etc. in English (universal business terms).
6. **Product names:** Keep WhatsApp, Telegram, WhatsAuction, Relay, PredSea, Recon in English.

Return ONLY the translated text. No preamble, no explanation, no meta-commentary.`;
}

/**
 * Translate text
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language code
 * @param {string} targetLang - Target language code
 * @param {string} register - Register: formal, casual, whatsapp
 * @returns {Promise<{translated: string, source_lang: string, target_lang: string, register: string, preserved_terms_used: string[]}>}
 */
export async function translate(text, sourceLang, targetLang, register = 'casual') {
  const systemPrompt = buildSystemPrompt(sourceLang, targetLang, register);
  const userPrompt = text;

  const result = await callHaiku(systemPrompt, userPrompt, 2000);
  const translated = result.text.trim();

  // Detect which glossary terms were likely preserved
  const preservedTermsUsed = GLOSSARY.preserve_english.filter(term =>
    text.toLowerCase().includes(term.toLowerCase())
  );

  return {
    translated,
    source_lang: sourceLang,
    target_lang: targetLang,
    register,
    preserved_terms_used: preservedTermsUsed
  };
}
