// specimen-data.js — Node file access for the anatomy store (Electron's
// specimen worker thread, the tests, the tools). The store itself is
// platform-neutral (specimen-store.js), shared with the Android build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createSpecimenStoreWith } from './specimen-store.js';

const DEFAULT = fileURLToPath(new URL('../assets/connectomes/', import.meta.url));

export function nodeSpecimenIO(dir = DEFAULT) {
  const at = (rel) => path.join(dir, rel);
  return {
    exists: (rel) => fs.existsSync(at(rel)),
    size: (rel) => fs.statSync(at(rel)).size,
    readBytes: (rel) => fs.readFileSync(at(rel)),
    readText: (rel) => fs.readFileSync(at(rel), 'utf8'),
    sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  };
}

export function createSpecimenStore(dir = DEFAULT) {
  return createSpecimenStoreWith(nodeSpecimenIO(dir));
}
