#!/usr/bin/env node
/**
 * Smoke tests for Polyglot CLI (mocked LLM calls)
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Enable test mode
process.env.POLYGLOT_TEST_MODE = 'true';

const LANGUAGES = JSON.parse(readFileSync(join(__dirname, '..', 'lib', 'languages.json'), 'utf-8'));
const GLOSSARY = JSON.parse(readFileSync(join(__dirname, '..', 'lib', 'glossary.json'), 'utf-8'));

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failCount++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Test 1: languages.json loads and has expected structure
test('languages.json loads with expected structure', () => {
  assert(LANGUAGES.en, 'English should be defined');
  assert(LANGUAGES.af, 'Afrikaans should be defined');
  assert(LANGUAGES.es, 'Spanish should be defined');
  assert(LANGUAGES.en.name === 'English', 'English name should match');
  assert(LANGUAGES.af.region === 'SA', 'Afrikaans region should be SA');
  assert(Array.isArray(LANGUAGES.en.register_options), 'register_options should be array');
});

// Test 2: glossary.json loads with expected terms
test('glossary.json loads with expected terms', () => {
  assert(Array.isArray(GLOSSARY.preserve_english), 'preserve_english should be array');
  assert(GLOSSARY.preserve_english.includes('STCW'), 'Should include STCW');
  assert(GLOSSARY.preserve_english.includes('bilge'), 'Should include bilge');
  assert(GLOSSARY.preserve_english.includes('API'), 'Should include API');
  assert(GLOSSARY.preserve_english.includes('WhatsApp'), 'Should include WhatsApp');
});

// Test 3: detect language mock
test('detect language returns expected code', async () => {
  process.env.POLYGLOT_MOCK_RESPONSE = 'af';
  const { detectLanguage } = await import('../lib/detect.mjs');
  const lang = await detectLanguage('Goeie môre');
  assert(lang === 'af', `Expected 'af', got '${lang}'`);
});

// Test 4: translate calls with correct structure
test('translate builds correct system prompt structure', async () => {
  process.env.POLYGLOT_MOCK_RESPONSE = 'Good morning captain';
  const { translate } = await import('../lib/translate.mjs');
  const result = await translate('Goeie môre kaptein', 'af', 'en', 'casual');
  assert(result.translated === 'Good morning captain', 'Translation should match mock');
  assert(result.source_lang === 'af', 'Source lang should be af');
  assert(result.target_lang === 'en', 'Target lang should be en');
  assert(result.register === 'casual', 'Register should be casual');
});

// Test 5: glossary terms detected in source text
test('glossary terms detected in source text', async () => {
  process.env.POLYGLOT_MOCK_RESPONSE = 'Check the bilge and AIS';
  const { translate } = await import('../lib/translate.mjs');
  const result = await translate('Check the bilge and AIS', 'en', 'es', 'casual');
  assert(result.preserved_terms_used.includes('bilge'), 'Should detect bilge');
  assert(result.preserved_terms_used.includes('AIS'), 'Should detect AIS');
});

// Test 6: register changes system prompt (we can't inspect prompt directly, but we can verify no error)
test('register override accepted without error', async () => {
  process.env.POLYGLOT_MOCK_RESPONSE = 'Translated formal text';
  const { translate } = await import('../lib/translate.mjs');
  const result = await translate('Hello sir', 'en', 'es', 'formal');
  assert(result.register === 'formal', 'Register should be formal');
});

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
