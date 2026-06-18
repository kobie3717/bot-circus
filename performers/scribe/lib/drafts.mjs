// drafts.mjs — File-based draft storage

import { writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DRAFTS_DIR = join(__dirname, '..', 'drafts');

/**
 * Generate kebab-case slug from topic
 * @param {string} topic - Topic string
 * @returns {string} Slug (max 50 chars)
 */
function slugify(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

/**
 * Save a draft to disk
 * @param {object} options
 * @param {string} options.format - linkedin, blog, thread, recap
 * @param {string} options.topic - Topic/brief
 * @param {string} options.body - Generated content
 * @param {object} options.metadata - Additional metadata (usage, cost, etc)
 * @returns {string} File path of saved draft
 */
export function saveDraft({ format, topic, body, metadata = {} }) {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const slug = slugify(topic);
  const filename = `${date}_${slug}_${format}.md`;
  const filepath = join(DRAFTS_DIR, filename);

  const frontmatter = {
    format,
    topic,
    generated_at: new Date().toISOString(),
    model: metadata.model || 'claude-sonnet-4-5-20250929',
    length_chars: body.length,
    draft_id: filename.replace('.md', ''),
    ...metadata,
  };

  const content = `---
${Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}
---

${body}
`;

  writeFileSync(filepath, content, 'utf8');
  return filepath;
}

/**
 * List all saved drafts (sorted by date, newest first)
 * @returns {Array<{id: string, path: string, date: string, topic: string, format: string}>}
 */
export function listDrafts() {
  if (!existsSync(DRAFTS_DIR)) {
    return [];
  }

  const files = readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filepath = join(DRAFTS_DIR, f);
      const stat = statSync(filepath);
      const [date, ...rest] = f.replace('.md', '').split('_');
      const format = rest.pop();
      const topic = rest.join('_').replace(/-/g, ' ');

      return {
        id: f.replace('.md', ''),
        path: filepath,
        date,
        topic,
        format,
        modified: stat.mtime,
      };
    })
    .sort((a, b) => b.modified - a.modified);

  return files;
}

/**
 * Get a specific draft by ID or path
 * @param {string} idOrPath - Draft ID or file path
 * @returns {string} Draft content (including frontmatter)
 */
export function getDraft(idOrPath) {
  let filepath = idOrPath;

  // If it's just an ID (not a full path), construct the path
  if (!idOrPath.includes('/')) {
    filepath = join(DRAFTS_DIR, `${idOrPath}.md`);
  }

  if (!existsSync(filepath)) {
    throw new Error(`Draft not found: ${idOrPath}`);
  }

  return readFileSync(filepath, 'utf8');
}
