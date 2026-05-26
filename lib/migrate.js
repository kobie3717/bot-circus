import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates', 'performer');

function applyPlaceholders(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
}

async function copyDirRecursive(src, dest, values, force) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const e of entries) {
    const srcP = path.join(src, e.name);
    let destName = e.name.endsWith('.tmpl') ? e.name.slice(0, -5) : e.name;
    const destP = path.join(dest, destName);
    if (e.isDirectory()) {
      await copyDirRecursive(srcP, destP, values, force);
    } else {
      const raw = await fs.readFile(srcP, 'utf8');
      await fs.writeFile(destP, applyPlaceholders(raw, values));
    }
  }
}

export async function scaffoldFromTemplate({ destDir, values, force = false }) {
  let exists = true;
  try { await fs.access(destDir); } catch { exists = false; }
  if (exists && !force) {
    const entries = await fs.readdir(destDir);
    if (entries.length > 0) {
      throw new Error(`destination "${destDir}" exists and is not empty (use --force to overwrite)`);
    }
  }
  await copyDirRecursive(TEMPLATE_DIR, destDir, values, force);
}

export async function inspectLegacy(legacyDir) {
  const info = {
    pkgName: null,
    envKeys: [],
    entryScripts: [],
    suggestedRuntime: 'shared'
  };
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(legacyDir, 'package.json'), 'utf8'));
    info.pkgName = pkg.name || null;
  } catch {}
  try {
    const env = await fs.readFile(path.join(legacyDir, '.env'), 'utf8');
    info.envKeys = env.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0]);
  } catch {}
  const entries = await fs.readdir(legacyDir, { withFileTypes: true });
  info.entryScripts = entries
    .filter(e => e.isFile() && /\.(mjs|cjs|js)$/.test(e.name))
    .map(e => e.name);
  if (info.entryScripts.length > 1) info.suggestedRuntime = 'sidecar';
  return info;
}
