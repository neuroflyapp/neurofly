// habitat-fx.js — the Habitat game's layer over the terrarium: discovery
// cards, floating rewards, the rank-up banner, the care bubble above the fly
// and the red-light tint of optogenetics; and its short synthesized sounds.
// Observer side only: plain DOM over the canvas, never in the fly's eye.

import { h, icon } from './dom.js';
import { t } from '../i18n.js';

// ---- sound: a few soft tones, synthesized (no audio files) ---------------------------------------
const TUNES = {
  coin: [[880, 0, 0.09], [1320, 0.06, 0.12]],
  card: [[1047, 0, 0.12], [1319, 0.07, 0.12], [1568, 0.14, 0.2]],
  discovery: [[659, 0, 0.16], [988, 0.1, 0.16], [1319, 0.2, 0.32]],
  quest: [[523, 0, 0.14], [659, 0.1, 0.14], [784, 0.2, 0.14], [1047, 0.3, 0.4]],
  level: [[392, 0, 0.16], [523, 0.12, 0.16], [659, 0.24, 0.16], [784, 0.36, 0.16], [1047, 0.5, 0.6]],
  hatch: [[740, 0, 0.08], [554, 0.08, 0.08], [880, 0.16, 0.22]],
  shutter: [[1760, 0, 0.04], [1175, 0.05, 0.06]],
  soft: [[440, 0, 0.18]],
};

export class HabitatSound {
  constructor() { this.enabled = true; this.ctx = null; }
  play(name) {
    if (!this.enabled || !TUNES[name]) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const now = this.ctx.currentTime + 0.01;
      for (const [freq, at, dur] of TUNES[name]) {
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + at);
        gain.gain.linearRampToValueAtTime(0.07, now + at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(now + at);
        osc.stop(now + at + dur + 0.05);
      }
    } catch { /* no audio on this device: silent game */ }
  }
  dispose() { try { this.ctx?.close(); } catch { /* already closed */ } this.ctx = null; }
}

// ---- the layer ------------------------------------------------------------------------------------
export class HabitatOverlay {
  constructor(host, { flyPosition }) {
    this.host = host;
    this.flyPosition = flyPosition;       // () => { x, y, visible } in host pixels, or null
    this.el = h('div', { class: 'hab-overlay', 'aria-live': 'polite' });
    this.cards = h('div', { class: 'hab-cards' });
    this.bubble = h('div', { class: 'hab-bubble', hidden: true });
    this.tint = h('div', { class: 'hab-redlight', hidden: true });
    this.el.append(this.tint, this.cards, this.bubble);
    host.append(this.el);
    this.queue = [];
    this.showing = 0;
    this.bubbleKey = null;
    this.bubbleXY = [NaN, NaN];
  }

  // A card over the terrarium: { tone, eyebrow, title, text, chips, rewards, action }.
  card({ tone = 'discovery', eyebrow, title, text, chips = [], rewards = [], action = null, iconName = 'spark', ms = 7000 }) {
    // One card at a time on a phone (the sheet covers most of the view).
    if (this.showing >= (document.body.classList.contains('mobile') ? 1 : 2)) { this.queue.push(arguments[0]); return; }
    this.showing++;
    const close = h('button', { type: 'button', class: 'hab-card-close', 'aria-label': t('Close') }, icon('close', 14));
    const el = h('div', { class: `hab-card tone-${tone}`, role: 'status' },
      h('div', { class: 'hab-card-icon' }, icon(iconName, 22)),
      h('div', { class: 'hab-card-body' },
        h('div', { class: 'hab-card-eyebrow' }, eyebrow),
        h('div', { class: 'hab-card-title' }, title),
        text ? h('div', { class: 'hab-card-text' }, text) : null,
        chips.length ? h('div', { class: 'hab-chips' }, ...chips.map((c) => h('span', { class: 'hab-chip' }, c))) : null,
        h('div', { class: 'hab-card-foot' },
          ...rewards.map((r) => h('span', { class: 'hab-reward' }, r)),
          action ? h('button', { type: 'button', class: 'btn small hab-card-action', onclick: action.onclick }, action.label) : null)),
      close);
    let timer = null;
    const remove = () => {
      clearTimeout(timer);
      if (!el.isConnected) return;
      el.classList.add('out');
      setTimeout(() => {
        el.remove();
        this.showing--;
        const next = this.queue.shift();
        if (next) this.card(next);
      }, 260);
    };
    close.addEventListener('click', remove);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(remove, 2500); });
    this.cards.append(el);
    timer = setTimeout(remove, ms);
  }

  // "+20 XP" rising from the fly (or the middle of the view).
  float(text, kind = 'xp') {
    const p = this.flyPosition();
    const x = p?.visible ? p.x : this.host.clientWidth / 2, y = p?.visible ? p.y - 24 : this.host.clientHeight / 2;
    const el = h('div', { class: `hab-float ${kind}`, style: { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` } }, text);
    this.el.append(el);
    setTimeout(() => el.remove(), 1600);
  }

  banner(eyebrow, title, sub) {
    const el = h('div', { class: 'hab-banner' }, h('div', { class: 'hab-banner-ring' }),
      h('div', { class: 'hab-banner-eyebrow' }, eyebrow), h('div', { class: 'hab-banner-title' }, title),
      sub ? h('div', { class: 'hab-banner-sub' }, sub) : null);
    this.el.append(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  // The most urgent need as a small bubble above the fly (null hides it).
  setBubble(need) {
    const key = need?.key ?? null;
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    this.bubble.hidden = !need;
    if (need) this.bubble.replaceChildren(icon(need.icon, 15), h('span', {}, need.label));
  }

  // Every snapshot: keep the bubble over her head (only when shown).
  follow() {
    if (this.bubble.hidden) return;
    const p = this.flyPosition();
    if (!p?.visible) { this.bubble.style.opacity = '0'; return; }
    const x = Math.round(p.x), y = Math.round(p.y - 30);
    if (x === this.bubbleXY[0] && y === this.bubbleXY[1]) return;
    this.bubbleXY = [x, y];
    this.bubble.style.opacity = '';
    this.bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  setRedLight(on) { this.tint.hidden = !on; }

  flash() {
    const el = h('div', { class: 'hab-flash' });
    this.el.append(el);
    setTimeout(() => el.remove(), 500);
  }

  dispose() { this.el.remove(); this.queue = []; }
}

// ---- the photo: the terrarium picture with a caption band and the logo ----------------------------
const loadImage = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

export async function composePhoto({ imageUrl, title, lines = [], footer = '' }) {
  const shot = await loadImage(imageUrl);
  if (!shot) return null;
  const scale = Math.min(1, 1920 / shot.width);
  const w = Math.round(shot.width * scale), h = Math.round(shot.height * scale);
  const band = Math.round(Math.max(130, h * 0.22));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.drawImage(shot, 0, 0, w, h);
  const fade = g.createLinearGradient(0, h - band * 1.6, 0, h);
  fade.addColorStop(0, 'rgba(8,12,13,0)');
  fade.addColorStop(1, 'rgba(8,12,13,0.92)');
  g.fillStyle = fade;
  g.fillRect(0, h - band * 1.6, w, band * 1.6);
  const pad = Math.round(band * 0.22), unit = band / 130;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#f9f6f1';
  g.font = `700 ${Math.round(34 * unit)}px "Segoe UI", system-ui, sans-serif`;
  let y = h - band + Math.round(42 * unit);
  g.fillText(title, pad, y);
  g.font = `${Math.round(17 * unit)}px "Segoe UI", system-ui, sans-serif`;
  for (const [k, line] of lines.entries()) {
    y += Math.round(25 * unit);
    g.fillStyle = k === 0 ? '#00ff41' : '#c9d6d1';
    g.fillText(line, pad, y);
  }
  if (footer) {
    g.font = `${Math.round(12.5 * unit)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#8ea39d';
    g.fillText(footer, pad, y + Math.round(23 * unit));
  }
  const logo = await loadImage(new URL('../../assets/brand/neurocause-logo.svg', import.meta.url).href);
  if (logo) {
    const lh = Math.round(28 * unit), lw = Math.round(lh * (logo.width / logo.height || 5.3));
    g.globalAlpha = 0.92;
    g.drawImage(logo, w - pad - lw, h - band + Math.round(18 * unit), lw, lh);
    g.globalAlpha = 1;
  }
  return canvas.toDataURL('image/png');
}
