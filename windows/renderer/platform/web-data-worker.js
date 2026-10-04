// web-data-worker.js — reads, verifies and merges the fly's data in the
// Android app and in a browser, off the page's thread: the same checks as
// Electron's main process (src/data-core.js), the same SHA-256 checksums.
// The files ship with the app under data/; the build lists them in
// data/manifest.json (windows/tools/build-web.mjs).
//
// data-core.js reads and hashes synchronously, as in Node. So the files a
// model can use (its own folder and the shared top level) are read and
// hashed first, with the platform's native SHA-256 (crypto.subtle, some 25x
// faster than script on a phone); src/sha256.js covers anything else and
// platforms without crypto.subtle. A text is hashed as its exact bytes:
// the BOM is kept and invalid UTF-8 is an error, as Node's checksum sees it.

import { FLY_MODELS, assembleBrainData, availableModels } from '../../src/data-core.js';
import { sha256Hex } from '../../src/sha256.js';

const DATA = new URL('../../data/', import.meta.url);
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function readBytes(rel) {
  const request = new XMLHttpRequest();
  request.open('GET', new URL(rel, DATA), false);
  request.responseType = 'arraybuffer';
  request.send();
  if (request.status !== 200 && request.status !== 0) throw new Error(`${rel}: HTTP ${request.status}`);
  return new Uint8Array(request.response);
}

const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

let manifest = null;
const texts = new Map();        // rel -> text, read ahead
const digests = new Map();      // text -> SHA-256 of its bytes

async function readAhead(rels) {
  const subtle = globalThis.crypto?.subtle;
  for (const rel of rels) {
    if (texts.has(rel)) continue;
    const bytes = readBytes(rel);
    const text = decoder.decode(bytes);
    texts.set(rel, text);
    if (subtle) digests.set(text, hex(await subtle.digest('SHA-256', bytes)));
  }
}

function io() {
  if (!manifest) manifest = JSON.parse(decoder.decode(readBytes('manifest.json')));
  const files = manifest.files || {};
  return {
    exists: (rel) => Object.hasOwn(files, rel),
    read: (rel) => texts.get(rel) ?? decoder.decode(readBytes(rel)),
    sha256: (text) => digests.get(text) ?? sha256Hex(text),
  };
}

onmessage = async ({ data: { id, method, args } }) => {
  try {
    if (method !== 'load') throw new Error('Unknown data operation');
    const files = io();
    const available = availableModels(files);
    const model = available.includes(args[0]) ? args[0] : 'mixed';
    const dir = FLY_MODELS[model]?.dir ?? '';
    await readAhead(Object.keys(manifest.files).filter((rel) => !rel.includes('/') || (dir && rel.startsWith(`${dir}/`))));
    const bundle = assembleBrainData(files, { model, where: 'the app' });
    texts.clear(); digests.clear();
    if (!bundle) throw new Error('The fly data could not be read');
    postMessage({ id, result: { text: JSON.stringify(bundle), available, model } });
  } catch (error) {
    postMessage({ id, error: error?.message ?? String(error) });
  }
};
