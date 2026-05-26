import path from 'node:path';
import fs from 'node:fs';
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

export function writeQuarantineState(filePath, failedMap) {
  const obj = {
    updated_at: new Date().toISOString(),
    quarantined: Object.fromEntries(
      [...failedMap.entries()].map(([id, info]) => [
        id,
        { errors: info.errors || info.ruleResults?.filter(r => !r.pass) || [] }
      ])
    )
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

export function readQuarantineState(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return new Map(); }
  const obj = JSON.parse(raw);
  return new Map(Object.entries(obj.quarantined || {}));
}
