// build-web.mjs — assembles the web build of the Studio that the Android app
// (and a plain browser) runs: mobile/www/.   node tools/build-web.mjs [out-dir]
//
// The page is the same code as the desktop app's renderer; only the platform
// bridge differs (renderer/platform/web-api.js instead of Electron's
// preload). What ships, and how it is checked:
//   * the JavaScript modules actually reached from the page and its workers
//     (static imports, dynamic imports, `new URL('./x.js', import.meta.url)`),
//     traced here; a node: or bare import anywhere in that graph fails the
//     build, because the WebView has neither;
//   * the data and anatomy files a release would ship: tracked or new files,
//     never ignored ones, never those marked export-ignore (.gitattributes),
//     exactly the rule the desktop portable build follows;
//   * three.js from node_modules, and every licence notice (licenses/,
//     listed in licenses/index.json for the app's licence viewer);
//   * index.html from renderer/app.html, with the phone viewport and a CSP
//     that allows the page's own files only.
//   * webview-update.html, the Android app's page for WebViews too old for
//     the Studio (capacitor.config.json server.errorPath).
// data/manifest.json and assets/connectomes/manifest.json list every shipped
// file with its size: the web workers read nothing that is not listed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WIN, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'mobile', 'www'));
const ENTRIES = ['renderer/app.js', 'renderer/sim-worker.js', 'renderer/lab-worker.js',
  'renderer/platform/web-data-worker.js', 'renderer/platform/web-specimen-worker.js'];

const rel = (abs) => path.relative(WIN, abs).split(path.sep).join('/');

// ---- which repository files may ship (the portable build's rule) ----
function shippable() {
  const list = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, maxBuffer: 1 << 28 })
    .toString('utf8').split('\0').filter(Boolean);
  const attrs = execFileSync('git', ['check-attr', '-z', '--stdin', 'export-ignore'], { cwd: REPO, input: list.join('\0') + '\0', maxBuffer: 1 << 28 })
    .toString('utf8').split('\0');
  const ignored = new Set();
  for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'set') ignored.add(attrs[i]);
  return new Set(list.filter((f) => !ignored.has(f) && fs.existsSync(path.join(REPO, f))));
}
const SHIP = shippable();
const mayShip = (repoPath) => SHIP.has(repoPath);

// ---- the module graph ----
const IMPORT = /(?:^|[;\s])(?:import|export)\s[^;'"`]*?from\s*(['"])([^'"]+)\1|(?:^|[;\s])import\s*(['"])([^'"]+)\3|import\(\s*(['"])([^'"]+)\5\s*\)|new\s+URL\(\s*(['"])(\.{1,2}\/[^'"]+\.js)\7\s*,\s*import\.meta\.url\s*\)/g;
const modules = new Set();
const problems = [];
function trace(file) {
  const abs = path.resolve(WIN, file);
  const key = rel(abs);
  if (modules.has(key)) return;
  modules.add(key);
  const source = fs.readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of source.matchAll(IMPORT)) {
    const spec = m[2] ?? m[4] ?? m[6] ?? m[8];
    if (!spec) continue;
    if (!spec.startsWith('.')) { problems.push(`${key} imports ${spec}`); continue; }
    trace(path.relative(WIN, path.resolve(path.dirname(abs), spec)));
  }
}
for (const entry of ENTRIES) trace(entry);
if (problems.length) {
  console.error(`The web build cannot load:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// ---- assemble ----
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sizes = { modules: 0, data: 0, anatomy: 0, other: 0 };
function put(from, to, bucket) {
  const target = path.join(OUT, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target);
  sizes[bucket] += fs.statSync(target).size;
}
for (const m of [...modules].sort()) {
  const repoPath = `windows/${m}`;
  if (!m.startsWith('node_modules/') && !mayShip(repoPath)) { console.error(`${repoPath} is reached by the page but would not ship`); process.exit(1); }
  put(path.join(WIN, m), m, 'modules');
}
put(path.join(WIN, 'renderer', 'neurofly.css'), 'renderer/neurofly.css', 'other');
// The Android app shows this instead of the Studio on a WebView too old for it.
put(path.join(WIN, 'renderer', 'platform', 'webview-update.html'), 'webview-update.html', 'other');
for (const f of ['neurocause-symbol.svg', 'neurocause-logo.svg']) put(path.join(WIN, 'assets', 'brand', f), `assets/brand/${f}`, 'other');
// Licence texts, readable in the app (Licences and data sources): the
// Android app's third-party notice (Capacitor, AndroidX, Cordova framework,
// three.js) replaces the desktop one (three.js, Electron).
// mobile/ stays private until the Android app is published: without it
// (the public snapshot) a plain web build carries the desktop notice.
const ANDROID = fs.existsSync(path.join(REPO, 'mobile', 'THIRD_PARTY_NOTICES_ANDROID.md'));
const LICENCES = [
  ['LICENSE', 'LICENSE.txt', 'NeuroCause licence'],
  ['data/DATA_LICENSE.md', 'DATA_LICENSE.md', 'Data licences'],
  ['data/LOCOMOTOR_PROVENANCE.md', 'LOCOMOTOR_PROVENANCE.md', 'Nerve cord data'],
  ...(ANDROID ? [['mobile/THIRD_PARTY_NOTICES_ANDROID.md', 'THIRD_PARTY_NOTICES.md', 'Third-party software'],
    ['mobile/licenses/Apache-2.0.txt', 'Apache-2.0.txt', 'Apache License 2.0']]
    : [['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md', 'Third-party software']]),
  ['windows/node_modules/three/LICENSE', 'three.js-LICENSE.txt', 'three.js licence'],
];
for (const [from, to] of LICENCES) put(path.join(REPO, from), `licenses/${to}`, 'other');
fs.writeFileSync(path.join(OUT, 'licenses', 'index.json'), JSON.stringify({ files: LICENCES.map(([, file, title]) => ({ file, title })) }, null, 1));

// Data and anatomy: what a release ships, listed with sizes.
function copyTree(repoDir, outDir, bucket, accept) {
  const files = {};
  for (const f of [...SHIP].filter((x) => x.startsWith(`${repoDir}/`)).sort()) {
    const inner = f.slice(repoDir.length + 1);
    if (!accept(inner)) continue;
    put(path.join(REPO, f), `${outDir}/${inner}`, bucket);
    files[inner] = fs.statSync(path.join(REPO, f)).size;
  }
  fs.writeFileSync(path.join(OUT, outDir, 'manifest.json'), JSON.stringify({ files }, null, 1));
  return Object.keys(files).length;
}
const dataFiles = copyTree('data', 'data', 'data', (f) => f.endsWith('.json') && !f.startsWith('reservoir/'));
const anatomyFiles = copyTree('windows/assets/connectomes', 'assets/connectomes', 'anatomy', (f) => f.endsWith('.json'));

// index.html: the desktop page, with phone viewport, theme and CSP.
const html = fs.readFileSync(path.join(WIN, 'renderer', 'app.html'), 'utf8');
const csp = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';";
const index = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content">\n<meta name="theme-color" content="#080C0D">\n<meta name="color-scheme" content="dark">\n<meta name="format-detection" content="telephone=no">')
  .replace('href="./neurofly.css"', 'href="./renderer/neurofly.css"')
  .replace('src="./app.js"', 'src="./renderer/app.js"');
if (!index.includes('./renderer/app.js') || !index.includes('./renderer/neurofly.css') || !index.includes(csp)) {
  console.error('renderer/app.html changed shape; update build-web.mjs');
  process.exit(1);
}
fs.writeFileSync(path.join(OUT, 'index.html'), index);

const digest = createHash('sha256');
for (const f of fs.readdirSync(OUT, { recursive: true }).map(String).sort()) {
  const p = path.join(OUT, f);
  if (fs.statSync(p).isFile()) digest.update(f).update(fs.readFileSync(p));
}
fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify({
  builtAt: new Date().toISOString(), modules: modules.size, dataFiles, anatomyFiles, contentSHA256: digest.digest('hex'),
}, null, 1));
const mb = (b) => (b / 1e6).toFixed(1);
console.log(`web build: ${modules.size} modules (${mb(sizes.modules)} MB), ${dataFiles} data files (${mb(sizes.data)} MB), `
  + `${anatomyFiles} anatomy files (${mb(sizes.anatomy)} MB), other ${mb(sizes.other)} MB -> ${OUT}`);
