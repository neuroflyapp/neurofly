// webbuildtest.mjs — the web build (what the Android app carries) is complete
// and gives the same fly as the desktop app.   node test/webbuildtest.mjs
//
// Builds into a temporary folder with tools/build-web.mjs, then:
//   * assembles every fly model (mixed, male, female) from the BUILT data
//     folder only, through its manifest, exactly as web-data-worker.js does,
//     and requires the bundle to be byte-identical with Electron's
//     (src/data.js reading the repository): a file the build forgot, or a
//     shipped file that differs, fails here;
//   * checks the page: CSP, entry points, the WebView fallback page, the
//     licence set and that every anatomy file listed exists with its size.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBrainData, availableModels } from '../src/data-core.js';
import { loadBrainData } from '../src/data.js';
import { sha256Hex } from '../src/sha256.js';

const WIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'neurocause-web-'));
const hash = (s) => createHash('sha256').update(s).digest('hex');

try {
  execFileSync(process.execPath, [path.join(WIN, 'tools', 'build-web.mjs'), OUT], { stdio: 'pipe' });

  // ---- the fly data, from the build alone ----
  const dataDir = path.join(OUT, 'data');
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8')).files;
  for (const [rel, size] of Object.entries(manifest)) {
    assert.equal(fs.statSync(path.join(dataDir, rel)).size, size, `data/${rel}: size in the manifest`);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const io = {
    exists: (rel) => Object.hasOwn(manifest, rel),
    read: (rel) => decoder.decode(fs.readFileSync(path.join(dataDir, rel))),
    sha256: (text) => sha256Hex(text),
  };
  const models = availableModels(io);
  assert.deepEqual(models, ['mixed', 'male', 'female'], 'all three fly models ship');
  for (const model of models) {
    const web = JSON.stringify(assembleBrainData(io, { model, where: 'the app' }));
    const desktop = JSON.stringify(loadBrainData(undefined, { model }));
    assert.equal(hash(web), hash(desktop), `${model}: web bundle equals the desktop bundle`);
    console.log(`  ${model}: ${(web.length / 1e6).toFixed(1)} MB bundle, identical to the desktop app's`);
  }

  // ---- the page ----
  const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  assert.match(index, /Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
  assert.match(index, /connect-src 'self'/, 'the page may load nothing from elsewhere');
  assert.match(index, /viewport-fit=cover/);
  for (const ref of ['renderer/app.js', 'renderer/neurofly.css', 'renderer/sim-worker.js', 'renderer/lab-worker.js',
    'renderer/platform/web-data-worker.js', 'renderer/platform/web-specimen-worker.js', 'node_modules/three/build/three.module.js',
    'webview-update.html', 'assets/brand/neurocause-symbol.svg']) {
    assert.ok(fs.existsSync(path.join(OUT, ref)), `${ref} ships`);
  }
  const licences = JSON.parse(fs.readFileSync(path.join(OUT, 'licenses', 'index.json'), 'utf8')).files;
  for (const { file } of licences) assert.ok(fs.statSync(path.join(OUT, 'licenses', file)).size > 500, `licenses/${file}`);
  assert.ok(licences.some((l) => l.file === 'DATA_LICENSE.md'), 'data attribution ships');

  // ---- the anatomy explorer ----
  const anatomy = path.join(OUT, 'assets', 'connectomes');
  const atlas = JSON.parse(fs.readFileSync(path.join(anatomy, 'manifest.json'), 'utf8')).files;
  assert.ok(Object.keys(atlas).length > 10, 'anatomy bundles ship');
  for (const [rel, size] of Object.entries(atlas)) assert.equal(fs.statSync(path.join(anatomy, rel)).size, size, `connectomes/${rel}`);
  for (const rel of Object.keys(atlas)) assert.ok(!/hemibrain|l1em/.test(rel), `${rel} is export-ignored and must not ship`);

  console.log(`web build complete: ${Object.keys(manifest).length} data files, ${Object.keys(atlas).length} anatomy files, ${licences.length} licence texts`);
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}
