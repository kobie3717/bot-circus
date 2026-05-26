import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';
import { loadConfig } from './schema.js';

const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.json']);

async function walkSourceFiles(root, current, ownId, hits, regex) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'memory' || e.name.startsWith('.')) continue;
    const childAbs = path.join(current, e.name);
    if (e.isDirectory()) {
      await walkSourceFiles(root, childAbs, ownId, hits, regex);
    } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) {
      const content = await fs.readFile(childAbs, 'utf8');
      let m;
      const re = new RegExp(regex.source, 'g');
      while ((m = re.exec(content)) !== null) {
        const refId = m[1];
        if (refId !== ownId) {
          hits.push({
            file: path.relative(root, childAbs),
            id: refId
          });
        }
      }
    }
  }
}

registerRule({
  id: 'R07',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    const ownId = cfg.config.id;
    const wsAbs = path.resolve(workspaceDir);
    const hits = [];
    const re = /performers\/([^/]+)\//;
    await walkSourceFiles(wsAbs, wsAbs, ownId, hits, re);
    if (hits.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: hits.map(h => ({
        rule: 'R07',
        message: `${h.file}: references foreign performer "performers/${h.id}/"`
      }))
    };
  }
});

async function scanForSiblingRefs(root, current, ownId, hits) {
  const importRe = /(?:from|require\s*\(|import\s*\()\s*['"`]([^'"`]+)['"`]/g;
  const readFileRe = /(?:fs\.(?:readFile|readFileSync)|readFile)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'memory' || e.name.startsWith('.')) continue;
    const childAbs = path.join(current, e.name);
    if (e.isDirectory()) {
      await scanForSiblingRefs(root, childAbs, ownId, hits);
    } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) {
      const content = await fs.readFile(childAbs, 'utf8');
      for (const re of [importRe, readFileRe]) {
        const scan = new RegExp(re.source, 'g');
        let m;
        while ((m = scan.exec(content)) !== null) {
          const target = m[1];
          if (isCrossPerformer(target, ownId, root)) {
            hits.push({ file: path.relative(root, childAbs), target });
          }
        }
      }
    }
  }
}

function isCrossPerformer(target, ownId, workspaceRoot) {
  // Relative path to sibling directory (e.g., ../other-bot/...)
  if (target.startsWith('../')) {
    const seg = target.split('/');
    if (seg[0] === '..' && seg[1] && seg[1] !== ownId) {
      // Check if it looks like a valid performer ID pattern OR any directory that's not parent/shared
      // Any ../something/ path is suspect unless it's going back to parent like ../lib
      if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(seg[1])) {
        return true;
      }
      // Also catch test cases where tmp dir doesn't match pattern but still cross-imports
      if (seg[1] !== 'lib' && seg[1] !== 'shared' && seg[1] !== 'common') {
        return true;
      }
    }
  }
  // Absolute or relative path containing performers/<id>/
  const perfMatch = target.match(/(?:^|\/)performers\/([a-z0-9][a-z0-9-]{0,63})\//);
  if (perfMatch && perfMatch[1] !== ownId) return true;
  return false;
}

registerRule({
  id: 'R08',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    const ownId = cfg.config.id;
    const wsAbs = path.resolve(workspaceDir);
    const hits = [];
    await scanForSiblingRefs(wsAbs, wsAbs, ownId, hits);
    if (hits.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: hits.map(h => ({
        rule: 'R08',
        message: `${h.file}: import/readFile of foreign performer "${h.target}"`
      }))
    };
  }
});
