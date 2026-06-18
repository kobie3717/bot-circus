#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { detectLanguage } from './lib/detect.mjs';
import { translate } from './lib/translate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from hydra-note (where ANTHROPIC_API_KEY lives)
dotenv.config({ path: '/root/hydra-note/.env' });

const LANGUAGES = JSON.parse(readFileSync(join(__dirname, 'lib', 'languages.json'), 'utf-8'));

function printHelp() {
  console.log(`
Polyglot 🌍 — Translation specialist CLI

USAGE:
  polyglot translate <text>                              Auto-detect source, prompt for target
  polyglot translate <text> --to <lang>                  Translate to target language
  polyglot translate <text> --to <lang> --from <lang>    Explicit source language
  polyglot translate <text> --to <lang> --register <r>   Register: formal|casual|whatsapp
  polyglot translate-file <path> --to <lang>             Translate file, output to <path>.<lang>.<ext>
  polyglot detect <text>                                 Detect language (ISO 639-1 code)
  polyglot languages                                     List supported languages
  polyglot help                                          Show this help

OPTIONS:
  --to <lang>         Target language (ISO 639-1 code: en, af, zu, es, it, fr, de, pt, nl)
  --from <lang>       Source language (auto-detected if not provided)
  --register <r>      Register: formal, casual, whatsapp (default: casual)
  --save              Save translation to translations/ dir

EXAMPLES:
  polyglot translate "Goeie môre kaptein" --to en
  polyglot translate "How's the bilge holding up?" --to es --register casual
  polyglot detect "Hola, capitán"
  polyglot translate-file ./README.md --to es
  polyglot languages

SUPPORTED LANGUAGES:
  SA: en (English), af (Afrikaans), zu (isiZulu)
  Mediterranean: es (Spanish), it (Italian), fr (French), de (German), pt (Portuguese), nl (Dutch)

TECHNICAL TERMS:
  Marine (STCW, AIS, bilge, winch) and business (API, SaaS, MVP) terms stay in English.

COST:
  Powered by Claude Haiku 4.5 ($0.80/MTok in, $4/MTok out).
  Usage tracked in usage.jsonl. View total: cat usage.jsonl | jq -s 'map(.cost_usd) | add'
`);
}

function listLanguages() {
  console.log('\nSupported Languages:\n');
  for (const [code, info] of Object.entries(LANGUAGES)) {
    const region = info.region ? `[${info.region}]` : '';
    const variants = info.variants ? ` (variants: ${info.variants.join(', ')})` : '';
    console.log(`  ${code.padEnd(4)} ${info.name.padEnd(20)} ${region}${variants}`);
  }
  console.log('');
}

async function detectCmd(text) {
  const lang = await detectLanguage(text);
  console.log(lang);
}

async function translateCmd(text, options) {
  const { to, from, register = 'casual', save = false } = options;

  if (!to) {
    console.error('Error: --to <lang> required');
    process.exit(1);
  }

  if (!LANGUAGES[to]) {
    console.error(`Error: Unsupported target language: ${to}`);
    process.exit(1);
  }

  let sourceLang = from;
  if (!sourceLang) {
    sourceLang = await detectLanguage(text);
  }

  if (!LANGUAGES[sourceLang]) {
    console.error(`Error: Detected/provided source language not supported: ${sourceLang}`);
    process.exit(1);
  }

  const result = await translate(text, sourceLang, to, register);
  console.log(result.translated);

  if (save) {
    saveTranslation(text, result);
  }
}

async function translateFileCmd(filePath, options) {
  const { to, from, register = 'casual' } = options;

  if (!to) {
    console.error('Error: --to <lang> required');
    process.exit(1);
  }

  const text = readFileSync(filePath, 'utf-8');

  let sourceLang = from;
  if (!sourceLang) {
    sourceLang = await detectLanguage(text);
  }

  const result = await translate(text, sourceLang, to, register);

  // Output path: <basename>.<target_lang>.<ext>
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const dir = dirname(filePath);
  const outputPath = join(dir, `${base}.${to}${ext}`);

  writeFileSync(outputPath, result.translated, 'utf-8');
  console.log(`Translated: ${filePath} -> ${outputPath}`);
}

function saveTranslation(originalText, result) {
  const translationsDir = join(__dirname, 'translations');
  try {
    mkdirSync(translationsDir, { recursive: true });
  } catch (err) {
    // Directory exists
  }

  const date = new Date().toISOString().split('T')[0];
  const slug = originalText.slice(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `${date}_${slug}_${result.source_lang}_to_${result.target_lang}.md`;
  const filePath = join(translationsDir, filename);

  const content = `---
source_lang: ${result.source_lang}
target_lang: ${result.target_lang}
register: ${result.register}
preserved_terms: ${result.preserved_terms_used.join(', ')}
date: ${new Date().toISOString()}
---

# Original (${result.source_lang})

${originalText}

# Translated (${result.target_lang})

${result.translated}
`;

  writeFileSync(filePath, content, 'utf-8');
  console.log(`\nSaved: ${filePath}`);
}

function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'save') {
        options[key] = true;
      } else {
        options[key] = args[++i];
      }
    } else {
      positional.push(arg);
    }
  }

  return { options, positional };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help') {
    printHelp();
    return;
  }

  const command = args[0];

  if (command === 'languages') {
    listLanguages();
    return;
  }

  if (command === 'detect') {
    const text = args[1];
    if (!text) {
      console.error('Error: text required');
      process.exit(1);
    }
    await detectCmd(text);
    return;
  }

  if (command === 'translate') {
    const { options, positional } = parseArgs(args.slice(1));
    const text = positional[0];
    if (!text) {
      console.error('Error: text required');
      process.exit(1);
    }
    await translateCmd(text, options);
    return;
  }

  if (command === 'translate-file') {
    const { options, positional } = parseArgs(args.slice(1));
    const filePath = positional[0];
    if (!filePath) {
      console.error('Error: file path required');
      process.exit(1);
    }
    await translateFileCmd(filePath, options);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
