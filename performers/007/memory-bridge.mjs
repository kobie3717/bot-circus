#!/usr/bin/env node

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Store a conversation fact in AI-IQ memory
 * @param {string} content - The fact/learning to store
 * @param {string[]} tags - Tags for categorization (default: ['telegram', '007'])
 * @param {string} category - Memory category (default: 'learning')
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function storeMemory(content, tags = ['telegram', '007'], category = 'learning') {
  try {
    const tagString = tags.join(',');
    await execFileAsync('memory-tool', [
      'add',
      category,
      content,
      '--tags', tagString,
      '--project', '007'
    ], { timeout: 10000 });

    console.log(`[Memory] Stored: ${content.substring(0, 100)}...`);
    return { ok: true };
  } catch (error) {
    console.error('[Memory] Store failed:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Search AI-IQ memory for relevant context
 * @param {string} query - Search query
 * @param {number} limit - Max results (default: 5)
 * @returns {Promise<string[]>} - Array of relevant memory snippets
 */
export async function searchMemory(query, limit = 5) {
  try {
    const { stdout } = await execFileAsync('memory-tool', [
      'search',
      query,
      '--semantic'
    ], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });

    // Parse output - memory-tool search returns formatted text
    const lines = stdout.trim().split('\n');
    const memories = [];
    let currentMemory = '';

    for (const line of lines) {
      // Match memory entries (format: ID | content | ...)
      if (line.match(/^\d+\s*\|/)) {
        if (currentMemory) memories.push(currentMemory.trim());
        // Extract content (second column)
        const parts = line.split('|');
        if (parts.length >= 2) {
          currentMemory = parts[1].trim();
        }
      } else if (currentMemory && line.trim()) {
        // Continuation of previous memory
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

/**
 * Extract key facts from a conversation exchange
 * @param {string} userMessage - User's message
 * @param {string} assistantResponse - Claude's response
 * @returns {string[]} - Array of extractable facts (if any)
 */
export function extractFacts(userMessage, assistantResponse) {
  const facts = [];

  // Simple heuristics for fact extraction
  // 1. Commands that indicate preferences or settings
  if (userMessage.match(/remember|save|store|note that|keep in mind/i)) {
    facts.push(`User preference: ${userMessage}`);
  }

  // 2. Assistant responses with definitive actions
  if (assistantResponse.match(/created|deployed|fixed|updated|installed|configured/i)) {
    const summary = assistantResponse.slice(0, 200).replace(/\n/g, ' ');
    facts.push(`Action completed: ${summary}`);
  }

  // 3. Error patterns and solutions
  if (userMessage.match(/error|broke|failed|not working/i) &&
      assistantResponse.match(/fixed|solved|resolved|should work now/i)) {
    facts.push(`Issue resolved: ${userMessage.slice(0, 100)} → ${assistantResponse.slice(0, 100)}`);
  }

  return facts;
}

/**
 * Build context snippet from AI-IQ memories for system prompt
 * @param {string} userMessage - Current user message
 * @returns {Promise<string>} - Formatted context string
 */
export async function buildMemoryContext(userMessage) {
  // Extract key terms from message for search
  // Skip common filler/short messages that produce garbage searches
  const stopWords = new Set(['done', 'yeah', 'okay', 'sure', 'thanks', 'what', 'whats', 'hows', 'when', 'where', 'status', 'hello', 'help', 'please', 'just', 'like', 'this', 'that', 'with', 'from', 'have', 'been', 'they', 'them', 'will', 'would', 'could', 'should', 'about', 'your', 'more', 'some', 'than', 'then', 'also', 'very', 'well', 'here', 'there', 'still', 'does', 'want', 'need', 'know', 'come', 'make', 'take', 'give', 'tell', 'show', 'look', 'good', 'back', 'only', 'over', 'such', 'much', 'even', 'most', 'after', 'before']);

  const searchTerms = userMessage
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5)
    .join(' ');

  // Need at least 2 meaningful words to search — single words produce garbage results
  const wordCount = searchTerms.trim().split(/\s+/).filter(Boolean).length;
  if (!searchTerms.trim() || wordCount < 2) {
    return '';
  }

  let memories;
  try {
    memories = await searchMemory(searchTerms, 3);
  } catch (e) {
    console.error('[Memory] buildMemoryContext search failed, skipping:', e.message);
    return '';
  }

  if (memories.length === 0) {
    return '';
  }

  let context = '\n## Relevant Past Conversations\n\n';
  for (let i = 0; i < memories.length; i++) {
    context += `${i + 1}. ${memories[i]}\n`;
  }

  return context;
}

/**
 * Auto-store conversation after Claude responds
 * @param {string} userMessage - User's message
 * @param {string} assistantResponse - Claude's response
 */
export async function autoStoreConversation(userMessage, assistantResponse) {
  const facts = extractFacts(userMessage, assistantResponse);

  for (const fact of facts) {
    await storeMemory(fact, ['telegram', '007', 'auto-captured']);
  }
}

export default {
  storeMemory,
  searchMemory,
  buildMemoryContext,
  extractFacts,
  autoStoreConversation
};
