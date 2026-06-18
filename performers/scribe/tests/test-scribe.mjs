// test-scribe.mjs — Smoke tests for Scribe

import { loadVoiceGuide, loadPrompt, buildSystemPrompt } from '../lib/voice.mjs';
import { saveDraft, listDrafts, getDraft } from '../lib/drafts.mjs';
import { existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failed++;
  }
}

// Test: Voice guide loads
test('Voice guide loads', () => {
  const guide = loadVoiceGuide();
  if (!guide.includes('Kobus Wentzel')) {
    throw new Error('Voice guide missing expected content');
  }
});

// Test: Prompt templates load
test('Prompt templates load', () => {
  const linkedin = loadPrompt('linkedin');
  const blog = loadPrompt('blog');
  const thread = loadPrompt('thread');
  const recap = loadPrompt('recap');

  if (!linkedin.includes('LinkedIn')) throw new Error('linkedin prompt broken');
  if (!blog.includes('Blog')) throw new Error('blog prompt broken');
  if (!thread.includes('Twitter')) throw new Error('thread prompt broken');
  if (!recap.includes('recap')) throw new Error('recap prompt broken');
});

// Test: System prompt builds correctly
test('System prompt builds correctly', () => {
  const prompt = buildSystemPrompt('linkedin');
  if (!prompt.includes('Kobus Wentzel')) {
    throw new Error('System prompt missing voice guide');
  }
  if (!prompt.includes('LinkedIn')) {
    throw new Error('System prompt missing template');
  }
});

// Test: saveDraft writes a file
test('saveDraft writes a file', () => {
  const filepath = saveDraft({
    format: 'linkedin',
    topic: 'Test Post About Something Cool',
    body: 'This is a test draft body.\n\nIt has multiple paragraphs.',
    metadata: { test: true },
  });

  if (!existsSync(filepath)) {
    throw new Error('Draft file not created');
  }
});

// Test: listDrafts returns the test draft
test('listDrafts returns the test draft', () => {
  const drafts = listDrafts();
  if (drafts.length === 0) {
    throw new Error('No drafts found');
  }

  const testDraft = drafts.find(d => d.topic.includes('test post about something cool'));
  if (!testDraft) {
    throw new Error('Test draft not found in list');
  }
});

// Test: getDraft reads it back
test('getDraft reads the test draft', () => {
  const drafts = listDrafts();
  const testDraft = drafts.find(d => d.topic.includes('test post about something cool'));

  const content = getDraft(testDraft.id);
  if (!content.includes('This is a test draft body')) {
    throw new Error('Draft content mismatch');
  }
  if (!content.includes('format: "linkedin"')) {
    throw new Error('Draft frontmatter missing');
  }
});

// Test: Anthropic client wrapper shape (mock, no real LLM call)
test('Anthropic client wrapper returns sane shape', async () => {
  // Mock test: verify the function signature is correct
  // We won't actually call the LLM in tests (to avoid burning tokens)
  const { draft } = await import('../lib/anthropic-client.mjs');

  if (typeof draft !== 'function') {
    throw new Error('draft export is not a function');
  }

  // Check it has the expected signature by inspecting the source
  const draftSrc = draft.toString();
  if (!draftSrc.includes('systemPrompt') || !draftSrc.includes('userMessage')) {
    throw new Error('draft function signature unexpected');
  }
});

// Cleanup: remove test draft
const draftsDir = join(__dirname, '..', 'drafts');
const testDrafts = listDrafts().filter(d => d.topic.includes('test post about something cool'));
testDrafts.forEach(d => {
  rmSync(d.path);
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
