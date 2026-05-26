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
