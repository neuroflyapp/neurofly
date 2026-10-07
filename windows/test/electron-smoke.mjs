// electron-smoke.mjs — end-to-end smoke test of NeuroCause Studio in real
// Electron: the actual main process, preload, renderer, simulation worker and
// GPU views, in a throwaway profile.
//   npm run uitest            (electron test/electron-smoke.mjs)
//   NEUROFLY_TEST_OUTPUT=dir  also saves a screenshot of each workspace
//
// The page is driven only through DOM calls (element.click(), synthetic key
// events) — never OS-level mouse or keyboard input — so it cannot disturb a
// NeuroCause session the user has open. The fresh user-data directory gives the test its
// own single-instance lock.

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The test window may open behind other applications. Chromium would then
// stop rendering it, and the snapshots every check reads would go stale.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-ui-'));
app.setPath('userData', profile);
process.env.NEUROFLY_DEBUG = '1';           // exposes window.__nf, the renderer context
const outDir = process.env.NEUROFLY_TEST_OUTPUT || null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
function report(ok, name, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') pageErrors.push(String(event.message).slice(0, 300));
  });
  win.webContents.on('render-process-gone', (_ev, d) => pageErrors.push(`renderer gone: ${d.reason}`));
  win.webContents.once('did-finish-load', () => {
    run(win).catch((e) => report(false, 'harness', e.stack || e.message)).finally(finish);
  });
});

const js = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
async function waitFor(win, code, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await js(win, code); if (v) return v; } catch { /* page still loading */ }
    await sleep(100);
  }
  return null;
}
async function shot(win, name) {
  if (!outDir) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
}

async function run(win) {
  // A fresh profile must show the software terms before anything starts:
  // Accept stays disabled until the box is ticked, and nothing boots before.
  const termsShown = await waitFor(win, `return document.getElementById('terms')?.open === true;`, 30000);
  const termsGate = termsShown ? await js(win, `const acc = document.getElementById('termsAccept');
    const disabledFirst = acc.disabled; acc.click();
    const stillOpen = document.getElementById('terms')?.open === true && !window.__nf?.snap;
    document.getElementById('termsAgree').click();
    const enabled = !acc.disabled; acc.click();
    return { disabledFirst, stillOpen, enabled, gone: !document.getElementById('terms'),
      stored: JSON.parse(localStorage.getItem('neurocause.termsAccepted') || 'null') };`) : null;
  report(!!termsGate && termsGate.disabledFirst && termsGate.stillOpen && termsGate.enabled && termsGate.gone && !!termsGate.stored?.version,
    'the software terms must be accepted before the Studio starts',
    termsGate ? `accept disabled until ticked: ${termsGate.disabledFirst}; nothing ran before: ${termsGate.stillOpen}; stored version ${termsGate.stored?.version}` : 'no terms dialog on a fresh profile');
  const booted = await waitFor(win, `return !!(window.__nf?.bootTimings?.interface && window.__nf?.snap && !window.__nf.snap.paused && document.querySelector('#rail button'))`, 90000);
  report(!!booted, 'the Studio boots and the simulation worker delivers frames', booted ? 'first snapshot received' : 'no snapshot within 90 s');
  if (!booted) return;
  const preparation = await js(win, `const b = __nf.bootTimings; const el = document.getElementById('terrarium'); const bounds = __nf.views.terrarium.bounds;
    return { b, width: bounds.width, height: bounds.height, paneWidth: Math.max(100, el.clientWidth), paneHeight: Math.max(100, el.clientHeight), batched: !!__nf.views.terrarium.world.batch };`);
  report(preparation.b.initialSnapshot <= preparation.b.layout
    && preparation.b.layout <= preparation.b.warm && preparation.b.warm <= preparation.b.interface
    && preparation.b.interface <= preparation.b.firstFrame
    && preparation.batched
    && preparation.width === preparation.paneWidth && preparation.height === preparation.paneHeight,
  'the final arena and paused world are prepared before graphics and neural time start',
    `snapshot ${preparation.b.initialSnapshot} → layout ${preparation.b.layout} → graphics ${preparation.b.warm} → ready ${preparation.b.interface} → live ${preparation.b.firstFrame} ms; arena ${preparation.width}×${preparation.height}`);
  // A fresh profile shows the quick guide 1.4 s after the interface is built,
  // and keyboard shortcuts are off while it is open. Since start-up got
  // faster the first snapshot can arrive before it: wait for it, then close.
  await waitFor(win, `return document.getElementById('help')?.open === true;`, 5000);
  await js(win, `document.getElementById('help')?.close(); return true;`);

  const info = await js(win, `const d = __nf.data; return { brain: d.circuit.neurons.length, cord: d.locomotor?.neurons?.length ?? 0 };`);
  report(info.brain > 7000 && info.cord === 1045, 'the full circuit is loaded', `${info.brain} brain neurons, ${info.cord} nerve-cord neurons`);

  // Right after boot the simulation competes with the anatomy workers loading
  // their bundles and with both 3D views building, and lags behind. What is
  // checked is that it keeps pace once it runs: the first of up to six 3 s
  // windows at 0.4x real time or better.
  const clock = `return { ms: __nf.snap.neuralMs, at: performance.now() };`;
  let neural = 0, wall = 1, windows = 0;
  while (windows < 6 && !(neural > 0.4 * wall)) {
    const t0 = await js(win, clock);
    await sleep(3000);
    const t1 = await js(win, clock);
    neural = t1.ms - t0.ms; wall = t1.at - t0.at; windows++;
  }
  report(neural > 0.4 * wall, 'neural time advances at least 0.4× wall-clock speed',
    `${Math.round(neural)} ms of neural time in ${(wall / 1000).toFixed(1)} s wall time (window ${windows})`);
  // Left alone, the live fly must not keep fleeing things that are not there.
  // Only this run sees her rendered eye and the operating-system senses; with
  // them, self-motion, a size-blind firefly term and tonic "typing" sound once
  // made her take off ~9 times per 20 s with nothing approaching (VALIDATION.md,
  // 30 September 2026). Expected now: ~0.4 per 20 s.
  await js(win, `__nf.client.input({ pointer: null }); __nf.state.lastEvents.length = 0; return true;`);
  await sleep(30000);
  const phantom = await js(win, `return __nf.state.lastEvents.filter((e) => e.kind === 'takeoff'
    && ['loomL', 'loomR', 'sound', 'puff'].includes(e.trigger?.channel)).map((e) => e.trigger.channel);`);
  report(phantom.length <= 4, 'the untouched live fly does not flee phantom threats',
    `${phantom.length} sensory takeoffs in 30 s${phantom.length ? ` (${phantom.join(', ')})` : ''}`);

  // The connectome view is cheap and must stay sharp: native resolution even
  // while the terrarium lowers its own under load.
  const renderQuality = await js(win, `return { brain: __nf.views.brain.pixelRatio, native: Math.min(Math.max(devicePixelRatio, 1), 2), terrarium: __nf.pixelRatio };`);
  report(Math.abs(renderQuality.brain - renderQuality.native) < 0.001,
    'the connectome view keeps its native resolution',
    `${renderQuality.brain?.toFixed(2)}× connectome (native ${renderQuality.native?.toFixed(2)}×), ${renderQuality.terrarium?.toFixed(2)}× terrarium`);

  const cameraModes = await js(win, `const v = __nf.views.terrarium; const controls = document.querySelectorAll('#hud .hud-tr button'); const result = [];
    for (let i = 0; i < 4; i++) { result.push({ mode: v.cameraMode, label: controls[0].textContent.trim() }); controls[0].click(); }
    controls[0].click(); controls[1].click(); const zoomed = v.orbit.zoom < 1;
    controls[3].click(); return { result, expected: document.documentElement.lang.startsWith('de')
      ? ['Übersicht', 'Folgekamera', 'Nahaufnahme', 'Draufsicht']
      : ['Overview', 'Follow cam', 'Close cam', 'Overhead'],
      zoomed, resetMode: v.cameraMode, resetZoom: v.orbit.zoom };`);
  report(cameraModes.result.map((x) => x.mode).join(',') === 'overview,follow,close,overhead'
    && cameraModes.result.every((x, i) => x.label === cameraModes.expected[i])
    && cameraModes.zoomed && cameraModes.resetMode === 'overview' && cameraModes.resetZoom === 1,
  'all four terrarium cameras have correct labels, zoom and reset',
  `${cameraModes.result.map((x) => `${x.mode}:${x.label}`).join(', ')}; reset=${cameraModes.resetMode}/${cameraModes.resetZoom}`);

  const directCamera=await js(win,`const v=__nf.views.terrarium;const out=[];
    for(const mode of ['close','overhead','follow','overview']){document.querySelector('[data-camera-mode="'+mode+'"]').click();out.push(v.cameraMode===mode);}
    v.setCameraMode('invalid');return out.every(Boolean)&&v.cameraMode==='overview';`);
  report(directCamera,'direct camera presets select all four observer views and reject unknown modes',String(directCamera));

  // The real eye pass must be byte-identical when only observer controls
  // change. Freeze the worker and the view animation, drain old eye reads,
  // then use _renderEye itself. Suppressing _processEye during these manual
  // captures prevents the test images from becoming sensory inputs. Restore
  // its pixels/time afterwards so normal sampling resumes without a fake cue.
  const eye = await js(win, `
    await __nf.command('pause', { paused: true }, { reply: true });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (predicate) => {
      const end = performance.now() + 6000;
      while (!predicate()) { if (performance.now() > end) throw new Error('eye test timeout'); await wait(10); }
    };
    await until(() => __nf.snap.paused);
    const v = __nf.views.terrarium, r = v.renderer;
    const saved = { frame: v.frame, enabled: v.visionEnabled, process: v._processEye,
      onVision: v.onVision, mode: v.cameraMode, brightness: v.viewBrightness,
      map: v.mapOverlay.visible, mapPixels: v.mapTexData.slice(), shadowUpdate: r.shadowMap.needsUpdate };
    let inputs = 0;
    try {
      v.visionEnabled = false; v.frame = () => {};
      await until(() => v.eyeReads.length === 0);
      saved.pixels = v.visionPixels.slice(); saved.imageT = v.eyeImageT;
      v._processEye = () => {}; v.onVision = () => { inputs++; };
      // A saturated, opaque test overlay makes leakage detectable even if
      // the real occupancy map has not collected any visits yet.
      v.mapTexData.fill(255); v.mapTexture.needsUpdate = true;
      const display = () => {
        v._applyFov();
        if (v.cameraMode === 'follow' || v.cameraMode === 'close') v._updateFollowCamera(10);
        else if (v.cameraMode === 'overhead') v._updateOverheadCamera(10);
        else v.placeCamera();
        v._lookFor('display'); r.shadowMap.needsUpdate = true; r.render(v.scene, v.camera);
      };
      const capture = async () => {
        if (!v._renderEye()) throw new Error('eye pass could not start');
        const read = v.eyeReads.at(-1);
        await until(() => read.done);
        if (!read.ok) throw new Error('eye readback failed');
        return v.visionPixels.slice();
      };
      display(); const reference = await capture();
      let changed = 0, maxDelta = 0;
      for (const mode of ['overview', 'follow', 'close', 'overhead']) {
        for (const brightness of [0.5, 2.5]) {
          v.cameraMode = mode; v.setViewBrightness(brightness); v.setMapVisible(brightness === 2.5);
          display(); const pixels = await capture();
          for (let i = 0; i < pixels.length; i++) {
            const delta = Math.abs(pixels[i] - reference[i]);
            if (delta) changed++; maxDelta = Math.max(maxDelta, delta);
          }
        }
      }
      const colors = new Set();
      for (let i = 0; i < reference.length; i += 4) colors.add(reference[i] * 65536 + reference[i + 1] * 256 + reference[i + 2]);
      return { changed, maxDelta, inputs, colors: colors.size, bytes: reference.length, cases: 8 };
    } finally {
      v._processEye = saved.process; v.onVision = saved.onVision;
      if (saved.pixels) { v.visionPixels.set(saved.pixels); v.eyeImageT = saved.imageT; }
      v.cameraMode = saved.mode; v.setViewBrightness(saved.brightness); v.setMapVisible(saved.map);
      v.mapTexData.set(saved.mapPixels); v.mapTexture.needsUpdate = true;
      r.setRenderTarget(null); v._lookFor('display'); r.shadowMap.needsUpdate = saved.shadowUpdate;
      v.frame = saved.frame; v.visionEnabled = saved.enabled;
      await __nf.command('pause', { paused: false }, { reply: true });
    }
  `);
  report(eye.changed === 0 && eye.inputs === 0 && eye.colors > 1,
    'observer cameras, brightness and map never change the actual eye pixels',
    `${eye.cases} cases × ${eye.bytes} bytes; ${eye.changed} differences, max delta ${eye.maxDelta}; ${eye.inputs} generated sensory inputs; ${eye.colors} scene colours`);

  // Exercise the actual worker boundary: the old run's GPU result can arrive
  // after respawn but before the renderer knows its new identity.
  const retinalRun = await js(win, `
    await __nf.command('pause', { paused: true }, { reply: true });
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const until = async predicate => {
      const end = performance.now() + 6000;
      while (!predicate()) { if (performance.now() > end) throw new Error('retinal run test timeout'); await wait(20); }
    };
    await until(() => __nf.snap.paused);
    const old = { neuralRun: __nf.snap.neuralRun, individual: __nf.snap.individual };
    try {
      await __nf.command('respawn', { seed: 62432 }, { reply: true });
      __nf.client.input({ vision: { ...old, L: 1, R: 1 } });
      await until(() => __nf.snap.neuralRun !== old.neuralRun);
      await wait(150);
      const rejected = __nf.snap.inputs.visionL === 0 && __nf.snap.inputs.visionR === 0;
      const current = { neuralRun: __nf.snap.neuralRun, individual: __nf.snap.individual };
      __nf.client.input({ vision: { ...current, L: 0.05, R: 0.07 } });
      await until(() => __nf.snap.inputs.visionL === 0.05 && __nf.snap.inputs.visionR === 0.07);
      return { rejected, currentAccepted: true, oldRun: old.neuralRun, newRun: current.neuralRun };
    } finally {
      __nf.client.input({ vision: { neuralRun: __nf.snap.neuralRun, individual: __nf.snap.individual, L: 0, R: 0 } });
      await __nf.command('pause', { paused: false }, { reply: true });
    }
  `);
  report(retinalRun.rejected && retinalRun.currentAccepted,
    'the worker rejects an old animal retinal frame and accepts the current run', JSON.stringify(retinalRun));

  for (const mode of ['follow', 'close']) {
    await js(win, `const v = __nf.views.terrarium; while (v.cameraMode !== '${mode}') document.querySelector('#hud .hud-tr button').click(); return true;`);
    await sleep(800);
    await shot(win, `camera-${mode}`);
  }
  await js(win, `document.querySelectorAll('#hud .hud-tr button')[3].click(); return true;`);

  await js(win, `document.getElementById('focusMode').click(); return true;`);
  const focused = await js(win, `return document.body.classList.contains('focus-mode') && document.getElementById('focusMode').getAttribute('aria-pressed') === 'true' && getComputedStyle(document.getElementById('panel')).display === 'none';`);
  report(focused, 'focus view hides workspace chrome while preserving the live stage', String(focused));
  await sleep(700);
  await shot(win, 'focus-view');
  await js(win, `document.getElementById('focusMode').click(); return true;`);
  await js(win, `document.body.classList.add('inspector-collapsed'); document.getElementById('focusMode').click(); return true;`);
  const focusRestoresInspector = await js(win, `return getComputedStyle(document.getElementById('inspector')).display !== 'none';`);
  report(focusRestoresInspector, 'focus view reveals the connectome even if the inspector was hidden', String(focusRestoresInspector));
  await js(win, `document.getElementById('focusMode').click(); document.body.classList.remove('inspector-collapsed'); return true;`);

  // Every workspace mounts with content and without errors.
  const count = await js(win, `return document.querySelectorAll('#rail button').length;`);
  for (let i = 0; i < count; i++) {
    const errorsBefore = pageErrors.length;
    await js(win, `document.querySelectorAll('#rail button')[${i}].click(); return true;`);
    const specimens = await js(win, `return __nf.shell && document.querySelectorAll('#rail button')[${i}].getAttribute('aria-selected') === 'true';`);
    // The anatomy workspace loads its catalog from a background worker.
    const text = await waitFor(win, `const el = document.querySelector('#panel'); const s = el?.innerText ?? ''; return s.length > 80 ? s.slice(0, 60).replace(/\\s+/g, ' ') : null;`, 20000);
    await sleep(400);
    await shot(win, `workspace-${i + 1}`);
    report(!!text && specimens && pageErrors.length === errorsBefore, `workspace ${i + 1} mounts`, text ? `"${text}…"` : 'empty panel');
    // Nothing in the workspace column is wider than the column: a label that
    // cannot wrap pushed buttons out of view (German pharmacology presets).
    const overflow = await js(win, `const box = document.getElementById('panel'); const right = box.getBoundingClientRect().right;
      const wide = [...box.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > right + 1; });
      return { scroll: box.scrollWidth - box.clientWidth, first: wide[0] ? (wide[0].textContent || wide[0].tagName).trim().slice(0, 40) : null };`);
    report(overflow.scroll <= 0 && !overflow.first, `workspace ${i + 1} fits its column`,
      overflow.first ? `"${overflow.first}" sticks out (${overflow.scroll} px)` : 'nothing wider than the panel');
    if (i === 8) {
      // The Habitat game plays with the live fly: its Feed button puts a real
      // drop into the simulation, its layer sits over the terrarium, and
      // every tab builds.
      const game = await js(win, `const food0 = __nf.snap.food.length;
        const feed = [...document.querySelectorAll('#panel .hab-act')][0];
        feed.click();
        await new Promise((r) => setTimeout(r, 900));
        const tabs = [];
        for (const tab of document.querySelectorAll('#panel .hab-tab')) {
          tab.click();
          await new Promise((r) => setTimeout(r, 300));
          tabs.push(document.querySelector('#panel .hab-tab-body').children.length);
        }
        document.querySelector('#panel .hab-tab').click();
        return { gauges: document.querySelectorAll('#panel .hab-gauge').length, overlay: !!document.querySelector('#terrarium .hab-overlay'),
          food: __nf.snap.food.length - food0, tabs, name: document.querySelector('#panel .hab-name')?.textContent };`);
      report(game.gauges === 4 && game.overlay && game.food === 1 && game.tabs.length === 5 && game.tabs.every((n) => n > 0) && pageErrors.length === errorsBefore,
        'Habitat game: care gauges, terrarium layer, Feed drops real sugar, all five tabs build', JSON.stringify(game));
    }
    if (i === 6) {
      const timing = await js(win, `const s = document.querySelector('#panel .timing-status'); return { state: s?.dataset.state, rows: document.querySelectorAll('#panel .timing-status ~ .kv dd').length, message: s?.textContent };`);
      report(['paused', 'gap', 'measuring', 'behind', 'on-pace'].includes(timing.state)
        && timing.rows === 10 && !!timing.message,
      'the Model workspace exposes numerical run quality and lost simulation time',
      `${timing.state || 'missing'}; ${timing.rows} metric values`);
    }
    if (i === 7) {
      const rawAudit = await js(win, `const c = await __nf.api.getSpecimenCatalog(); return { expected: c.rawSources?.verifiedFiles ?? null, text: document.querySelector('[data-testid="raw-source-audit"]')?.textContent ?? '' };`);
      report(rawAudit.expected === null || rawAudit.text.includes(String(rawAudit.expected)),
        'the anatomy workspace shows the optional offline raw-data audit',
        rawAudit.expected === null ? 'no local snapshot packaged' : `${rawAudit.expected} checksum-matching files`);
      if (rawAudit.expected !== null) {
        await js(win, `const el = document.querySelector('[data-testid="raw-source-audit"]'); el.scrollIntoView({ block: 'start' }); el.querySelector('details').open = true; return true;`);
        await sleep(150);
        await shot(win, 'raw-data-audit');
      }
    }
  }

  // Pause freezes neural time; resume continues it. (Shortcuts are off while
  // the quick guide is open; the detail says so if that is why it fails.)
  const guideOpen = await js(win, `return !!document.getElementById('help')?.open;`);
  await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); return true;`);
  const paused = await waitFor(win, `return __nf.snap.paused ? __nf.snap.neuralMs : null;`, 3000);
  await sleep(800);
  const stillPaused = await js(win, `return __nf.snap.neuralMs;`);
  await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); return true;`);
  const resumed = await waitFor(win, `return !__nf.snap.paused;`, 3000);
  report(paused !== null && Math.abs(stillPaused - paused) < 1 && !!resumed, 'Space pauses and resumes the whole simulation',
    `paused at ${Math.round(paused ?? -1)} ms, ${Math.round(stillPaused)} ms after 0.8 s, resumed ${!!resumed}${guideOpen ? ' (quick guide was open)' : ''}`);

  // The language toggle relabels the interface without restarting the run.
  const before = await js(win, `return { lang: document.documentElement.lang, rail: document.querySelector('#rail').innerText, ms: __nf.snap.neuralMs };`);
  await js(win, `[...document.querySelectorAll('.topbar button, header button')].find((b) => /^(DE|EN)$/.test(b.textContent.trim()))?.click(); return true;`);
  const after = await waitFor(win, `const r = document.querySelector('#rail').innerText; return r !== ${JSON.stringify(before.rail)} ? { lang: document.documentElement.lang, rail: r, ms: __nf.snap.neuralMs } : null;`, 5000);
  report(!!after && after.lang !== before.lang && after.ms >= before.ms, 'the language toggle relabels the interface and keeps the run',
    after ? `${before.lang} -> ${after.lang}, neural time kept (${Math.round(before.ms)} -> ${Math.round(after.ms)} ms)` : 'labels unchanged');
  // In German, every workspace finds a translation for every text it shows
  // (the static check in tools/check-i18n.mjs cannot see texts that reach
  // t() through variables).
  if (after) {
    const toggle = `[...document.querySelectorAll('.topbar button, header button')].find((b) => /^(DE|EN)$/.test(b.textContent.trim()))?.click(); return true;`;
    if (after.lang !== 'de') await js(win, toggle);
    await js(win, `__nf.untranslated.clear(); return true;`);
    for (let i = 0; i < count; i++) {
      await js(win, `document.querySelectorAll('#rail button')[${i}].click(); return true;`);
      await waitFor(win, `return (document.querySelector('#panel')?.innerText ?? '').length > 80;`, 20000);
      await sleep(600);
    }
    // symbols and numbers ("♀ / ♂") need no translation
    const missing = await js(win, `return document.documentElement.lang === 'de' ? [...__nf.untranslated].filter((s) => /[A-Za-z]/.test(s)) : null;`);
    report(Array.isArray(missing) && missing.length === 0, 'every workspace is fully translated into German',
      missing === null ? 'German not active' : missing.length ? missing.slice(0, 8).map((s) => JSON.stringify(s.slice(0, 70))).join(' | ') : 'no untranslated text');
    await js(win, `document.querySelectorAll('#rail button')[0].click(); return true;`);
    if (before.lang !== 'de') await js(win, toggle);
  }

  // A loom makes her take off, and the event arrives with its causal chain.
  // The live fly is not seeded for this test and may already be airborne, so
  // wait until she is on the ground, and allow up to three attempts.
  let takeoff = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitFor(win, `return __nf.snap.fly.state !== 'flying';`, 15000);
    await js(win, `__nf.state.lastEvents.length = 0; __nf.command('stim.loom', { strength: 1 }); return true;`);
    takeoff = await waitFor(win, `return __nf.state.lastEvents.find((e) => e.kind === 'takeoff') ?? null;`, 4000);
    if (takeoff && ['stim', 'loomL', 'loomR'].includes(takeoff.trigger?.channel) && takeoff.command?.group === 'gf') break;
  }
  report(!!takeoff && ['stim', 'loomL', 'loomR'].includes(takeoff.trigger?.channel) && takeoff.command?.group === 'gf',
    'a loom triggers a takeoff with a traced causal chain',
    takeoff ? `trigger ${takeoff.trigger?.channel}, giant fiber ${takeoff.command?.spikes} spikes, top input ${takeoff.inputs?.[0]?.source}` : 'no takeoff within 5 s');
  const why = await waitFor(win, `return document.querySelector('.why-list')?.innerText?.length > 10;`, 3000);
  report(!!why, 'the explanation panel lists the event', why ? 'entry shown' : 'explanation panel empty');
  await shot(win, 'after-loom');

  report(pageErrors.length === 0, 'no page errors during the whole run', pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none');
}

function finish() {
  console.log(failures === 0 ? 'ALL UI TESTS PASS' : `${failures} FAILURES`);
  app.isQuitting = true;
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked files are left for the OS */ }
  app.exit(failures === 0 ? 0 : 1);
}

process.chdir(path.join(HERE, '..'));
await import('../main.js');
