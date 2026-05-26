import path from 'node:path';
import fs from 'node:fs/promises';
import { registerRule } from './rules.js';
import { loadConfig } from './schema.js';

registerRule({
  id: 'R03',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) {
      return { pass: true, violations: [] }; // R01 catches; R03 stays quiet
    }
    const dirName = path.basename(path.resolve(workspaceDir));
    if (cfg.config.id !== dirName) {
      return {
        pass: false,
        violations: [{
          rule: 'R03',
          message: `config.id "${cfg.config.id}" does not match parent directory "${dirName}"`
        }]
      };
    }
    return { pass: true, violations: [] };
  }
});

registerRule({
  id: 'R04',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    if (cfg.config.runtime !== 'custom') return { pass: true, violations: [] };
    const mdPath = path.join(workspaceDir, 'CUSTOM_RUNTIME.md');
    try {
      await fs.access(mdPath);
      return { pass: true, violations: [] };
    } catch {
      return {
        pass: false,
        violations: [{
          rule: 'R04',
          message: `runtime is "custom" but CUSTOM_RUNTIME.md is missing`
        }]
      };
    }
  }
});

registerRule({
  id: 'R05',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    if (cfg.config.runtime !== 'sidecar') return { pass: true, violations: [] };
    const sidecars = cfg.config.sidecars || [];
    if (sidecars.length === 0) {
      return {
        pass: false,
        violations: [{ rule: 'R05', message: 'runtime is "sidecar" but sidecars[] is empty' }]
      };
    }
    const wsAbs = path.resolve(workspaceDir);
    const violations = [];
    for (const sc of sidecars) {
      const scriptAbs = path.resolve(wsAbs, sc.script);
      const rel = path.relative(wsAbs, scriptAbs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        violations.push({
          rule: 'R05',
          message: `sidecar "${sc.name}" script "${sc.script}" escapes workspace`
        });
        continue;
      }
      try {
        await fs.access(scriptAbs);
      } catch {
        violations.push({
          rule: 'R05',
          message: `sidecar "${sc.name}" script "${sc.script}" does not exist`
        });
      }
    }
    return { pass: violations.length === 0, violations };
  }
});

async function walkForSymlinks(rootAbs, currentAbs, hits) {
  const entries = await fs.readdir(currentAbs, { withFileTypes: true });
  for (const e of entries) {
    const childAbs = path.join(currentAbs, e.name);
    if (e.isSymbolicLink()) {
      const linkTarget = await fs.readlink(childAbs);
      const resolved = path.resolve(path.dirname(childAbs), linkTarget);
      const rel = path.relative(rootAbs, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        hits.push({ link: path.relative(rootAbs, childAbs), target: linkTarget });
      }
    } else if (e.isDirectory()) {
      await walkForSymlinks(rootAbs, childAbs, hits);
    }
  }
}

registerRule({
  id: 'R06',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const wsAbs = path.resolve(workspaceDir);
    const hits = [];
    await walkForSymlinks(wsAbs, wsAbs, hits);
    if (hits.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: hits.map(h => ({
        rule: 'R06',
        message: `symlink "${h.link}" points outside workspace to "${h.target}"`
      }))
    };
  }
});
