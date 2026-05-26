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
