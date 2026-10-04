// sha256test.js — the WebView's plain-JavaScript SHA-256 (src/sha256.js) must
// give exactly node:crypto's digests: on the FIPS test vectors, on every
// padding boundary, on non-ASCII text (hashed as UTF-8) and on the real data
// files whose checksums the app verifies.   node test/sha256test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/sha256.js';

const node = (x) => createHash('sha256').update(x, typeof x === 'string' ? 'utf8' : undefined).digest('hex');

assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
  '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
for (let n = 0; n < 300; n++) {
  const s = 'x'.repeat(n);
  assert.equal(sha256Hex(s), node(s), `length ${n}`);
}
for (const s of ['Gehirn und Nervenstrang · Zürich', 'Fliege 🪰 ♀ ♂ — 120 Hz', '\u0000￿😀']) {
  assert.equal(sha256Hex(s), node(s));
  assert.equal(sha256Hex(new TextEncoder().encode(s)), node(Buffer.from(s, 'utf8')));
}
const dataDir = fileURLToPath(new URL('../../data/', import.meta.url));
let files = 0, bytes = 0;
for (const sub of ['', 'male', 'female']) {
  for (const name of readdirSync(join(dataDir, sub))) {
    const file = join(dataDir, sub, name);
    if (!name.endsWith('.json') || !statSync(file).isFile()) continue;
    const text = readFileSync(file, 'utf8');
    assert.equal(sha256Hex(text), node(text), file);
    files++; bytes += text.length;
  }
}
console.log(`PASS sha256: FIPS vectors, 300 padding lengths, UTF-8 text, ${files} data files (${(bytes / 1e6).toFixed(1)} MB) match node:crypto`);
