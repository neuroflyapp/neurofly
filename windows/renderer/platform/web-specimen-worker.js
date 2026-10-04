// web-specimen-worker.js — the anatomy explorer's bundles in the Android app
// and in a browser: the same store as Electron's specimen worker thread
// (src/specimen-store.js), the same checksums, fixed paths only. The bundles
// ship under assets/connectomes/, listed with their sizes in its
// manifest.json (windows/tools/build-web.mjs).

import { createSpecimenStoreWith } from '../../src/specimen-store.js';
import { sha256Hex } from '../../src/sha256.js';

const BASE = new URL('../../assets/connectomes/', import.meta.url);

function readBytes(rel) {
  const request = new XMLHttpRequest();
  request.open('GET', new URL(rel, BASE), false);
  request.responseType = 'arraybuffer';
  request.send();
  if (request.status !== 200 && request.status !== 0) throw new Error(`${rel}: HTTP ${request.status}`);
  return new Uint8Array(request.response);
}

let files = null;
const listed = () => (files ??= JSON.parse(new TextDecoder().decode(readBytes('manifest.json'))).files || {});
const store = createSpecimenStoreWith({
  exists: (rel) => Object.hasOwn(listed(), rel),
  size: (rel) => { if (!Object.hasOwn(listed(), rel)) throw new Error(`${rel} is not part of the app`); return listed()[rel]; },
  readBytes,
  readText: (rel) => new TextDecoder().decode(readBytes(rel)),
  sha256: (bytes) => sha256Hex(bytes),
});
const allowed = new Set(['catalog', 'overview', 'cell', 'path', 'morphology']);

onmessage = ({ data: { id, method, args } }) => {
  try {
    if (!allowed.has(method)) throw new Error('Unknown specimen operation');
    postMessage({ id, result: store[method](...args) });
  } catch (error) {
    postMessage({ id, error: error?.message ?? String(error) });
  }
};
