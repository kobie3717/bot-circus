import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';
import { loadConfig } from './schema.js';

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

registerRule({
  id: 'R11',
  severity: 'warn',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const violations = [];
    for (const f of ['SOUL.md', 'USER.md']) {
      if (!(await fileExists(path.join(workspaceDir, f)))) {
        violations.push({ rule: 'R11', message: `${f} is recommended but missing` });
      }
    }
    return { pass: violations.length === 0, violations };
  }
});

registerRule({
  id: 'R12',
  severity: 'warn',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    const troupes = cfg.config.troupes || [];
    const memPath = path.join(workspaceDir, 'MEMORY.md');
    const hasMem = await fileExists(memPath);
    if (troupes.length > 0 && !hasMem) {
      return {
        pass: false,
        violations: [{ rule: 'R12', message: 'troupes[] non-empty but MEMORY.md missing' }]
      };
    }
    return { pass: true, violations: [] };
  }
});
