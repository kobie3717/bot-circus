#!/usr/bin/env node

import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const SKILLS_DB_PATH = '/root/agent-core/data/skills.db';

// Ensure data directory exists
const dir = dirname(SKILLS_DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
const db = new Database(SKILLS_DB_PATH);

// Create skills tables with FTS5
db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    trigger_query TEXT,
    use_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
    title,
    content,
    trigger_query,
    content='skills',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
    INSERT INTO skills_fts(rowid, title, content, trigger_query)
    VALUES (new.id, new.title, new.content, new.trigger_query);
  END;

  CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, title, content, trigger_query)
    VALUES('delete', old.id, old.title, old.content, old.trigger_query);
    INSERT INTO skills_fts(rowid, title, content, trigger_query)
    VALUES (new.id, new.title, new.content, new.trigger_query);
  END;
`);

/**
 * Save a skill document
 * @param {string} botId - Bot identifier
 * @param {string} title - Skill title
 * @param {string} content - Skill content (Markdown)
 * @param {string} triggerQuery - What task triggered synthesis
 * @returns {number} - Skill ID
 */
export function saveSkill(botId, title, content, triggerQuery = '') {
  const now = Date.now();

  // Check if skill with same botId+title exists
  const existing = db.prepare(`
    SELECT id FROM skills WHERE bot_id = ? AND title = ?
  `).get(botId, title);

  if (existing) {
    // Update existing skill
    db.prepare(`
      UPDATE skills
      SET content = ?, trigger_query = ?, updated_at = ?
      WHERE id = ?
    `).run(content, triggerQuery, now, existing.id);

    console.log(`[Skills] Updated skill: ${title} (ID: ${existing.id})`);
    return existing.id;
  } else {
    // Insert new skill
    const result = db.prepare(`
      INSERT INTO skills (bot_id, title, content, trigger_query, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(botId, title, content, triggerQuery, now, now);

    console.log(`[Skills] Saved new skill: ${title} (ID: ${result.lastInsertRowid})`);
    return result.lastInsertRowid;
  }
}

/**
 * Search skills using FTS5
 * @param {string} query - Search query
 * @param {string|null} botId - Optional bot filter
 * @param {number} limit - Max results
 * @returns {Array} - Matching skills
 */
function sanitizeFtsQuery(query) {
  const clean = String(query).replace(/[^\w\s]/g, ' ').trim();
  if (!clean) return null;
  return clean.split(/\s+/).filter(Boolean).join(' ');
}

export function searchSkills(query, botId = null, limit = 3) {
  const safeQuery = sanitizeFtsQuery(query);
  if (!safeQuery) return [];
  query = safeQuery;
  let results;

  if (botId) {
    // Search with bot filter
    results = db.prepare(`
      SELECT s.id, s.bot_id, s.title, s.content, s.use_count
      FROM skills_fts sf
      JOIN skills s ON sf.rowid = s.id
      WHERE sf.skills_fts MATCH ? AND s.bot_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, botId, limit);
  } else {
    // Search all skills
    results = db.prepare(`
      SELECT s.id, s.bot_id, s.title, s.content, s.use_count
      FROM skills_fts sf
      JOIN skills s ON sf.rowid = s.id
      WHERE sf.skills_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);
  }

  // Increment use_count for matched skills
  for (const skill of results) {
    db.prepare(`
      UPDATE skills SET use_count = use_count + 1 WHERE id = ?
    `).run(skill.id);
  }

  return results;
}

/**
 * Build skill context for system prompt
 * @param {string} query - Search query
 * @param {string|null} botId - Optional bot filter
 * @returns {string} - Formatted skill context
 */
export function buildSkillContext(query, botId = null) {
  const skills = searchSkills(query, botId, 3);

  if (skills.length === 0) {
    return '';
  }

  let context = '\n## Relevant Skills\n\n';

  for (const skill of skills) {
    context += `### ${skill.title}\n\n${skill.content}\n\n`;
  }

  return context;
}

/**
 * Synthesize a skill document from a completed task
 * @param {string} botId - Bot identifier
 * @param {string} taskDescription - User's task description
 * @param {string} claudeResponse - Assistant's response
 * @param {string} anthropicApiKey - Anthropic API key
 * @returns {Promise<{title: string, content: string}>} - Synthesized skill
 */
export async function synthesizeSkill(botId, taskDescription, claudeResponse, anthropicApiKey) {
  // Only synthesize for complex responses
  const isComplex = claudeResponse.length > 800 || claudeResponse.includes('```');

  if (!isComplex) {
    return null;
  }

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const prompt = `Task: ${taskDescription.slice(0, 500)}

Response: ${claudeResponse.slice(0, 2000)}

Based on this exchange, write a reusable skill document in Markdown with these sections:

## Task Pattern
Brief description of what kind of task this was.

## Approach
High-level approach that worked.

## Key Steps
Numbered list of key steps (3-5 bullets max).

## Edge Cases
Important edge cases or gotchas (2-3 bullets max).

Be concise. Focus on reusable patterns, not specific details.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const skillDoc = response.content[0].text;

    // Extract title from first heading or generate one
    const titleMatch = skillDoc.match(/^##?\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : taskDescription.slice(0, 50);

    // Save the skill
    saveSkill(botId, title, skillDoc, taskDescription);

    console.log(`[Skills] Synthesized skill: ${title}`);
    return { title, content: skillDoc };
  } catch (error) {
    console.error('[Skills] Synthesis failed:', error.message);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGINT', () => db.close());
process.on('SIGTERM', () => db.close());

export default {
  saveSkill,
  searchSkills,
  buildSkillContext,
  synthesizeSkill
};
