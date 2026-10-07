// mobile.js — the Studio on a phone or a small tablet (the Android app, or a
// narrow browser window). The same panels, views and live simulation as on
// the desktop, laid out for one hand:
//   * the terrarium fills the screen; the connectome replaces it on demand;
//   * a bottom bar: Live, Stimulate, Brain, Why, More;
//   * workspaces open as a sheet over the terrarium, never beside it: the
//     fly's arena follows the terrarium's size, so a sheet must not resize it
//     (the camera shifts the tank up into the visible part instead);
//   * the Android back button closes the sheet, then the brain view.
// On a desktop-sized window none of this is active and the page is unchanged.

import { h, icon } from './dom.js';
import { t, getLanguage } from '../i18n.js';

const PRIMARY = ['live', 'habitat', 'stimulate'];   // the game sits next to the live view on a phone
// A window this narrow (or this low, with a touch screen) gets the phone layout.
export function wantsMobileLayout() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  return !!globalThis.Capacitor?.isNativePlatform?.() || innerWidth <= 820 || (coarse && innerHeight <= 520);
}

export function setupMobile(ctx, { shell, panels }) {
  const body = document.body;
  const workspace = document.getElementById('workspace');
  const panelEl = document.getElementById('panel');
  const stage = document.getElementById('stage');
  const dockEl = document.getElementById('dock');
  const inspectorEl = document.getElementById('inspector');
  const whyEl = document.getElementById('why');
  const terrariumEl = document.getElementById('terrarium');
  const homes = new Map([[panelEl, [workspace, stage]], [dockEl, [stage, null]], [whyEl, [inspectorEl, null]]]);

  // ---- bottom bar ----
  const nav = h('nav', { id: 'mnav', 'aria-label': 'Navigation' });
  const sheet = h('section', { id: 'sheet', role: 'dialog', 'aria-modal': 'false' });
  const grip = h('button', { class: 'sheet-grip', type: 'button' }, h('span'));
  const sheetTitle = h('b', { class: 'sheet-title' });
  const closeBtn = h('button', { class: 'btn ghost icon-only sheet-close', type: 'button' }, icon('close', 18));
  const sheetHead = h('header', { class: 'sheet-head' }, sheetTitle, closeBtn);
  const sheetBody = h('div', { class: 'sheet-body' });
  sheet.append(grip, sheetHead, sheetBody);
  document.body.append(sheet);
  workspace.after(nav);

  const state = { open: null, full: false, brain: false, active: false };
  ctx.mobile = state;

  const relayout = () => setTimeout(() => window.dispatchEvent(new Event('resize')), 40);

  function mount(el) {
    if (el.parentElement !== sheetBody) sheetBody.replaceChildren(el);
    el.hidden = false;
  }
  function restore(el) {
    const [parent, before] = homes.get(el);
    if (el.parentElement === parent) return;
    if (before && before.parentElement === parent) parent.insertBefore(el, before); else parent.append(el);
  }

  // What a bar item opens: a workspace panel, the explanations or the traces.
  function show(kind) {
    if (kind === 'brain') { setBrain(!state.brain); return; }
    if (state.open === kind) { closeSheet(); return; }
    state.open = kind;
    if (kind === 'why') { mount(whyEl); sheetTitle.textContent = t('Why did she do that?'); }
    else if (kind === 'signals') { mount(dockEl); sheetTitle.textContent = t('Neural activity'); relayout(); }
    else if (kind === 'more') { sheetBody.replaceChildren(moreGrid()); sheetTitle.textContent = t('More'); }
    else {
      if (shell.active !== kind) shell.select(kind);
      mount(panelEl);
      sheetTitle.textContent = t(panels.find((p) => p.id === kind)?.title ?? '');
    }
    sheetBody.scrollTop = 0;
    body.classList.add('m-sheet-open');
    setInset();
    renderNav();
  }
  function closeSheet() {
    state.open = null;
    state.full = false;
    body.classList.remove('m-sheet-open', 'm-sheet-full');
    setInset();
    renderNav();
  }
  function setBrain(on) {
    state.brain = on;
    body.classList.toggle('m-brain', on);
    ctx.views.terrarium.displayHidden = on;
    relayout();
    renderNav();
  }
  // The visible part of the terrarium: the camera centres the tank there.
  // Upright the sheet covers the bottom, sideways the right-hand side.
  function setInset() {
    let bottom = 0, right = 0;
    if (state.open && !state.full) {
      const pane = terrariumEl.getBoundingClientRect(), box = sheet.getBoundingClientRect();
      if (box.left > pane.left + pane.width * 0.3) right = Math.max(0, pane.right - box.left);
      else bottom = Math.max(0, pane.bottom - box.top);
    }
    ctx.views.terrarium.setViewInset?.(bottom, right);
    ctx.views.brain?.setViewInset?.(bottom, right);
  }
  sheet.addEventListener('transitionend', setInset);

  function navButton(kind, iconName, label, pressed) {
    return h('button', { type: 'button', 'data-kind': kind, 'aria-pressed': String(!!pressed), onclick: () => show(kind) },
      icon(iconName, 22), h('span', {}, label));
  }
  function renderNav() {
    const panelOf = (id) => panels.find((p) => p.id === id);
    nav.replaceChildren(
      ...PRIMARY.map((id) => navButton(id, panelOf(id).icon, t(panelOf(id).short ?? panelOf(id).title), state.open === id)),
      navButton('brain', 'brain', t('Brain'), state.brain),
      navButton('why', 'why', t('Why'), state.open === 'why'),
      navButton('more', 'grid', t('More'), state.open === 'more' || (state.open && !['why', 'signals', ...PRIMARY].includes(state.open))));
  }

  // Everything else: the other workspaces, the traces, and the top bar's tools.
  function moreGrid() {
    const tile = (kind, iconName, label) => h('button', { class: 'm-tile', type: 'button', onclick: () => { closeSheet(); show(kind); } },
      icon(iconName, 22), h('span', {}, label));
    const others = panels.filter((p) => !PRIMARY.includes(p.id));
    const speeds = [0.25, 0.5, 1, 2, 4];
    const speedSeg = h('div', { class: 'seg m-speed', role: 'group' }, ...speeds.map((s) => h('button', {
      type: 'button', 'aria-pressed': String((ctx.snap?.speed ?? 1) === s),
      onclick: (e) => { ctx.command('speed', { factor: s }); for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); },
    }, `${s}×`)));
    return h('div', { class: 'm-more' },
      h('div', { class: 'm-tiles' }, ...others.map((p) => tile(p.id, p.icon, t(p.short ?? p.title))), tile('signals', 'chart', t('Traces'))),
      h('div', { class: 'card' }, h('h3', {}, icon('speed', 16), t('Simulation speed')), speedSeg,
        h('p', { class: 'note' }, t('Faster runs need a faster processor; the model itself is unchanged.'))),
      h('div', { class: 'grid2' },
        h('button', { class: 'btn', type: 'button', onclick: () => ctx.save('saveSnapshot', undefined, t('Picture saved.')) }, icon('camera', 16), t('Picture')),
        h('button', { class: 'btn', type: 'button', onclick: () => { ctx.relabel(getLanguage() === 'de' ? 'en' : 'de'); } }, icon('globe', 16), getLanguage() === 'de' ? 'English' : 'Deutsch'),
        h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); ctx.showHelp?.(); } }, icon('help', 16), t('Quick guide')),
        h('button', { class: 'btn', type: 'button', onclick: () => ctx.openExternalLink?.('https://neuro-cause.com') }, icon('link', 16), 'neuro-cause.com')),
      // The app and web builds carry their licence texts (licenses/); the
      // desktop app ships them as files next to the program instead.
      window.flyAPI ? null : h('button', { class: 'btn m-wide', type: 'button', onclick: () => showLicences() }, icon('data', 16), t('Licences and data sources')));
  }

  async function showLicences() {
    const at = (rel) => new URL(`licenses/${rel}`, document.baseURI);
    let files;
    try { files = (await (await fetch(at('index.json'))).json()).files; } catch { ctx.toast(t('The licence texts are not part of this build.'), 'err'); return; }
    const text = h('pre', { class: 'm-licence-text' });
    const tabs = files.map((f) => h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', onclick: async (e) => {
      for (const b of tabs) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      try { text.textContent = await (await fetch(at(f.file))).text(); } catch { text.textContent = '—'; }
      text.scrollTop = 0;
    } }, t(f.title)));
    const dialog = h('dialog', { class: 'm-licences', 'aria-label': t('Licences and data sources') },
      h('h2', {}, t('Licences and data sources')),
      h('div', { class: 'm-licence-tabs' }, ...tabs),
      text,
      h('form', { method: 'dialog' }, h('button', { class: 'btn primary', type: 'submit' }, t('Close'))));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    tabs[0]?.click();
  }

  // ---- the sheet: drag the grip to expand, shrink or close ----
  let dragY = null, dragStart = 0;
  grip.addEventListener('pointerdown', (e) => { dragY = e.clientY; dragStart = e.clientY; grip.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); });
  grip.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragStart;
    sheet.style.translate = `0 ${Math.max(state.full ? 0 : -120, dy)}px`;
  });
  const endDrag = (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragStart;
    dragY = null;
    sheet.classList.remove('dragging');
    sheet.style.translate = '';
    if (Math.abs(dy) < 8) { state.full = !state.full; }
    else if (dy < -40) state.full = true;
    else if (dy > 60) { if (state.full) state.full = false; else { closeSheet(); return; } }
    body.classList.toggle('m-sheet-full', state.full);
    setTimeout(setInset, 260);
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  closeBtn.addEventListener('click', closeSheet);

  // Tapping a "Why?" card opens the explanation list.
  const openEvent = ctx.openEvent;
  ctx.openEvent = (event) => { openEvent?.(event); if (state.active && state.open !== 'why') show('why'); };

  // Android's back button: sheet, then brain view, then out of the app.
  const App = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor?.Plugins?.App : null;
  App?.addListener?.('backButton', () => {
    const dialog = [...document.querySelectorAll('dialog[open]')].pop();
    if (dialog) dialog.close();
    else if (state.open) closeSheet();
    else if (state.brain) setBrain(false);
    else App.minimizeApp?.();
  });

  // ---- switching between the phone and the desktop layout ----
  function apply() {
    const on = wantsMobileLayout();
    if (on === state.active) return;
    state.active = on;
    body.classList.toggle('mobile', on);
    ctx.onLayoutChange?.();
    if (!on) {
      closeSheet();
      setBrain(false);
      for (const el of homes.keys()) { restore(el); el.hidden = false; }
    }
    renderNav();
    relayout();
  }
  ctx.relabelMobile = () => { renderNav(); if (state.open) { const open = state.open; state.open = null; show(open); } };
  window.addEventListener('resize', apply);
  apply();
  return { apply, close: closeSheet, show };
}
