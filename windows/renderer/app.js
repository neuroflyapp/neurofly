// app.js — the NeuroCause page: boots the data, starts the simulation thread, and
// draws what it reports. Everything that simulates lives in the workers
// (sim-worker.js for the live fly, lab-worker.js for experiments); this page
// renders the terrarium and the connectome, hosts the panels, and turns the
// user's actions into commands.

import { SimClient } from './sim-client.js';
import { TerrariumView, arenaBounds } from './view/terrarium.js';
import { BrainView } from './view/brain.js';
import { t, getLanguage, setLanguage, setSubject, untranslated } from './i18n.js';
import { h, icon } from './ui/dom.js';
import { buildShell } from './ui/shell.js';
import { buildDock } from './ui/dock.js';
import { buildInspector } from './ui/inspector.js';
import { buildHud } from './ui/hud.js';
import { livePanel } from './ui/panel-live.js';
import { stimulatePanel } from './ui/panel-stimulate.js';
import { circuitPanel } from './ui/panel-circuit.js';
import { experimentsPanel } from './ui/panel-experiments.js';
import { sentiencePanel } from './ui/panel-sentience.js';
import { dataPanel } from './ui/panel-data.js';
import { modelPanel } from './ui/panel-model.js';
import { specimensPanel } from './ui/panel-specimens.js';
import { AdaptiveRenderQuality, DisplayPacer } from '../src/performance.js';
import { createWebApi } from './platform/web-api.js';
import { setupMobile, wantsMobileLayout } from './ui/mobile.js';
import { ensureTermsAccepted } from './ui/terms.js';

// Electron's preload bridge; in the Android app and in a browser the web
// bridge does the same work in web workers (platform/web-api.js).
const api = window.flyAPI ?? createWebApi();
// A phone gets its own layout (ui/mobile.js); decided before anything is
// measured, because the fly's arena follows the terrarium's size. There the
// arena keeps at least this many scene units on its shorter side.
const MOBILE_MIN_ARENA = 560;
if (wantsMobileLayout()) document.body.classList.add('mobile');
const minArena = () => (document.body.classList.contains('mobile') ? MOBILE_MIN_ARENA : 0);
const bootLine = document.getElementById('bootLine');
const bootBar = document.getElementById('bootBar');
const boot = (text, fraction) => { bootLine.textContent = t(text); bootBar.style.width = `${Math.round(fraction * 100)}%`; };
// A start that cannot go on says why on the boot screen, instead of a bar
// that stops moving.
const bootFailed = (text) => { boot(text, 1); document.getElementById('boot').classList.add('failed'); };
// Both 3D views need WebGL 2 (three.js); some old phones only have WebGL 1.
function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}
document.documentElement.lang = getLanguage();

// ---- shared context for every panel -------------------------------------------------
const ctx = {
  api, t,
  client: null,
  snap: null,
  info: null,
  data: null,
  views: {},
  state: {
    mapVisible: false, mapField: 'occupancy', recordFormat: 'csv', selectedNeuron: null,
    experiments: new Map(),        // protocolId -> { status, fraction, eta, result }
    lastEvents: [],
  },
  listeners: new Set(),
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  command(name, args, opts) { return this.client.command(name, args, opts); },
  request(what, args) { return this.client.request(what, args); },
  toast(message, kind = '') {
    const el = h('div', { class: `toast ${kind}` }, message);
    document.getElementById('toasts').append(el);
    setTimeout(() => el.remove(), 4200);
  },
  async save(kind, payload, okText) {
    try {
      const res = await api?.[kind]?.(payload);
      if (res?.ok) this.toast(okText ?? t('Saved.'), 'ok');
      else if (res?.reason !== 'canceled') this.toast(t('Saving failed: {reason}', { reason: res?.reason ?? t('no access') }), 'err');
      return res;
    } catch (error) {
      this.toast(t('Saving failed: {reason}', { reason: t(error.message) }), 'err');
      return { ok: false };
    }
  },
  highlight(spec) { this.views.brain?.setHighlight(spec); },
  // Touch screen: the hints speak of fingers, not of a mouse.
  touch: matchMedia('(pointer: coarse)').matches,
  // A picture of what is on screen (snapshots outside Electron).
  capturePicture() { return (this.mobile?.brain ? this.views.brain : this.views.terrarium)?.capturePNG?.() ?? null; },
  openExternalLink(url) { return api.openExternal?.(url); },
};
api.attach?.(ctx);

// With NEUROFLY_DEBUG=1 the context is reachable from the dev tools.
if (new URLSearchParams(location.search).get('debug') === '1') window.__nf = Object.assign(ctx, { untranslated });

const panels = [livePanel, stimulatePanel, circuitPanel, experimentsPanel, sentiencePanel, dataPanel, modelPanel, specimensPanel];

(async () => {
  // Start-up phases in milliseconds since the page's own start, kept for
  // diagnosing slow machines (read with window.__nf.bootTimings in debug).
  const bootTimings = ctx.bootTimings = {};
  const mark = (name) => { bootTimings[name] = Math.round(performance.now()); };
  mark('script');
  // Nothing starts before the software terms are accepted (ui/terms.js);
  // declining quits the app.
  boot('Waiting for the software terms…', 0.03);
  await ensureTermsAccepted({
    openExternal: (url) => api.openExternal?.(url),
    quit: () => (api.quitApp ? api.quitApp() : window.close()),
  });
  mark('terms');
  boot('Loading the connectome…', 0.08);
  // As text: one string crosses into the page and on to both workers, each of
  // which parses its own copy (main.js 'brain-data-text').
  const dataText = api.getBrainDataText ? await api.getBrainDataText() : null;
  const data = dataText ? JSON.parse(dataText) : await api.getBrainData();
  ctx.dataText = dataText;
  mark('data');
  if (!data) {
    bootFailed('No connectome data found. Run the ETL scripts first (see README).');
    return;
  }
  if (!hasWebGL2()) {
    bootFailed('This device offers no WebGL 2 graphics, which the 3D terrarium and brain view need.');
    return;
  }
  ctx.data = data;
  // A male fly is "he" in every text from here on (i18n-male.js).
  setSubject(data.provenance?.specimens?.body?.sex);
  boot('Starting the simulation on its own core…', 0.35);
  const client = new SimClient(new URL('./sim-worker.js', import.meta.url));
  ctx.client = client;
  const terrariumEl = document.getElementById('terrarium');
  const bounds = arenaBounds(Math.max(300, terrariumEl.clientWidth), Math.max(200, terrariumEl.clientHeight), minArena());
  let info;
  try {
    info = await client.init(dataText ?? data, bounds, undefined, undefined, { startPaused: true });
  } catch (error) {
    bootFailed(`${t('The simulation could not start:')} ${error.message}`);
    return;
  }
  ctx.info = info;
  mark('worker');
  boot('Building the terrarium and the brain view…', 0.7);

  ctx.views.terrarium = new TerrariumView(terrariumEl, {
    layout: info.layout,
    onPointer: (p) => client.input({ pointer: p }),
    onCommand: (name, args) => client.command(name, args),
    onVision: (v) => client.input({ vision: v }),
    onTap: (p) => client.command('tap', p),
    minArenaSide: minArena(),
  });
  ctx.views.brain = new BrainView(document.getElementById('brain'), {
    points: data.points, circuit: data.circuit,
    onPick: (pick) => {
      client.command('stim.cells', { indices: pick.cluster, strength: 0.25, durationMs: 400, label: t('brain-view stimulation') });
      ctx.state.selectedNeuron = pick.nearest;
      ctx.toast(t('Stimulated {n} neurons near {group}.', { n: pick.cluster.length, group: pick.groupLabel ? t(pick.groupLabel) : t('the click') }));
      for (const fn of ctx.listeners) fn(ctx.snap, { pick });
    },
  });

  mark('views');
  // ---- layout: shell, panels, dock, inspector, HUD ----
  // Mount the complete interface before preparing the GPU. The shell can
  // change the arena's size; warming the old size then resizing after Ready
  // would dispose warmed world materials and compile them again live.
  const shell = buildShell(ctx, panels);
  ctx.shell = shell;
  const dock = buildDock(ctx);
  const inspector = buildInspector(ctx);
  const hud = buildHud(ctx);
  inspector.ready();
  // The arena follows its pane; on a phone it keeps a minimum size, and the
  // on-screen keyboard (which shrinks the page while one types) leaves it as it is.
  const resizeArena = () => { if (ctx.views.terrarium.resize()) client.command('resize', ctx.views.terrarium.bounds); };
  ctx.onLayoutChange = () => { ctx.views.terrarium.minArenaSide = minArena(); };
  setupMobile(ctx, { shell, panels });
  if (ctx.mobile?.active) {
    // Phones: start with a moderate resolution; the adaptive quality raises it
    // when there is headroom. The connectome needs no more than 1.5x. The
    // camera follows the fly, so she is large on a small screen.
    ctx.views.terrarium.setPixelRatio(1);
    while (ctx.views.terrarium.cameraMode !== 'follow') ctx.views.terrarium.toggleCameraMode();
    ctx.views.brain.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  }

  // ---- frames from the simulation ----
  const quality = new AdaptiveRenderQuality({ minPixelRatio: ctx.mobile?.active ? 0.6 : 0.75, maxPixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    ...(ctx.mobile?.active ? { startPixelRatio: 1 } : {}) });
  const pacer = ctx.pacer = new DisplayPacer();
  let fpsFrames = 0, drawnFrames = 0, fpsT = performance.now(), fps = 0;
  const applySnapshot = (snap) => {
    if (snap.paused && bootTimings.initialSnapshot === undefined) mark('initialSnapshot');
    if (!snap.paused && bootTimings.firstFrame === undefined) mark('firstFrame');
    ctx.snap = snap;
    ctx.views.terrarium.applySnapshot(snap);
    ctx.views.brain.addSpikes(snap.spikes);
    ctx.views.brain.setFear(snap.rates);
    if (snap.map) ctx.views.terrarium.paintMap(snap.map);
    if (snap.events.length) {
      ctx.state.lastEvents.push(...snap.events);
      // This is a UI convenience buffer, not the recording or scientific journal.
      if (ctx.state.lastEvents.length > 500) ctx.state.lastEvents.splice(0, ctx.state.lastEvents.length - 500);
    }
    for (const fn of ctx.listeners) fn(snap, {});
  };
  client.onFrame(applySnapshot);

  // Let layout settle while biology remains paused. Preserve the same arena
  // resize command used for later user resizes, and wait for a fresh worker
  // snapshot so the renderer batches the actual resized world before warm-up.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  mark('settled');
  const arenaResized = ctx.views.terrarium.resize();
  if (arenaResized) { await client.command('resize', ctx.views.terrarium.bounds, { reply: true }); mark('resized'); }
  if (arenaResized || !ctx.snap) {
    await new Promise((resolve) => {
      let timeout;
      const stop = client.onFrame((snap) => {
        if (!snap.paused) return;
        stop(); clearTimeout(timeout); resolve();
      });
      // A failing worker must not leave the boot overlay stuck indefinitely.
      timeout = setTimeout(() => { stop(); resolve(); }, 2000);
    });
  }
  if (!ctx.snap && client.latest?.paused) applySnapshot(client.latest);
  mark('layout');

  // Compile the final, snapshot-populated scene behind the boot screen, not
  // during the first neural ticks (bounded for unusually slow GPU drivers).
  boot('Preparing the graphics…', 0.8);
  await Promise.race([
    Promise.all([ctx.views.terrarium.warmUp(), ctx.views.brain.warmUp()]).catch((error) => console.warn('warm-up', error)),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
  mark('warm');

  // Start external inputs only once preparation is complete, as before;
  // a tray resume must not advance biology during shader compilation.
  api.onAmbient((a) => client.input({ ambient: { typing: a.typing, sleepy: a.sleepy, activity: a.activity } }));
  api.onCommand((c) => {
    if (c.name === 'pause') { client.command('pause', { paused: c.value }); }
    else if (['addFly', 'removeFly', 'scareAll'].includes(c.name)) client.command(c.name);
  });

  // ---- render loop (the page draws; it never simulates) ----
  // Paused preparation is not a sample of display performance.
  fpsT = performance.now();
  let last = null;
  const frame = (tMs) => {
    requestAnimationFrame(frame);
    const now = tMs / 1000;
    const dt = last === null ? 1 / 60 : Math.min(0.1, now - last);
    last = now;
    fpsFrames++;
    if (tMs - fpsT >= 1000) {
      fps = fpsFrames * 1000 / (tMs - fpsT);
      ctx.fps = drawnFrames * 1000 / (tMs - fpsT);   // what the observer sees
      fpsFrames = 0; drawnFrames = 0; fpsT = tMs;
      const perf = ctx.snap?.perf;
      const pace = {
        simulationRealtime: perf && !ctx.snap.paused ? Math.min(perf.simulationRealtime / Math.max(0.1, ctx.snap.speed), 1) : 1,
        droppedSecondsPerSecond: ctx.snap?.paused ? 0 : (perf?.droppedSecondsPerSecond ?? 0),
      };
      // Real-time neural pace first: fewer drawn frames, then fewer pixels in
      // the terrarium. The connectome view stays at native resolution.
      ctx.displayStride = pacer.observe(pace);
      const next = quality.observe({ fps, ...pace });
      ctx.views.terrarium.setPixelRatio(next);
      ctx.pixelRatio = next;
    }
    const draw = pacer.shouldDraw();
    if (draw) drawnFrames++;
    ctx.views.terrarium.frame(dt, now, draw);
    // On a phone only the view on screen is drawn (the terrarium's eye keeps sampling).
    if (draw && (!ctx.mobile?.active || ctx.mobile.brain)) ctx.views.brain.frame(tMs);
    dock.frame(dt);
    hud.frame(dt);
  };
  requestAnimationFrame(frame);

  // ---- resize: the terrarium's arena follows its pane ----
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ctx.mobile?.active && document.activeElement?.matches?.('input, textarea, select')) return;
      resizeArena();
    }, 120);
  }).observe(terrariumEl);

  mark('interface');
  boot('Ready.', 1);
  // All views and frame listeners are mounted before the first neural tick.
  // The worker discards paused wall time instead of counting boot work as
  // missing biology; resuming here preserves the normal closed-loop clock.
  client.command('pause', { paused: false });
  setTimeout(() => document.getElementById('boot').classList.add('done'), 250);
  setTimeout(() => document.getElementById('boot').remove(), 900);
  console.info(`NeuroCause: ${data.circuit.neurons.length} brain neurons, ${data.locomotor?.neurons?.length ?? 0} nerve-cord neurons; simulation in a worker at 120 Hz`);

  // language switch rebuilds the interface in place; the simulation continues
  ctx.relabel = (lang) => {
    setLanguage(lang);
    shell.rebuild();
    dock.rebuild();
    inspector.rebuild();
    hud.rebuild();
    ctx.relabelMobile?.();
  };
  void icon;
})().catch((error) => {
  console.error(error);
  bootFailed(`${t('The Studio could not start:')} ${error?.message ?? error}`);
});
