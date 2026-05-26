import path from 'node:path';
import { lintWorkspace } from './lint.js';

export async function validateAtBoot(workspaces) {
  const passed = new Map();
  const failed = new Map();
  for (const ws of workspaces) {
    const id = path.basename(ws);
    const result = await lintWorkspace(ws, { allWorkspaces: workspaces }, 'runtime');
    const errors = result.ruleResults.filter(r => !r.pass && r.severity === 'error');
    if (errors.length === 0) passed.set(id, result);
    else failed.set(id, { ...result, errors });
  }
  return { passed, failed };
}
