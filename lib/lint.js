import { RULES } from './contract/index.js';
import { execSync } from 'node:child_process';
import path from 'node:path';

const LAYER_RULE_FILTER = {
  lint: r => r.layers.includes('lint'),
  ci: r => r.layers.includes('ci'),
  runtime: r => r.layers.includes('runtime'),
  all: () => true
};

export async function lintWorkspace(workspaceDir, ctx = {}, layer = 'all') {
  const filter = LAYER_RULE_FILTER[layer] || LAYER_RULE_FILTER.all;
  const rules = [...RULES.values()].filter(filter);
  const ruleResults = [];
  for (const rule of rules) {
    try {
      const out = await rule.run(workspaceDir, ctx);
      ruleResults.push({ id: rule.id, severity: rule.severity, ...out });
    } catch (err) {
      ruleResults.push({
        id: rule.id,
        severity: rule.severity,
        pass: false,
        violations: [{ rule: rule.id, message: `rule crashed: ${err.message}` }]
      });
    }
  }
  return { workspace: workspaceDir, ruleResults };
}

export async function lintWorkspaces({ workspaces, layer = 'all' }) {
  const results = [];
  let errorCount = 0;
  let warnCount = 0;
  for (const ws of workspaces) {
    const r = await lintWorkspace(ws, { allWorkspaces: workspaces }, layer);
    results.push(r);
    for (const rr of r.ruleResults) {
      if (rr.pass) continue;
      if (rr.severity === 'error') errorCount += rr.violations.length;
      if (rr.severity === 'warn') warnCount += rr.violations.length;
    }
  }
  return { results, errorCount, warnCount };
}

export async function pickWorkspacesSince(allWorkspaces, ref) {
  if (allWorkspaces.length === 0) return [];
  const repoRoot = path.resolve(allWorkspaces[0], '..', '..');
  let changed;
  try {
    const out = execSync(`git diff --name-only ${ref}...HEAD`, { cwd: repoRoot, encoding: 'utf8' });
    changed = out.split('\n').filter(Boolean);
  } catch { return allWorkspaces; }
  const picked = new Set();
  for (const f of changed) {
    const m = f.match(/^performers\/([^/]+)\//);
    if (m) {
      const ws = path.join(repoRoot, 'performers', m[1]);
      if (allWorkspaces.includes(ws)) picked.add(ws);
    }
  }
  return [...picked];
}
