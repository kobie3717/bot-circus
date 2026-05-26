import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { registerRule } from './rules.js';

const REQUIRED_IDENTITY_FIELDS = ['id', 'name', 'role'];

export async function readIdentityFrontmatter(workspaceDir) {
  const p = path.join(workspaceDir, 'IDENTITY.md');
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, error: `missing IDENTITY.md at ${p}` };
    return { ok: false, error: `read failed: ${err.message}` };
  }
  const parsed = matter(raw);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    return { ok: false, error: 'IDENTITY.md has no frontmatter block' };
  }
  const missing = REQUIRED_IDENTITY_FIELDS.filter(k => !(k in parsed.data));
  if (missing.length) {
    return { ok: false, error: `IDENTITY.md frontmatter missing fields: ${missing.join(', ')}` };
  }
  return { ok: true, data: parsed.data };
}

registerRule({
  id: 'R02',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const r = await readIdentityFrontmatter(workspaceDir);
    if (!r.ok) return { pass: false, violations: [{ rule: 'R02', message: r.error }] };
    return { pass: true, violations: [] };
  }
});
