#!/usr/bin/env node

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const BOT_PROJECT = process.env.BOT_PROJECT || 'Claw';

/**
 * Extract key points from conversation
 * @param {Array} messages - Recent messages
 * @returns {Array} - Key points
 */
function extractKeyPoints(messages) {
  const points = [];
  const keywords = ['TODO', 'decided', 'fixed', 'deployed', 'created', 'remember', 'important'];

  for (const msg of messages) {
    const text = msg.text || '';
    const lines = text.split('\n');

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
        points.push(line.trim().substring(0, 100));
      }
    }
  }

  return points;
}

/**
 * Extract topic from last message
 * @param {string} lastMessage - Last user message
 * @returns {string} - Topic
 */
function extractTopic(lastMessage) {
  // Extract first meaningful phrase (skip commands)
  if (lastMessage.startsWith('/')) {
    return 'command execution';
  }

  // Take first 50 chars
  const topic = lastMessage.substring(0, 50).trim();

  // Clean up
  return topic.replace(/\n/g, ' ');
}

/**
 * Capture session snapshot before context death
 * @param {string} sessionId - Session ID
 * @param {Array} lastMessages - Last few messages in conversation
 * @param {string} responseText - Final response text (optional)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function captureSessionSnapshot(sessionId, lastMessages = [], responseText = '') {
  try {
    // Extract topic from last user message
    const lastUserMessage = lastMessages.filter(m => m.role === 'user').slice(-1)[0];
    const topic = lastUserMessage ? extractTopic(lastUserMessage.text) : 'unknown';

    // Extract key points from all messages
    const keyPoints = extractKeyPoints(lastMessages);

    // Build summary
    let summary = `Telegram session ${sessionId.substring(0, 8)} ended. Last topic: ${topic}.`;

    if (keyPoints.length > 0) {
      summary += ` Key points: ${keyPoints.join('; ')}.`;
    }

    if (responseText) {
      // Include snippet of last response
      const snippet = responseText.substring(0, 100).replace(/\n/g, ' ');
      summary += ` Last response: ${snippet}`;
    }

    // Store in memory using memory-tool
    console.log('[Handoff] Capturing session snapshot:', summary.substring(0, 100));

    const { stdout } = await execFileAsync('memory-tool', [
      'add',
      'learning',
      summary,
      '--tags', 'telegram,handoff,session',
      '--project', BOT_PROJECT
    ], { timeout: 5000 });

    console.log('[Handoff] Snapshot saved:', stdout.trim());

    return { ok: true };
  } catch (error) {
    console.error('[Handoff] Snapshot failed:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Load previous session context for new sessions
 * @param {number} chatId - Telegram chat ID
 * @returns {Promise<string>} - Session context summary
 */
export async function loadSessionContext(chatId) {
  // Primary: sessions DB (fast, reliable)
  if (chatId) {
    try {
      const { getLastSummary } = await import('./sessions.mjs');
      const summary = getLastSummary(chatId);
      if (summary) {
        console.log('[Handoff] Loaded context from sessions DB');
        return summary;
      }
    } catch (e) {
      // fall through to memory-tool
    }
  }
  // Fallback: memory-tool search
  try {
    const { stdout } = await execFileAsync('memory-tool', [
      'search', 'telegram handoff session', '--tags', 'handoff'
    ], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const lines = stdout.trim().split('\n');
    if (lines.length > 1) {
      const recentHandoff = lines[1];
      console.log('[Handoff] Loaded previous session context from memory-tool');
      return recentHandoff;
    }
    return '';
  } catch (error) {
    console.error('[Handoff] Failed to load context:', error.message);
    return '';
  }
}

/**
 * Format session context for injection into new session
 * @param {string} context - Raw context string
 * @returns {string} - Formatted context
 */
export function formatSessionContext(context) {
  if (!context) {
    return '';
  }

  return `\n\n[Previous session context: ${context}]`;
}

export default {
  captureSessionSnapshot,
  loadSessionContext,
  formatSessionContext
};
