// data.js — Node data loading (fs): Electron's main process, the tests and
// the tools. The checks and the merge live in data-core.js, shared with the
// Android WebView build; this file only supplies the file access.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FLY_MODELS, assembleBrainData, availableModels } from './data-core.js';

export { FLY_MODELS };

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));

// Where the data folder may sit, in the order it is looked for: the
// repository root (next to windows/), a copy inside windows/, then relative to
// the working directory. The first one holding circuit.json wins.
export function findDataDir() {
  for (const base of [join(SOURCE_DIR, '..', '..'), join(SOURCE_DIR, '..'), process.cwd(), join(process.cwd(), '..')]) {
    const dir = join(base, 'data');
    if (existsSync(join(dir, 'circuit.json'))) return dir;
  }
  return null;
}

// File access to one data folder, by relative path.
export function nodeDataIO(dir) {
  return {
    exists: (rel) => existsSync(join(dir, rel)),
    read: (rel) => readFileSync(join(dir, rel), 'utf8'),
    sha256: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

export function availableFlyModels(dir = findDataDir()) {
  if (!dir) return [];
  return availableModels(nodeDataIO(dir));
}

export function loadBrainData(dir = findDataDir(), { model = process.env.NEUROCAUSE_FLY_MODEL || 'mixed' } = {}) {
  if (dir === null || dir === undefined || dir === '') return null;
  return assembleBrainData(nodeDataIO(dir), { model, where: dir });
}
