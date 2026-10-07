// main.js — the Electron main process. One window now: the fly's terrarium
// and its brain/control panel live on the same page (see renderer/app.js),
// so this file only does what a normal Electron main process does — own the
// window and tray, load the connectome data from disk, and forward the few
// signals that genuinely need OS access (idle timer, CPU load) to the page.
//
// There is no more desktop overlay: no window-terrain polling, no global
// mouse hook, no per-monitor scene mapping. Those existed only so a
// click-through fullscreen overlay could sense a desktop it wasn't allowed
// to receive normal input from. A regular window gets normal input.

import { app, BrowserWindow, Tray, Menu, powerMonitor, nativeImage, ipcMain, dialog, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

import { loadBrainData, availableFlyModels } from './src/data.js';
import { createSpecimenService } from './src/specimen-service.js';
import { circadianActivity, InputDisturbance } from './src/environment.js';
import { createSaveService } from './src/save-io.js';
import { recordingState, recordingExitPolicy } from './src/recording-guard.js';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const DEBUG = !!process.env.NEUROFLY_DEBUG;
// Settings stay in the folder the app has always used (%APPDATA%\NeuroFly,
// from its former name), so existing preferences carry over to NeuroCause.
// Only Electron's default is replaced: a caller that chose its own folder (the
// UI test, --user-data-dir) keeps it. This comes first: the lock lives there.
if (app.getPath('userData') === join(app.getPath('appData'), app.getName())) {
  app.setPath('userData', join(app.getPath('appData'), 'NeuroFly'));
}
// A second launch must not create a second hidden simulation and GPU context.
// Electron scopes this lock to the user-data directory (isolated tests use their own).
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

let win = null;
let tray = null;
let paused = false;
const disturbance = new InputDisturbance();
let recordingStatus = recordingState();
let quitApproved = false;
// Main-process texts follow the system language (the renderer's own
// language switch cannot reach the tray and native dialogs).
const tr = (en, de) => (app.getLocale().toLowerCase().startsWith('de') ? de : en);
function allowRecordingExit(action) {
  const policy = recordingExitPolicy(recordingStatus);
  if (policy === 'allow') return true;
  if (!win || win.isDestroyed()) return false;
  win.show(); win.focus();
  if (policy === 'wait') {
    dialog.showMessageBoxSync(win, { type: 'info', title: tr('Saving in progress', 'Speichern läuft'),
      message: tr('Please wait until the current save has finished.', 'Bitte den laufenden Speichervorgang abschließen.'),
      buttons: [tr('Back', 'Zurück')], defaultId: 0, cancelId: 0 });
    return false;
  }
  const leave = action === 'quit' ? tr('Quit without saving', 'Ohne Speichern beenden')
    : tr('Continue without saving', 'Ohne Speichern fortfahren');
  return dialog.showMessageBoxSync(win, { type: 'warning', title: tr('Unsaved recording', 'Ungespeicherte Aufnahme'),
    message: recordingStatus.active ? tr('A recording is still running.', 'Eine Aufzeichnung läuft noch.')
      : tr('A recording has not been saved yet.', 'Eine Aufnahme ist noch nicht gespeichert.'),
    detail: tr('Choose Back and save the recording under Data. Without saving, this recording is lost.',
      'Zurück wählen und die Aufnahme unter Daten speichern. Ohne Speichern geht diese Aufnahme verloren.'),
    buttons: [tr('Back', 'Zurück'), leave], defaultId: 0, cancelId: 0, noLink: true }) === 1;
}

let brainData = null;
let brainDataText = null;   // the same bundle as JSON, serialized once (see 'brain-data-text')
let dataInfo = 'no data — run etl.py';

function createWindow() {
  const W = 1500, H = 900;
  const bw = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 1100,
    minHeight: 660,
    title: 'NeuroCause',
    icon: join(APP_DIR, 'assets', 'brand', 'neurocause-app-icon.ico'),
    backgroundColor: '#0b100f',
    autoHideMenuBar: true,
    webPreferences: {
      // CommonJS, not ESM — Electron's sandboxed preload loader doesn't
      // support `import` syntax, and OS-level sandboxing needs a preload
      // it can actually load.
      preload: join(APP_DIR, 'preload.cjs'),
      backgroundThrottling: false,
      sandbox: true,
    },
  });
  pipeConsole(bw);
  hardenNavigation(bw);
  bw.webContents.on('will-prevent-unload', event => {
    // Electron explicitly uses preventDefault here to ALLOW unloading.
    if (quitApproved || allowRecordingExit('continue')) event.preventDefault();
    else app.isQuitting = false;
  });
  bw.webContents.on('did-finish-load', () => { recordingStatus = recordingState(); });
  // With NEUROFLY_DEBUG set, the page logs a measured performance line every
  // few seconds (see updatePerformanceDisplay). Off by default: normal runs
  // stay silent.
  bw.loadFile(join(APP_DIR, 'renderer', 'app.html'), DEBUG ? { query: { debug: '1' } } : undefined);
  return bw;
}

// This app has no links or external content — nothing legitimate ever
// navigates away from app.html or opens a new window. Deny both outright
// (defense in depth alongside the page's own CSP): if a bug or a future
// dependency ever tried, the old default was to actually follow it.
function hardenNavigation(bw) {
  bw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bw.webContents.on('will-navigate', (e, url) => {
    if (url !== bw.webContents.getURL()) e.preventDefault();
  });
}

// Report what the page logs (warnings and errors always, everything with
// NEUROFLY_DEBUG), failed loads and a lost renderer on stderr.
function pipeConsole(bw) {
  const report = (text) => process.stderr.write(`[app] ${text}
`);
  const page = bw.webContents;
  page.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2 || DEBUG) report(`${message} (${source}:${line})`);
  });
  page.on('did-fail-load', (_e, code, desc) => report(`load failed: ${desc} (${code})`));
  page.on('render-process-gone', (_e, details) => report(`renderer gone: ${details.reason} (exit code ${details.exitCode})`));
}

function send(channel, payload) {
  if (win === null || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function buildTrayMenu() {
  const command = (name) => () => send('cmd', { name });
  const togglePause = () => {
    paused = !paused;
    send('cmd', { name: 'pause', value: paused });
    refreshTray();
  };
  return Menu.buildFromTemplate([
    { label: 'NeuroCause', enabled: false },
    { label: dataInfo, enabled: false },
    { type: 'separator' },
    { label: paused ? tr('Resume', 'Fortsetzen') : tr('Pause', 'Pause'), click: togglePause },
    { label: tr('Add a fly', 'Fliege hinzufügen'), click: command('addFly') },
    { label: tr('Remove a fly', 'Fliege entfernen'), click: command('removeFly') },
    { label: tr('Startle the flies', 'Fliegen erschrecken'), click: command('scareAll') },
    { type: 'separator' },
    { label: tr('Show window', 'Fenster anzeigen'), click: showWindow },
    { label: tr('Quit', 'Beenden'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ---- the operating-system senses (they need Electron's powerMonitor) --------
// Everything else the fly senses comes from the page itself. From the idle
// timer: "typing" (a brief disturbance when input resumes after a quiet
// spell; see InputDisturbance), and "sleepy" (idle over 10 minutes at night,
// 22-6 h, or over 30 minutes at any time). The hour also sets the circadian
// activity level.
const NIGHT_IDLE_S = 600, ANY_IDLE_S = 1800, AMBIENT_POLL_S = 1 / 30;
function pollAmbient() {
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const typingLevel = disturbance.poll(idleSeconds, AMBIENT_POLL_S);
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const night = hour >= 22 || hour < 6;
  send('ambient', {
    typing: typingLevel,
    sleepy: (night && idleSeconds > NIGHT_IDLE_S) || idleSeconds > ANY_IDLE_S,
    activity: circadianActivity(hour),
  });
}

// A one-line summary of the loaded data for the tray menu.
function describeData(bundle) {
  const parts = [`FlyWire v783 · ${bundle.points.points.length} somas`,
    `circuit ${bundle.circuit.neurons.length}n/${bundle.circuit.edges.length}e`];
  if (bundle.locomotor) parts.push(`MaleCNS ${bundle.locomotor.neurons.length}n`);
  if (bundle.provenance?.brainAudit?.valid) parts.push('audit ok');
  return parts.join(' · ');
}

app.setAppUserModelId('com.neurofly.windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  showWindow();
});

// Which fly runs: 'mixed' (FlyWire brain + MaleCNS cord, the original model)
// or 'male' (brain and cord of one MaleCNS animal). Kept in the settings
// folder; a model whose files are missing falls back to 'mixed'.
const flyModelFile = () => join(app.getPath('userData'), 'fly-model.json');
function chosenFlyModel() {
  try {
    const { model } = JSON.parse(readFileSync(flyModelFile(), 'utf8'));
    return availableFlyModels().includes(model) ? model : 'mixed';
  } catch { return 'mixed'; }
}
function loadFly(model) {
  try {
    brainData = loadBrainData(undefined, { model });
    brainDataText = null;
    if (brainData) dataInfo = describeData(brainData);
  } catch (error) {
    brainData = null;
    brainDataText = null;
    dataInfo = `invalid neural data: ${error.message}`;
    process.stderr.write(`[data] ${dataInfo}
`);
  }
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  loadFly(chosenFlyModel());

  win = createWindow();
  // Closing the window hides it; the tray's Quit ends the app.
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
  });

  tray = new Tray(nativeImage.createFromPath(join(APP_DIR, 'assets', 'brand', 'tray-32.png')));
  tray.setToolTip('NeuroCause');
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide(); else win.show();
  });
  refreshTray();

  setInterval(pollAmbient, AMBIENT_POLL_S * 1000);
});

ipcMain.handle('brain-data', () => brainData);
ipcMain.handle('fly-models', () => ({ available: availableFlyModels(), current: brainData?.provenance?.flyModel ?? 'mixed' }));
// Switching the fly reloads the page: a new brain means new workers, views
// and populations. An unsaved recording still asks first (will-prevent-unload).
ipcMain.handle('set-fly-model', (_event, model) => {
  if (!availableFlyModels().includes(model)) return false;
  if ((brainData?.provenance?.flyModel ?? 'mixed') === model) return true;
  try { writeFileSync(flyModelFile(), JSON.stringify({ model })); } catch { /* the choice holds for this session */ }
  loadFly(model);
  if (win && !win.isDestroyed()) win.webContents.reload();
  return true;
});
// The page and its two simulation workers each need the whole bundle. One
// string crosses the process and thread boundaries almost for free, while
// structured-cloning its ~800,000 small edge arrays took seconds per copy on
// the 4-core test machine; JSON.parse rebuilds exactly the same values.
ipcMain.handle('brain-data-text', () => {
  if (brainData && brainDataText === null) brainDataText = JSON.stringify(brainData);
  return brainDataText;
});
const specimens = createSpecimenService();
ipcMain.handle('specimen-catalog', () => specimens.catalog());
ipcMain.handle('specimen-data', (_event, id) => specimens.load(id));
ipcMain.handle('specimen-morphology', (_event, id, profileId) => specimens.morphology(id, profileId));
ipcMain.handle('specimen-cell', (_event, id, neuron, sha256) => specimens.cell(id, neuron, sha256));
ipcMain.handle('specimen-path', (_event, id, query, sha256) => specimens.path(id, query, sha256));
app.on('will-quit', () => { void specimens.close(); });

// Literature links in the panels open in the user's browser. Only plain
// https URLs to a short list of scientific hosts are accepted, so this channel
// cannot be used to launch anything else.
const LINK_HOSTS = ['doi.org', 'pubmed.ncbi.nlm.nih.gov', 'www.nature.com', 'elifesciences.org', 'www.lse.ac.uk',
  'sites.google.com', 'male-cns.janelia.org', 'codex.flywire.ai', 'flywire.ai', 'neuro-cause.com', 'neurofly.app', 'www.cell.com', 'dataverse.harvard.edu',
  'www.janelia.org', 'connectomics.hms.harvard.edu', 'www.virtualflybrain.org', 'flycellatlas.org', 'flybase.org', 'zenodo.org'];
ipcMain.handle('open-external', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || !LINK_HOSTS.includes(u.hostname)) return false;
    shell.openExternal(u.toString());
    return true;
  } catch { return false; }
});
ipcMain.on('renderer-set-paused', (_e, value) => { paused = !!value; refreshTray(); });
// The user declined the software terms: end the app, not only the window.
ipcMain.on('quit-app', () => { app.isQuitting = true; app.quit(); });

// Save a recorded run. The renderer hands over CSV text and nothing else —
// it cannot name a path, so this channel can only ever write where the user
// themselves pointed the save dialog. The size cap is a guard against a
// runaway buffer, not a policy: the recorder's own row cap keeps a normal
// session far below it.
const save = createSaveService({
  getWindow: () => win,
  showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
});
ipcMain.handle('save-recording', (_e, csv) => save('recording', csv));
ipcMain.handle('save-experiment', (_e, json) => save('experiment', json));
ipcMain.on('recording-state', (event, state) => {
  if (event.sender === win?.webContents && state && typeof state === 'object') recordingStatus = recordingState(state);
});

// Learning traces use their own file type and dialog title so an analytical
// contact-level export cannot be confused with the 20-Hz behavioural record.
ipcMain.handle('save-learning-record', (_e, csv) => save('learning', csv));

// A manifest is small JSON metadata that accompanies a trace/snapshot. Main
// owns both destination and size check, so the sandboxed renderer still has
// no arbitrary filesystem write capability.
ipcMain.handle('save-manifest', (_e, json) => save('manifest', json));

// A reproducible visual observation of the *current* run. As with CSV
// recording, the renderer cannot choose a path; the user selects it through
// the native dialog. capturePage includes the whole displayed application
// window, which is more useful for a lab note than a cropped WebGL canvas.
ipcMain.handle('save-snapshot', () => save('snapshot'));
// The Habitat game's photo: a PNG the page composed (the terrarium and a
// caption); checked to be a PNG, written only where the user chooses.
ipcMain.handle('save-photo', (_e, dataUrl) => save('photo', dataUrl));

app.on('window-all-closed', () => { if (process.platform !== 'darwin') { /* tray keeps it alive */ } });
app.on('before-quit', event => {
  if (!quitApproved && !allowRecordingExit('quit')) { event.preventDefault(); app.isQuitting = false; return; }
  quitApproved = true;
  app.isQuitting = true;
});
