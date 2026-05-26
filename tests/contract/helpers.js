import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, 'fixtures');

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

export function makeTmpWorkspace(setupFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circus-test-'));
  try {
    setupFn(dir);
    return dir;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function cleanupTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFiles(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (typeof content === 'object') {
      fs.writeFileSync(full, JSON.stringify(content, null, 2));
    } else {
      fs.writeFileSync(full, content);
    }
  }
}
