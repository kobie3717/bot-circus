import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';

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
