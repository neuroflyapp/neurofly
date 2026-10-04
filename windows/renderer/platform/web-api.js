// web-api.js — the page's platform bridge outside Electron: the Android app
// (Capacitor's WebView) and an ordinary browser. It has the shape of
// preload.cjs's window.flyAPI, so the rest of the page does not know where it
// runs. What Electron's main process does in Node happens here in web
// workers: reading and verifying the fly's data (web-data-worker.js) and the
// anatomy bundles (web-specimen-worker.js), with the same shared code
// (src/data-core.js, src/specimen-store.js) and the same SHA-256 checks.

import { InputDisturbance, circadianActivity } from '../../src/environment.js';

const MODEL_KEY = 'neurocause.flyModel';
const MODELS = ['mixed', 'male', 'female'];
// Literature and project links open outside the app; only these hosts, as in
// Electron's main process.
const LINK_HOSTS = ['doi.org', 'pubmed.ncbi.nlm.nih.gov', 'www.nature.com', 'elifesciences.org', 'www.lse.ac.uk',
  'sites.google.com', 'male-cns.janelia.org', 'codex.flywire.ai', 'flywire.ai', 'neuro-cause.com', 'neurofly.app', 'www.cell.com',
  'dataverse.harvard.edu', 'www.janelia.org', 'connectomics.hms.harvard.edu', 'www.virtualflybrain.org', 'flycellatlas.org',
  'flybase.org', 'zenodo.org'];
// Exports keep Electron's file names (save-io.js) and size limits.
const EXPORTS = {
  saveRecording: { stem: 'neurocause', extension: 'csv', type: 'text/csv', maxBytes: 64 * 1024 * 1024 },
  saveExperiment: { stem: 'neurocause-experiment', extension: 'json', type: 'application/json', maxBytes: 64 * 1024 * 1024 },
  saveLearningRecord: { stem: 'neurocause-learning', extension: 'csv', type: 'text/csv', maxBytes: 64 * 1024 * 1024 },
  saveManifest: { stem: 'neurocause-manifest', extension: 'json', type: 'application/json', maxBytes: 1024 * 1024 },
  saveSnapshot: { stem: 'neurocause', extension: 'png', type: 'image/png' },
};

// Capacitor's native plugins, when the page runs inside the Android app.
const capacitor = () => globalThis.Capacitor;
export const isNativeApp = () => !!capacitor()?.isNativePlatform?.();
const plugin = (name) => (isNativeApp() ? capacitor()?.Plugins?.[name] ?? null : null);

function storedModel() {
  try { const m = localStorage.getItem(MODEL_KEY); return MODELS.includes(m) ? m : 'mixed'; } catch { return 'mixed'; }
}

// One request/answer channel to a module worker.
function workerChannel(url) {
  let worker = null, next = 0;
  const pending = new Map();
  const fail = (error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return {
    call(method, ...args) {
      if (!worker) {
        worker = new Worker(url, { type: 'module' });
        worker.onmessage = ({ data }) => {
          const p = pending.get(data.id);
          if (!p) return;
          pending.delete(data.id);
          if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result);
        };
        worker.onerror = (e) => fail(new Error(e.message || 'worker failed'));
      }
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, method, args });
      });
    },
    close() { fail(new Error('closed')); },
  };
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

function base64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createWebApi() {
  let ctx = null;                 // the page's context, for snapshots and pausing (attach)
  let models = { available: [storedModel()], current: storedModel() };
  const specimens = workerChannel(new URL('./web-specimen-worker.js', import.meta.url));

  // A file leaves the app through Android's share sheet (save to Files or
  // Drive, send, ...): no storage permission, the user picks the place, as
  // the save dialog does on the desktop. In a browser it is a download.
  async function deliver(kind, content) {
    const spec = EXPORTS[kind];
    if (!spec) return { ok: false, reason: 'unsupported-export' };
    let bytes = null, text = null;
    if (kind === 'saveSnapshot') {
      const url = ctx?.capturePicture?.();
      if (!url) return { ok: false, reason: 'empty-snapshot' };
      bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    } else {
      if (typeof content !== 'string' || content.length === 0) return { ok: false, reason: 'empty' };
      if (new Blob([content]).size > spec.maxBytes) return { ok: false, reason: 'too-large' };
      text = content;
    }
    const name = `${spec.stem}-${stamp()}.${spec.extension}`;
    const Filesystem = plugin('Filesystem'), Share = plugin('Share');
    if (Filesystem && Share) {
      const written = await Filesystem.writeFile({
        path: `exports/${name}`, directory: 'CACHE', recursive: true,
        ...(text !== null ? { data: text, encoding: 'utf8' } : { data: base64FromBytes(bytes) }),
      });
      try {
        await Share.share({ title: name, files: [written.uri], dialogTitle: name });
      } catch (error) {
        return /cancel/i.test(String(error?.message ?? error)) ? { ok: false, reason: 'canceled' } : { ok: false, reason: String(error?.message ?? error) };
      }
      return { ok: true, path: name };
    }
    const blob = new Blob([text ?? bytes], { type: spec.type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return { ok: true, path: name };
  }

  const api = {
    platform: isNativeApp() ? 'android' : 'web',
    // The page hands over its context once it exists: snapshots draw its
    // views, and the app pauses the fly while it is in the background.
    attach(pageCtx) {
      ctx = pageCtx;
      // Exports wait in the app's cache only until they are shared; the
      // previous session's are gone from every share sheet by now.
      plugin('Filesystem')?.rmdir?.({ path: 'exports', directory: 'CACHE', recursive: true })?.catch?.(() => {});
    },

    async getBrainDataText() {
      const loader = workerChannel(new URL('./web-data-worker.js', import.meta.url));
      try {
        const result = await loader.call('load', storedModel());
        models = { available: result.available, current: result.model };
        return result.text;
      } finally { loader.close(); }
    },
    async getBrainData() { const text = await api.getBrainDataText(); return text ? JSON.parse(text) : null; },
    async getFlyModels() { return models; },
    async setFlyModel(model) {
      if (!models.available.includes(model)) return false;
      if (models.current === model) return true;
      try { localStorage.setItem(MODEL_KEY, model); } catch { return false; }
      // A new brain means new workers, views and populations: start afresh.
      setTimeout(() => location.reload(), 60);
      return true;
    },

    getSpecimenCatalog: () => specimens.call('catalog'),
    getSpecimenData: (id) => specimens.call('overview', id),
    getSpecimenMorphology: (id, profileId) => specimens.call('morphology', id, profileId),
    getSpecimenCell: (id, neuron, sha256) => specimens.call('cell', id, neuron, sha256),
    getSpecimenPath: (id, query, sha256) => specimens.call('path', id, query, sha256),

    // The fly's ambient senses. On the desktop they come from the operating
    // system's idle timer; here from the app's own input: touching the
    // screen after a quiet spell is the brief disturbance, a long quiet
    // spell (10 min at night, 30 min any time) makes her sleepy.
    onAmbient(fn) {
      let lastInput = performance.now();
      const touched = () => { lastInput = performance.now(); };
      for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        window.addEventListener(type, touched, { capture: true, passive: true });
      }
      const disturbance = new InputDisturbance();
      const dt = 1 / 30;
      setInterval(() => {
        const idleSeconds = Math.floor((performance.now() - lastInput) / 1000);
        const now = new Date();
        const hour = now.getHours() + now.getMinutes() / 60;
        const night = hour >= 22 || hour < 6;
        fn({ typing: disturbance.poll(idleSeconds, dt),
          sleepy: (night && idleSeconds > 600) || idleSeconds > 1800,
          activity: circadianActivity(hour) });
      }, dt * 1000);
    },
    // In the background the app pauses the fly (and her GPU and CPU work)
    // and resumes her when it returns, unless she was paused already.
    // Android reports the app's state itself as well (appStateChange); either
    // signal is enough, and both arriving changes nothing twice.
    onCommand(fn) {
      let pausedByApp = false;
      const background = (away) => {
        if (away) {
          if (!pausedByApp && ctx?.snap && !ctx.snap.paused) { pausedByApp = true; fn({ name: 'pause', value: true }); }
        } else if (pausedByApp) {
          pausedByApp = false;
          fn({ name: 'pause', value: false });
        }
      };
      document.addEventListener('visibilitychange', () => background(document.hidden));
      plugin('App')?.addListener?.('appStateChange', ({ isActive }) => background(!isActive));
    },
    setPaused() {},
    // Declining the software terms ends the app (Android) or leaves the page.
    quitApp() {
      const App = plugin('App');
      if (App?.exitApp) App.exitApp();
      else { window.close(); location.replace('about:blank'); }
    },
    setRecordingState() {},

    saveRecording: (csv) => deliver('saveRecording', csv),
    saveExperiment: (json) => deliver('saveExperiment', json),
    saveLearningRecord: (csv) => deliver('saveLearningRecord', csv),
    saveManifest: (json) => deliver('saveManifest', json),
    saveSnapshot: () => deliver('saveSnapshot'),

    async openExternal(url) {
      let u;
      try { u = new URL(String(url)); } catch { return false; }
      if (u.protocol !== 'https:' || !LINK_HOSTS.includes(u.hostname)) return false;
      const Browser = plugin('Browser');
      if (Browser) await Browser.open({ url: u.toString(), toolbarColor: '#080C0D' });
      else window.open(u.toString(), '_blank', 'noopener');
      return true;
    },
  };
  return api;
}
