#!/usr/bin/env node

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function storeMemory(content, tags = ['telegram', 'webbs'], category = 'learning') {
  try {
    const tagString = tags.join(',');
    await execFileAsync('memory-tool', [
      'add',
      category,
      content,
      '--tags', tagString,
      '--project', 'webbs'
    ], { timeout: 10000 });

    console.log(`[Memory] Stored: ${content.substring(0, 100)}...`);
    return { ok: true };
  } catch (error) {
    console.error('[Memory] Store failed:', error.message);
    return { ok: false, error: error.message };
  }
}

export async function searchMemory(query, limit = 5) {
  try {
    const { stdout } = await execFileAsync('memory-tool', [
      'search',
      query,
      '--semantic'
    ], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });

    const lines = stdout.trim().split('\n');
    const memories = [];
    let currentMemory = '';

    for (const line of lines) {
      if (line.match(/^\d+\s*\|/)) {
        if (currentMemory) memories.push(currentMemory.trim());
        const parts = line.split('|');
        if (parts.length >= 2) {
          currentMemory = parts[1].trim();
        }
      } else if (currentMemory && line.trim()) {
        currentMemory += ' ' + line.trim();
      }
    }
    if (currentMemory) memories.push(currentMemory.trim());

    return memories.slice(0, limit);
  } catch (error) {
    console.error('[Memory] Search failed:', error.message);
    return [];
  }
}

export function extractFacts(userMessage, assistantResponse) {
  const facts = [];

  if (userMessage.match(/remember|save|store|note that|keep in mind/i)) {
    facts.push(`User preference: ${userMessage}`);
  }

  if (assistantResponse.match(/created|deployed|fixed|updated|installed|configured/i)) {
    const summary = assistantResponse.slice(0, 200).replace(/\n/g, ' ');
    facts.push(`Action completed: ${summary}`);
  }

  if (userMessage.match(/error|broke|failed|not working/i) &&
      assistantResponse.match(/fixed|solved|resolved|should work now/i)) {
    facts.push(`Issue resolved: ${userMessage.slice(0, 100)} → ${assistantResponse.slice(0, 100)}`);
  }

  return facts;
}

export async function buildMemoryContext(userMessage) {
  const searchTerms = userMessage
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5)
    .join(' ');

  if (!searchTerms.trim()) return '';

  const memories = await searchMemory(searchTerms, 3);
  if (memories.length === 0) return '';

  let context = '\n## Relevant Past Conversations\n\n';
  for (let i = 0; i < memories.length; i++) {
    context += `${i + 1}. ${memories[i]}\n`;
  }
  return context;
}

export async function autoStoreConversation(userMessage, assistantResponse) {
  const facts = extractFacts(userMessage, assistantResponse);
  for (const fact of facts) {
    await storeMemory(fact, ['telegram', 'webbs', 'auto-captured']);
  }
}

export default { storeMemory, searchMemory, buildMemoryContext, extractFacts, autoStoreConversation };
