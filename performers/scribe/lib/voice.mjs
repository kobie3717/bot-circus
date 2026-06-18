// voice.mjs — Voice guide loader

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the voice guide and return as string
 * @returns {string} Voice guide content
 */
export function loadVoiceGuide() {
  const voiceGuidePath = join(__dirname, '..', 'prompts', 'voice-guide.md');
  return readFileSync(voiceGuidePath, 'utf8');
}

/**
 * Load a prompt template by name
 * @param {string} name - Prompt name (linkedin, blog, thread, recap)
 * @returns {string} Prompt content
 */
export function loadPrompt(name) {
  const promptPath = join(__dirname, '..', 'prompts', `${name}.md`);
  return readFileSync(promptPath, 'utf8');
}

/**
 * Build full system prompt: voice guide + template
 * @param {string} templateName - Template name (linkedin, blog, thread, recap)
 * @returns {string} Combined system prompt
 */
export function buildSystemPrompt(templateName) {
  const voiceGuide = loadVoiceGuide();
  const template = loadPrompt(templateName);

  return `${voiceGuide}\n\n---\n\n${template}`;
}
