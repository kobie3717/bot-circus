import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';

async function readGitignore(workspaceDir) {
  // Search workspace + ancestor dirs up to repo root or /
  let dir = path.resolve(workspaceDir);
  const lines = new Set();
  const seen = new Set();
  while (dir && dir !== path.dirname(dir) && !seen.has(dir)) {
    seen.add(dir);
    try {
      const raw = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
      raw.split('\n').forEach(l => lines.add(l.trim()));
    } catch {}
    try {
      await fs.access(path.join(dir, '.git'));
      break; // reached repo root
    } catch {}
    dir = path.dirname(dir);
  }
  return lines;
}

registerRule({
  id: 'R09',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const envPath = path.join(workspaceDir, '.env');
    let hasEnv = false;
    try { await fs.access(envPath); hasEnv = true; } catch {}
    if (!hasEnv) return { pass: true, violations: [] };
    const ignored = await readGitignore(workspaceDir);
    const patterns = ['.env', '*.env', 'performers/*/.env'];
    const ok = patterns.some(p => ignored.has(p));
    if (!ok) {
      return {
        pass: false,
        violations: [{
          rule: 'R09',
          message: `.env exists in workspace but no matching pattern in .gitignore (expected one of: ${patterns.join(', ')})`
        }]
      };
    }
    return { pass: true, violations: [] };
  }
});

async function readPkgName(workspaceDir) {
  try {
    const raw = await fs.readFile(path.join(workspaceDir, 'package.json'), 'utf8');
    return JSON.parse(raw).name || null;
  } catch { return null; }
}

registerRule({
  id: 'R10',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir, ctx = {}) => {
    const myName = await readPkgName(workspaceDir);
    if (!myName) return { pass: true, violations: [] };
    const all = ctx.allWorkspaces || [];
    const collisions = [];
    for (const other of all) {
      if (path.resolve(other) === path.resolve(workspaceDir)) continue;
      const otherName = await readPkgName(other);
      if (otherName === myName) {
        collisions.push(path.basename(other));
      }
    }
    if (collisions.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: [{
        rule: 'R10',
        message: `package.json name "${myName}" collides with performer(s): ${collisions.join(', ')}`
      }]
    };
  }
});
