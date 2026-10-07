// panel-habitat.js — the Habitat workspace: a care, discovery and fly-genetics
// game played with the real simulated fly in the terrarium (HABITAT_DESIGN.md).
// The rules live in src/habitat-game.js; this panel shows them, sends the
// Studio commands a player's action needs (food, dust, temperature, a new
// individual and its genotype), and keeps the save in local storage.

import { h, icon } from './dom.js';
import { t, getLanguage, num, int } from '../i18n.js';
import { HabitatGame, newGame, decodeGame, migrateLegacy, SAVE_KEY, LEGACY_KEY, NEEDS, rankInfo, temperament,
  fillName, DOSE_PERCENTS } from '../../src/habitat-game.js';
import { BEHAVIOURS, NEURONS, QUESTS, CHAPTERS, DAILY, STOCKS, CRITERIA, RANKS, RARITY, VIAL, MODALITY_LABEL,
  HABITAT_REFERENCES, GARDEN, GARDEN_ITEMS, byId } from '../../src/habitat-content.js';
import { assessSentience } from '../../src/sentience.js';
import { HabitatOverlay, HabitatSound, composePhoto } from './habitat-fx.js';

const L = (rec, name = '') => fillName(rec?.[getLanguage()] ?? rec?.en ?? '', name);
// Texts as literal t() calls, so tools/check-i18n.mjs sees every one.
const NEED_UI = {
  energy: { icon: 'drop', label: () => t('Energy'), low: () => t('Hungry') },
  calm: { icon: 'sentience', label: () => t('Calm'), low: () => t('Startled') },
  climate: { icon: 'thermo', label: () => t('Climate'), low: () => t('Uncomfortable') },
  clean: { icon: 'antenna', label: () => t('Clean'), low: () => t('Dusty') },
};
const statusLabel = (status) => ({ present: () => t('present'), partial: () => t('partly in the model'),
  experimental: () => t('experimental only'), absent: () => t('not in the model') }[status] ?? (() => t('not assessed for this specimen')))();
const rarityLabel = (r) => ({ common: () => t('common'), uncommon: () => t('uncommon'), rare: () => t('rare') }[r])();
const SAVE_EVERY_MS = 5000;

// One game per page: switching workspaces keeps it (and its runtime state).
let shared = null;
function loadGame() {
  if (shared) return shared;
  let state = null, notice = null, raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { notice = 'storage'; }
  if (raw) {
    try { state = decodeGame(raw); } catch {
      notice = 'unreadable';
      // Kept aside, never silently overwritten.
      try { localStorage.setItem(`${SAVE_KEY}.unreadable`, raw); } catch { /* storage full */ }
    }
  }
  if (!state) {
    let legacy = null;
    try { legacy = localStorage.getItem(LEGACY_KEY); } catch { /* no storage */ }
    if (legacy) { try { state = migrateLegacy(legacy); notice ??= 'migrated'; } catch { /* nothing to carry over */ } }
  }
  shared = { game: new HabitatGame(state ?? newGame()), notice, tab: 'quests', savedAt: 0 };
  return shared;
}

function saveGame() {
  if (!shared) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(shared.game.state)); shared.savedAt = performance.now(); } catch { /* full or blocked */ }
}

// An SVG ring gauge: value 0-100.
function gauge(key) {
  const ui = NEED_UI[key];
  const R = 22, C = 2 * Math.PI * R;
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [k, v] of Object.entries({ cx: 28, cy: 28, r: R, class: 'hab-gauge-value', 'stroke-dasharray': C.toFixed(1), 'stroke-dashoffset': '0' })) ring.setAttribute(k, v);
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [k, v] of Object.entries({ cx: 28, cy: 28, r: R, class: 'hab-gauge-track' })) track.setAttribute(k, v);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 56 56');
  svg.append(track, ring);
  const label = h('span', { class: 'hab-gauge-label' }, ui.label());
  const el = h('div', { class: 'hab-gauge', 'data-need': key }, h('div', { class: 'hab-gauge-dial' }, svg, h('span', { class: 'hab-gauge-icon' }, icon(ui.icon, 18))), label);
  let shown = -1;
  return {
    el,
    set(v) {
      const r = Math.round(v);
      if (r === shown) return;
      shown = r;
      ring.setAttribute('stroke-dashoffset', (C * (1 - r / 100)).toFixed(1));
      el.dataset.level = r >= 60 ? 'good' : r >= 30 ? 'mid' : 'low';
      el.title = `${ui.label()}: ${r} / 100 · ${t('game value')}`;
    },
  };
}

function leafIcon(size = 14) {
  const el = h('span', { class: 'icon hab-leaf', 'aria-hidden': 'true' });
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-9 6-14 15-15-1 9-6 15-15 15Z"/><path d="M5 19 13 11"/></svg>`;
  return el;
}

export const habitatPanel = {
  id: 'habitat', icon: 'spark', title: 'Habitat', short: 'Habitat',
  build(ctx) {
    const S = loadGame(), game = S.game;
    if (window.__nf) window.__nf.habitat = game;   // debug builds only (?debug=1)
    const sound = new HabitatSound();
    sound.enabled = game.state.sound;
    const terrarium = ctx.views.terrarium;
    const overlay = new HabitatOverlay(document.getElementById('terrarium'), { flyPosition: () => terrarium?.flyScreenPosition?.() ?? null });
    const audit = assessSentience({ circuit: ctx.data?.circuit, provenance: ctx.data?.provenance, pathways: ctx.data?.pathways, hasPlasticity: true });
    const modelSex = ctx.data?.provenance?.specimens?.body?.sex === 'male' ? 'male' : 'female';
    let renaming = false, openEntry = null, lastSnap = null, stateVersion = 0, shownVersion = -1;
    const name = () => game.fly.name;

    // ---- rewards -> feedback ---------------------------------------------------------------
    function handleRewards(list) {
      if (!list.length) return;
      stateVersion++;
      const covered = new Set();
      for (const r of list) if (r.kind === 'discovery') for (const n of byId(BEHAVIOURS, r.id).neurons) covered.add(n);
      for (const r of list) {
        switch (r.kind) {
          case 'discovery': {
            const b = byId(BEHAVIOURS, r.id), rew = RARITY[b.rarity];
            const trig = r.event?.trigger;
            const chips = [];
            if (trig) chips.push(`${t('Trigger')}: ${trig.channel === 'genetics' ? `${t('Virtual genetics')} · ${trig.label}` : t(trig.label)}${trig.latencyMs != null ? ` · ${int(trig.latencyMs)} ms` : ''}`);
            for (const n of b.neurons) chips.push(byId(NEURONS, n).label);
            const groups = b.neurons.map((n) => byId(NEURONS, n).highlight).filter(Boolean);
            overlay.card({ tone: b.rarity, iconName: b.icon, eyebrow: `${t('New discovery')} · ${rarityLabel(b.rarity)}`,
              title: L(b.title), text: L(b.text, name()), chips, rewards: [`+${rew.xp} XP`, `+${rew.leaves} ${t('leaves')}`],
              action: groups.length ? { label: t('Show in the brain'), onclick: () => highlight(groups) } : null });
            overlay.float(`+${rew.xp} XP`);
            sound.play('discovery');
            break;
          }
          case 'card': {
            overlay.float('+15 XP');
            if (covered.has(r.id)) break;
            const n = byId(NEURONS, r.id);
            overlay.card({ tone: 'card', iconName: 'brain', eyebrow: t('New neuron card'), title: L(n.name), text: `${n.label} · ${L(n.fact)}`,
              rewards: ['+15 XP'], action: n.highlight ? { label: t('Show in the brain'), onclick: () => highlight([n.highlight]) } : null, ms: 6000 });
            sound.play('card');
            break;
          }
          case 'quest': {
            const q = byId(QUESTS, r.id);
            overlay.card({ tone: 'quest', iconName: 'target', eyebrow: t('Quest complete'), title: L(q.title), text: L(q.why, name()),
              rewards: [`+${q.xp} XP`, q.leaves ? `+${q.leaves} ${t('leaves')}` : null].filter(Boolean) });
            sound.play('quest');
            break;
          }
          case 'chapter': overlay.banner(t('New chapter'), L(byId(CHAPTERS, r.id).title)); break;
          case 'level': overlay.banner(t('Rank up'), L(RANKS[r.level]), t('Level {n}', { n: r.level + 1 })); sound.play('level'); break;
          case 'daily': overlay.float(t('Field note done'), 'leaf'); sound.play('coin'); break;
          case 'dailyBonus': overlay.card({ tone: 'quest', iconName: 'spark', eyebrow: t('Field notes'), title: t('All three notes done today'), rewards: ['+30 XP', `+25 ${t('leaves')}`] }); break;
          case 'care': overlay.float(`+${r.leaves} ${t('leaves')}`, 'leaf'); sound.play('coin'); break;
          case 'criterion': {
            const c = audit.criteria.find((x) => x.id === r.id);
            overlay.card({ tone: 'criterion', iconName: 'sentience', eyebrow: t('Criterion investigated'), title: t(c?.name ?? r.id),
              text: c ? t(c.question) : '', rewards: ['+25 XP'] });
            break;
          }
          case 'gift': overlay.card({ tone: 'card', iconName: 'flask', eyebrow: t('New stock for your fly lab'), title: byId(STOCKS, r.id).label, ms: 5000 }); break;
          case 'hatch': {
            const f = game.flyById(r.fly);
            overlay.card({ tone: 'quest', iconName: 'spark', eyebrow: t('Hatched'), title: f.name, text: genotypeText(f.genotype) });
            sound.play('hatch');
            break;
          }
          case 'step': overlay.float(t('Step done'), 'leaf'); sound.play('soft'); break;
          case 'command': ctx.command(r.name, r.args); break;
          case 'heatSwitch': overlay.float(r.on ? t('TrpA1 open: the cells fire') : t('TrpA1 closed'), r.on ? 'xp' : 'leaf'); sound.play('soft'); break;
          case 'milestone': overlay.banner(t('Collection complete'), r.id === 'cards' ? t('Every neuron card') : t('Every behaviour'), '+100 XP · +30'); sound.play('level'); break;
          case 'dose':
            overlay.float(r.responded ? t('{p} %: proboscis out', { p: r.percent }) : t('{p} %: no response', { p: r.percent }), r.responded ? 'leaf' : 'xp');
            sound.play(r.responded ? 'coin' : 'soft');
            break;
          case 'newDay': overlay.card({ tone: 'card', iconName: 'spark', eyebrow: t('A new day'), title: t('Three new field notes'), ms: 5000 }); break;
          case 'death': overlay.card({ tone: 'criterion', iconName: 'pause', eyebrow: t('Simulation ended'), title: t('The simulated body of {name} stopped.', { name: name() }), text: t('Restart the individual from the fly card. Nothing is lost.') }); break;
          default: break;
        }
      }
    }

    function highlight(groups) {
      ctx.highlight({ groups, color: [0, 1, 0.25], duration: 8 });
      if (document.body.classList.contains('inspector-collapsed')) ctx.toast(t('Open the connectome view (layers button) to see the cells.'));
    }

    function send(commands) { for (const [cmd, args] of commands) ctx.command(cmd, args); }

    function act(action) {
      const res = game.act(action, Date.now(), ctx.snap);
      handleRewards(res.rewards);
      if (res.commands?.length) send(res.commands);
      if (!res.ok) ctx.toast(reasonText(res.reason), 'err');
      stateVersion++;
      saveGame();
      refresh();
      return res;
    }

    function reasonText(reason) {
      const texts = { leaves: () => t('Not enough leaves.'), level: () => t('Reach a higher rank first.'),
        vials: () => t('All vial places are in use.'), full: () => t('The colony is full (12 flies). Release one first.'),
        'not ready': () => t('The vial is still developing.'),
        genetics: () => t('This fly carries genetic changes from the Lab; only wild-type flies can be adopted.'),
        known: () => t('This fly is already in your colony.'), stock: () => t('You need both stocks for this cross.'),
        name: () => t('Names have 1 to 24 characters.'), 'no opsin': () => t('This fly carries no light switch.'),
        near: () => t('Too close to the fly: an object appearing right in front of its eyes would startle it.'),
        busy: () => t('Wait until the proboscis is in again and the fly is on the ground.'),
        away: () => t('Bring your fly into the terrarium first.'),
        'garden full': () => t('The garden is full (16 pieces). Put one back into storage first.') };
      return (texts[reason] ?? (() => t('Not possible right now.')))();
    }

    function genotypeText(g) {
      if (!g) return t('Wild type');
      return `${byId(STOCKS, g.driver).label} > ${byId(STOCKS, g.effector).label}`;
    }

    // ---- header ------------------------------------------------------------------------------
    const rankNum = h('b', { class: 'hab-rank-num' });
    const rankName = h('div', { class: 'hab-rank-name' });
    const xpFill = h('span', { class: 'hab-xp-fill' });
    const xpText = h('div', { class: 'hab-xp-text' });
    const leavesText = h('b');
    const soundBtn = h('button', { type: 'button', class: 'btn ghost icon-only hab-sound', onclick: () => {
      act({ type: 'sound', on: !game.state.sound });
      sound.enabled = game.state.sound;
      soundBtn.replaceChildren(icon(game.state.sound ? 'sound' : 'mute', 16));
    } }, icon(game.state.sound ? 'sound' : 'mute', 16));
    soundBtn.title = t('Game sounds on or off');
    const header = h('div', { class: 'hab-head' },
      h('div', { class: 'hab-rank' }, rankNum),
      h('div', { class: 'hab-rank-info' }, rankName, h('div', { class: 'hab-xp' }, xpFill), xpText),
      h('div', { class: 'hab-wallet', title: t('Leaves: earned in the game, spent on stocks and vials. No payments.') }, leafIcon(15), leavesText),
      soundBtn);

    // ---- fly card ----------------------------------------------------------------------------
    const nameBtn = h('button', { type: 'button', class: 'hab-name', title: t('Rename') });
    const nameInput = h('input', { class: 'hab-name-input', maxlength: 24, 'aria-label': t('Name of your fly'), hidden: true });
    const genoChip = h('span', { class: 'hab-chip-geno' });
    const metaChip = h('span', { class: 'hab-chip-meta' });
    const doing = h('div', { class: 'hab-doing' }, h('span', { class: 'hab-doing-dot' }), h('span', { class: 'hab-doing-text' }));
    const gauges = Object.fromEntries(NEEDS.map((k) => [k, gauge(k)]));
    const tempText = h('b', { class: 'hab-temp-value' });
    const lightBtn = h('button', { type: 'button', class: 'btn hab-light', hidden: true, onclick: () => {
      const on = !game.rt.lightOn;
      act({ type: 'light', on });
      overlay.setRedLight(game.rt.lightOn);
    } }, icon('bolt', 16), h('span', {}));
    const heatChip = h('div', { class: 'hab-heat', hidden: true });
    const actionBtn = (iconName, label, title, onclick) => h('button', { type: 'button', class: 'btn hab-act', title, onclick: () => { onclick(); sound.play('soft'); } },
      icon(iconName, 18), h('span', {}, label));
    const near = (d) => {
      const f = ctx.snap?.fly;
      if (!f) return {};
      const b = ctx.views.terrarium?.bounds ?? { width: 1100, height: 700 };
      const clampX = (x) => Math.max(-b.width / 2 + 60, Math.min(b.width / 2 - 60, x));
      const clampY = (y) => Math.max(-b.height / 2 + 60, Math.min(b.height / 2 - 60, y));
      return { x: clampX(f.x + Math.cos(f.heading) * d), y: clampY(f.y + Math.sin(f.heading) * d) };
    };
    const setTemp = (delta) => {
      const c = Math.max(12, Math.min(36, Math.round((ctx.snap?.env?.tempC ?? 24) + delta)));
      ctx.command('env.set', { key: 'tempC', value: c });
    };
    const actions = h('div', { class: 'hab-actions' },
      actionBtn('drop', t('Feed'), t('Touch a sugar drop to the proboscis, as in the proboscis extension test. Whether it feeds is up to its taste circuit.'), () => ctx.command('food.add', { kind: 'sugar', conc: 1, ...near(12) })),
      actionBtn('drop', t('Bitter'), t('Touch a bitter drop to the proboscis.'), () => ctx.command('food.add', { kind: 'bitter', conc: 1, ...near(12) })),
      actionBtn('antenna', t('Dust'), t('Dust the antennae: Johnston\'s organ cells feel it.'), () => ctx.command('antenna.dust', { amount: 0.8 })),
      actionBtn('hand', t('Touch'), t('Touch the air next to the fly: the antennae are deflected.'), () => { const p = near(35); if (p.x !== undefined) ctx.command('tap', p); }),
      h('div', { class: 'hab-temp' },
        h('button', { type: 'button', class: 'btn icon-only', title: t('Cooler'), onclick: () => setTemp(-1) }, '−'),
        h('span', {}, icon('thermo', 15), tempText),
        h('button', { type: 'button', class: 'btn icon-only', title: t('Warmer'), onclick: () => setTemp(1) }, '+')),
      lightBtn, heatChip);
    const awayText = h('p', {});
    const bringBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => act({ type: 'activate', fly: game.fly.id }) });
    const adoptBtn = h('button', { type: 'button', class: 'btn', onclick: () => act({ type: 'adopt' }) }, t('Adopt this fly'));
    const away = h('div', { class: 'hab-away', hidden: true }, awayText, h('div', { class: 'hab-away-actions' }, bringBtn, adoptBtn));
    // A photo: the terrarium without the game's overlays, with a caption of
    // what the fly does and which neurons decide it.
    const photoBtn = h('button', { type: 'button', class: 'btn ghost icon-only hab-photo', title: t('Take a photo'), 'aria-label': t('Take a photo'),
      onclick: async () => {
        const view = ctx.views.terrarium;
        if (!view?.capturePhotoPNG) return;
        const imageUrl = view.capturePhotoPNG(2);
        overlay.flash();
        sound.play('shutter');
        const fly = game.fly, snap = ctx.snap;
        const url = await composePhoto({ imageUrl, title: fly.name,
          lines: [doing.lastChild.textContent, `${genotypeText(fly.genotype)} · ${metaChip.textContent} · ${t('{n} simulated neurons', { n: int(snap?.n ?? 0) })}`],
          footer: `${t('Simulation of a connectome-based fly model')} · ${new Date().toLocaleDateString(getLanguage())}` });
        if (!url) return;
        if (ctx.api?.savePhoto) ctx.save('savePhoto', url, t('Photo saved.'));
        else {
          const a = h('a', { href: url, download: `NeuroCause-${fly.name}.png` });
          a.click();
        }
      } }, icon('camera', 17));
    const flyCard = h('div', { class: 'hab-fly' },
      h('div', { class: 'hab-fly-head' },
        h('div', { class: 'hab-avatar', 'aria-hidden': 'true' }, icon('body', 26)),
        h('div', { class: 'hab-fly-id' }, nameBtn, nameInput, h('div', { class: 'hab-fly-chips' }, genoChip, metaChip)),
        photoBtn),
      doing, h('div', { class: 'hab-gauges' }, ...NEEDS.map((k) => gauges[k].el)), away, actions);

    nameBtn.addEventListener('click', () => {
      renaming = true;
      nameInput.value = game.fly.name;
      nameBtn.hidden = true; nameInput.hidden = false;
      nameInput.focus(); nameInput.select();
    });
    const finishRename = (commit) => {
      if (!renaming) return;
      renaming = false;
      nameBtn.hidden = false; nameInput.hidden = true;
      if (commit && nameInput.value.trim() && nameInput.value.trim() !== game.fly.name) act({ type: 'rename', name: nameInput.value });
      refresh();
    };
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') finishRename(true); else if (e.key === 'Escape') finishRename(false); });
    nameInput.addEventListener('blur', () => finishRename(true));

    // ---- tabs --------------------------------------------------------------------------------
    const TABS = [['quests', 'target', t('Quests')], ['journal', 'grid', t('Journal')], ['garden', 'world', t('Garden')],
      ['lab', 'flask', t('Lab')], ['question', 'sentience', t('Question')]];
    const tabBtns = {};
    const tabNav = h('nav', { class: 'hab-tabs', role: 'tablist' }, ...TABS.map(([id, ic, label]) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'hab-tab', onclick: () => { S.tab = id; openEntry = null; stateVersion++; refresh(); } },
        icon(ic, 17), h('span', {}, label), h('i', { class: 'hab-badge', hidden: true }));
      tabBtns[id] = b;
      return b;
    }));
    const tabBody = h('div', { class: 'hab-tab-body' });

    // ---- quests tab --------------------------------------------------------------------------
    function questsTab() {
      const ch = game.currentChapter();
      const out = [];
      if (ch) {
        const qs = QUESTS.filter((q) => q.chapter === ch.id);
        const n = qs.filter((q) => game.questDone(q.id)).length;
        const at = CHAPTERS.indexOf(ch);
        out.push(h('div', { class: 'hab-chapter' },
          h('div', { class: 'hab-eyebrow' }, t('Chapter {n} of {m}', { n: at + 1, m: CHAPTERS.length })),
          h('h3', {}, L(ch.title)),
          h('div', { class: 'hab-progress' }, h('span', { style: { transform: `scaleX(${n / qs.length})` } })),
          h('div', { class: 'hab-small' }, t('{n} of {m} quests', { n, m: qs.length }))));
        for (const q of qs) {
          const done = game.questDone(q.id);
          const step = q.kind === 'climate' && game.state.quests.climate?.n === 1 && !done ? h('div', { class: 'hab-step' }, icon('target', 13), t('Step 1 done: the hot cells fired. Now back to 25 °C.'))
            : q.kind === 'dose' && !done ? h('div', { class: 'hab-dose' }, ...DOSE_PERCENTS.map((p) => {
              const res = game.rt.dose[p];
              return h('button', { type: 'button', class: `btn small${res === true ? ' yes' : res === false ? ' no' : ''}`,
                disabled: !!game.rt.offer, onclick: () => act({ type: 'offer', percent: p, ...near(12) }) },
              `${p} %${res === true ? ' ✓' : res === false ? ' ✗' : ''}`);
            })) : null;
          out.push(h('div', { class: `hab-quest${done ? ' done' : ''}` },
            h('div', { class: 'hab-quest-check' }, done ? icon('target', 15) : null),
            h('div', { class: 'hab-quest-body' },
              h('div', { class: 'hab-quest-title' }, L(q.title)),
              done ? null : h('div', { class: 'hab-quest-task' }, L(q.task, name())),
              step,
              done ? null : h('div', { class: 'hab-quest-why' }, L(q.why, name())),
              done ? null : h('div', { class: 'hab-quest-reward' }, `+${q.xp} XP`, q.leaves ? h('span', {}, leafIcon(12), `+${q.leaves}`) : null))));
        }
      } else {
        out.push(h('div', { class: 'hab-chapter' }, h('div', { class: 'hab-eyebrow' }, t('All chapters done')),
          h('h3', {}, t('You have walked the whole path.')),
          h('p', { class: 'hab-small' }, t('Keep breeding, collecting and caring: the field notes bring new tasks every day.'))));
      }
      // Daily field notes.
      const d = game.state.daily;
      out.push(h('div', { class: 'hab-daily' },
        h('div', { class: 'hab-daily-head' }, h('b', {}, t('Today\'s field notes')), h('span', { class: 'hab-small' }, t('Day {n} in the habitat', { n: game.state.daysPlayed }))),
        ...d.tasks.map((task) => {
          const def = byId(DAILY, task.id);
          const frac = Math.min(1, task.n / def.n);
          const shown = def.kind === 'calm' || def.kind === 'live' || def.kind === 'walking'
            ? `${Math.floor(task.n / 60)}:${String(Math.floor(task.n % 60)).padStart(2, '0')} / ${Math.round(def.n / 60)}:00` : `${Math.floor(task.n)} / ${def.n}`;
          return h('div', { class: `hab-note${task.done ? ' done' : ''}` },
            h('div', { class: 'hab-note-title' }, L(def.title)),
            h('div', { class: 'hab-progress small' }, h('span', { style: { transform: `scaleX(${frac})` } })),
            h('div', { class: 'hab-small' }, task.done ? t('done') : shown));
        }),
        h('div', { class: 'hab-small' }, d.bonus ? t('Bonus collected. See you tomorrow!') : t('All three: +25 leaves bonus.'))));
      return out;
    }

    // ---- journal tab -------------------------------------------------------------------------
    function journalTab() {
      const s = game.state;
      const nB = Object.keys(s.journal).length, nN = Object.keys(s.cards).length;
      const out = [h('div', { class: 'hab-collect' },
        h('div', {}, h('b', {}, `${nB} / ${BEHAVIOURS.length}`), h('span', {}, t('behaviours'))),
        h('div', {}, h('b', {}, `${nN} / ${NEURONS.length}`), h('span', {}, t('neuron cards'))),
        h('div', {}, h('b', {}, String(game.modalitiesSeen().size)), h('span', {}, t('senses'))))];
      const tile = (key, known, iconName, title, sub, cls) => h('button', { type: 'button', class: `hab-tile ${cls}${known ? '' : ' locked'}${openEntry === key ? ' open' : ''}`,
        onclick: () => { openEntry = openEntry === key ? null : key; stateVersion++; refresh(); } },
        icon(known ? iconName : 'help', 18), h('span', { class: 'hab-tile-title' }, known ? title : '???'), sub ? h('span', { class: 'hab-tile-sub' }, sub) : null);
      out.push(h('h4', { class: 'hab-h4' }, t('Behaviours')));
      const bGrid = h('div', { class: 'hab-grid' });
      for (const b of BEHAVIOURS) {
        const e = s.journal[b.id];
        bGrid.append(tile(`b:${b.id}`, !!e, b.icon, L(b.title), e ? `${e.count}×` : rarityLabel(b.rarity), `rar-${b.rarity}`));
      }
      out.push(bGrid);
      if (openEntry?.startsWith('b:')) out.push(entryDetail(openEntry));
      out.push(h('h4', { class: 'hab-h4' }, t('Neuron cards')));
      const nGrid = h('div', { class: 'hab-grid' });
      for (const n of NEURONS) nGrid.append(tile(`n:${n.id}`, !!s.cards[n.id], 'brain', L(n.name), n.label, 'neuron'));
      out.push(nGrid);
      if (openEntry?.startsWith('n:')) out.push(entryDetail(openEntry));
      return out;
    }

    function cite(refKey) {
      const ref = HABITAT_REFERENCES[refKey];
      if (!ref) return null;
      return h('a', { href: ref.doi, class: 'hab-cite', onclick: (e) => { e.preventDefault(); ctx.openExternalLink(ref.doi); } }, ref.cite);
    }

    // Measured wiring of a card's cells inside the running circuit: counted
    // from the connectome's edge list (signed synapse counts), on demand.
    const statsCache = new Map();
    async function cardStats(card) {
      if (statsCache.has(card.id)) return statsCache.get(card.id);
      const lists = await Promise.all((card.pops ?? []).map((population) => ctx.request('populationIndices', { population }).catch(() => null)));
      const cells = new Set(lists.flat().filter(Number.isInteger));
      const circuit = ctx.data?.circuit;
      let stats = null;
      if (cells.size && circuit?.edges) {
        const typeOf = (i) => circuit.neurons[i]?.cellType || circuit.neurons[i]?.type || '?';
        let synIn = 0, synOut = 0, inhIn = 0;
        const pre = new Set(), post = new Set(), inTypes = new Map(), outTypes = new Map();
        for (const [a, b, count] of circuit.edges) {
          const n = Math.abs(count);
          if (cells.has(b) && !cells.has(a)) {
            synIn += n; if (count < 0) inhIn += n; pre.add(a);
            inTypes.set(typeOf(a), (inTypes.get(typeOf(a)) ?? 0) + n);
          } else if (cells.has(a) && !cells.has(b)) {
            synOut += n; post.add(b);
            outTypes.set(typeOf(b), (outTypes.get(typeOf(b)) ?? 0) + n);
          }
        }
        const top = (m) => [...m].sort((x, y) => y[1] - x[1]).slice(0, 4);
        stats = { cells: cells.size, synIn, synOut, inhShare: synIn ? inhIn / synIn : 0, pre: pre.size, post: post.size,
          topIn: top(inTypes), topOut: top(outTypes) };
      }
      statsCache.set(card.id, stats);
      return stats;
    }

    function wiringBlock(card) {
      const el = h('div', { class: 'hab-wiring' }, h('div', { class: 'hab-small' }, t('Counting synapses…')));
      cardStats(card).then((st) => {
        if (!st) { el.replaceChildren(h('div', { class: 'hab-small' }, t('These cells are not part of the running circuit.'))); return; }
        const list = (pairs) => pairs.map(([type, n]) => `${type} (${int(n)})`).join(', ') || '—';
        el.replaceChildren(
          h('div', { class: 'hab-wiring-head' }, h('span', { class: 'hab-layer data' }, t('Data')), h('b', {}, t('In the connectome'))),
          h('div', { class: 'hab-wiring-nums' },
            h('div', {}, h('b', {}, int(st.cells)), h('span', {}, t('cells'))),
            h('div', {}, h('b', {}, int(st.synIn)), h('span', {}, t('input synapses'))),
            h('div', {}, h('b', {}, int(st.synOut)), h('span', {}, t('output synapses')))),
          h('div', { class: 'hab-small' }, t('From {n} cells, {p} % of them inhibitory. Strongest inputs: {list}.', { n: int(st.pre), p: Math.round(st.inhShare * 100), list: list(st.topIn) })),
          h('div', { class: 'hab-small' }, t('To {n} cells. Strongest outputs: {list}.', { n: int(st.post), list: list(st.topOut) })),
          h('div', { class: 'hab-small' }, t('Counted within the simulated circuit, not the whole brain.')));
      });
      return el;
    }

    function entryDetail(key) {
      const [kind, id] = key.split(':');
      if (kind === 'b') {
        const b = byId(BEHAVIOURS, id), e = game.state.journal[id];
        if (!e) return h('div', { class: 'hab-detail' }, h('p', {}, t('Not observed yet. Keep watching, or follow the quests.')));
        const groups = b.neurons.map((n) => byId(NEURONS, n).highlight).filter(Boolean);
        return h('div', { class: 'hab-detail' },
          h('b', {}, L(b.title)), h('p', {}, L(b.text, name())),
          h('div', { class: 'hab-chips' }, ...b.neurons.map((n) => h('span', { class: 'hab-chip' }, byId(NEURONS, n).label))),
          h('div', { class: 'hab-small' }, t('First seen {date} · {n} times', { date: new Date(e.first).toLocaleDateString(getLanguage()), n: e.count })),
          h('div', { class: 'hab-small' }, t('Simulation: the behaviour itself. The rule that turns the deciding neurons into the movement is a model.')),
          groups.length ? h('button', { type: 'button', class: 'btn small', onclick: () => highlight(groups) }, icon('brain', 14), t('Show in the brain')) : null);
      }
      const n = byId(NEURONS, id);
      if (!game.state.cards[id]) return h('div', { class: 'hab-detail' }, h('p', {}, t('Not found yet: observe a behaviour or a sense that uses these cells.')));
      return h('div', { class: 'hab-detail' },
        h('b', {}, `${L(n.name)} · ${n.label}`), h('p', {}, L(n.fact)),
        n.modality ? h('div', { class: 'hab-small' }, `${t('Sense')}: ${L(MODALITY_LABEL[n.modality])}`) : null,
        wiringBlock(n),
        h('div', { class: 'hab-small' }, t('Data: these cells and their wiring come from the connectome. Simulation: their activity.')),
        cite(n.ref),
        n.highlight ? h('button', { type: 'button', class: 'btn small', onclick: () => highlight([n.highlight]) }, icon('brain', 14), t('Show in the brain')) : null);
    }

    // ---- fly lab tab -----------------------------------------------------------------------
    const crossSel = { driver: null, effector: null };
    function labTab() {
      const s = game.state, now = Date.now();
      const out = [];
      // Colony.
      out.push(h('div', { class: 'hab-section-head' }, h('h4', { class: 'hab-h4' }, t('Your colony')), h('span', { class: 'hab-small' }, `${s.flies.length} / ${VIAL.maxFlies}`)));
      for (const f of s.flies) {
        const active = f.id === s.activeFly, inside = active && game.isBound(ctx.snap);
        const tm = temperament(f);
        out.push(h('div', { class: `hab-colony${active ? ' active' : ''}` },
          h('div', { class: 'hab-colony-head' },
            h('b', {}, f.name),
            h('span', { class: `hab-chip-geno${f.genotype ? ' gm' : ''}` }, genotypeText(f.genotype)),
            h('span', { class: 'hab-small' }, f.origin === 'founder' ? t('founder') : f.origin === 'cross' ? t('F1 of a cross') : t('wild type'))),
          tm ? h('div', { class: 'hab-temperament', title: t('Measured in the simulation: share of observed time per behaviour.') },
            ...[['walking', t('walks')], ['grooming', t('grooms')], ['flying', t('flies')], ['feeding', t('feeds')]].map(([k, label]) =>
              h('div', { class: 'hab-tbar' }, h('span', {}, label), h('i', {}, h('u', { style: { transform: `scaleX(${Math.min(1, tm[k] * 2)})` } })), h('em', {}, `${Math.round(tm[k] * 100)}%`))))
            : h('div', { class: 'hab-small' }, t('Temperament: measured after a minute in the terrarium.')),
          h('div', { class: 'hab-colony-actions' },
            inside ? h('span', { class: 'hab-here' }, icon('live', 14), t('in the terrarium'))
              : h('button', { type: 'button', class: 'btn small primary', onclick: () => act({ type: 'activate', fly: f.id }) }, t('Into the terrarium')),
            !active && s.flies.length > 1 ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => {
              if (window.confirm(t('Release {name}? The fly leaves your colony.', { name: f.name }))) act({ type: 'release', fly: f.id });
            } }, t('Release')) : null)));
      }
      // Vials.
      out.push(h('div', { class: 'hab-section-head' }, h('h4', { class: 'hab-h4' }, t('Vials')), h('span', { class: 'hab-small' }, `${s.vials.length} / ${VIAL.maxVials}`)));
      if (!s.vials.length) out.push(h('p', { class: 'hab-small' }, t('No vial is developing. Start a cross or a wild-type vial below.')));
      for (const v of s.vials) {
        const ready = now >= v.ready;
        out.push(h('div', { class: `hab-vial${ready ? ' ready' : ''}`, 'data-vial': String(v.id) },
          h('div', { class: 'hab-vial-tube' }, h('span', { class: 'hab-vial-fill', style: { transform: `scaleY(${Math.min(1, (now - v.started) / (v.ready - v.started))})` } })),
          h('div', { class: 'hab-vial-body' },
            h('b', {}, v.kind === 'cross' ? `${byId(STOCKS, v.driver).label} × ${byId(STOCKS, v.effector).label}` : t('Wild type')),
            h('div', { class: 'hab-small hab-vial-stage' }, vialStage(v, now)),
            ready ? h('button', { type: 'button', class: 'btn small primary', onclick: () => act({ type: 'collect', vial: v.id }) }, t('Collect the F1 fly')) : null)));
      }
      // New cross.
      const owned = (kind) => STOCKS.filter((x) => x.kind === kind && game.stockOwned(x.id));
      const drivers = owned('driver'), effectors = owned('effector');
      if (!crossSel.driver || !game.stockOwned(crossSel.driver)) crossSel.driver = drivers[0]?.id ?? null;
      if (!crossSel.effector || !game.stockOwned(crossSel.effector)) crossSel.effector = effectors[0]?.id ?? null;
      const select = (list, key) => {
        const el = h('select', { class: 'hab-select', onchange: () => { crossSel[key] = el.value; } }, ...list.map((x) => h('option', { value: x.id }, x.label)));
        el.value = crossSel[key] ?? '';
        return el;
      };
      out.push(h('div', { class: 'hab-cross' },
        h('div', { class: 'hab-eyebrow' }, t('New cross')),
        h('p', { class: 'hab-small' }, t('Driver (GAL4) marks a population; the effector (UAS) acts wherever GAL4 is. Their F1 carries both.'), ' ', cite('brand1993')),
        drivers.length && effectors.length ? h('div', { class: 'hab-cross-row' }, select(drivers, 'driver'), h('span', { class: 'hab-x' }, '×'), select(effectors, 'effector'))
          : h('p', { class: 'hab-small' }, t('Stocks arrive in the chapter "Fly genetics", or buy them below.')),
        h('div', { class: 'hab-cross-row' },
          h('button', { type: 'button', class: 'btn primary', disabled: !drivers.length || !effectors.length,
            onclick: () => act({ type: 'cross', driver: crossSel.driver, effector: crossSel.effector }) }, icon('flask', 15), t('Set up the cross'), h('span', { class: 'hab-cost' }, leafIcon(12), String(VIAL.crossCost))),
          h('button', { type: 'button', class: 'btn', onclick: () => act({ type: 'wild' }) }, t('Wild-type vial'), h('span', { class: 'hab-cost' }, leafIcon(12), String(VIAL.wildCost)))),
        h('p', { class: 'hab-small' }, t('Game time: a vial takes minutes and keeps developing while the app is closed. A real cross takes about ten days at 25 °C.'))));
      // Stock collection.
      out.push(h('h4', { class: 'hab-h4' }, t('Stock collection')));
      const level = game.rank().level + 1;
      for (const st of STOCKS) {
        const have = game.stockOwned(st.id);
        const card = st.card ? byId(NEURONS, st.card) : null;
        const what = st.kind === 'driver' ? `${t('Driver')} · ${card ? L(card.name) : ''}` : `${t('Effector')} · ${L(st.name)}`;
        out.push(h('div', { class: `hab-stock${have ? ' have' : ''}` },
          h('div', { class: 'hab-stock-body' }, h('b', {}, st.label), h('span', { class: 'hab-small' }, what),
            st.fact ? h('span', { class: 'hab-small' }, L(st.fact)) : null),
          have ? h('span', { class: 'hab-owned' }, t('in stock'))
            : level < st.level ? h('span', { class: 'hab-small' }, t('from level {n}', { n: st.level }))
              : st.cost === 0 ? h('span', { class: 'hab-small' }, t('comes with a quest'))
                : h('button', { type: 'button', class: 'btn small', disabled: game.state.leaves < st.cost, onclick: () => act({ type: 'buy', stock: st.id }) },
                  leafIcon(12), String(st.cost))));
      }
      return out;
    }

    function vialStage(v, now) {
      if (now >= v.ready) return t('Hatched: ready to collect');
      const f = (now - v.started) / (v.ready - v.started);
      const stage = f < 0.1 ? t('Eggs') : f < 0.5 ? t('Larvae') : t('Pupae');
      const left = Math.max(0, Math.ceil((v.ready - now) / 1000));
      return `${stage} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }

    // ---- garden tab --------------------------------------------------------------------------
    let placing = null;
    function startPlacing(item) {
      placing = item;
      terrarium?.setPlacement({ radius: item.radius, minFlyDistance: GARDEN.minFlyDistance, onPlace: (p) => {
        const res = act({ type: 'place', item: item.id, x: p.x, y: p.y });
        if (res.ok) { sound.play('hatch'); stopPlacing(); }
      } });
      stateVersion++;
      refresh();
    }
    function stopPlacing() {
      if (!placing) return;
      placing = null;
      terrarium?.setPlacement(null);
      stateVersion++;
      refresh();
    }
    const onKey = (e) => { if (e.key === 'Escape' && placing) stopPlacing(); };
    document.addEventListener('keydown', onKey);

    function gardenTab() {
      const s = game.state, level = game.rank().level + 1;
      const out = [h('div', { class: 'hab-garden-intro' },
        h('div', { class: 'hab-eyebrow' }, t('The fly\'s garden')),
        h('p', {}, t('What you place here becomes part of the simulated world: the fly\'s eye sees it, solid pieces are in the way, flowers and berries carry a scent (measured, but no neuron in this circuit smells it).')),
        h('button', { type: 'button', class: 'btn small', onclick: () => { terrarium?.setCameraMode?.('overhead'); } }, icon('camera', 14), t('View from above')))];
      if (placing) {
        out.push(h('div', { class: 'hab-placing' },
          h('span', {}, t('Click into the terrarium to place: {item}. Esc cancels.', { item: L(placing.name) })),
          h('button', { type: 'button', class: 'btn small', onclick: stopPlacing }, t('Cancel'))));
      }
      out.push(h('div', { class: 'hab-section-head' }, h('h4', { class: 'hab-h4' }, t('Catalogue')), h('span', { class: 'hab-small' }, `${s.garden.length} / ${GARDEN.maxPieces}`)));
      const grid = h('div', { class: 'hab-grid' });
      for (const item of GARDEN_ITEMS) {
        const stored = s.gardenStock[item.id] ?? 0;
        const locked = level < item.level;
        const price = stored ? t('{n} in storage', { n: stored }) : item.cost ? `${item.cost} ${t('leaves')}` : t('free');
        grid.append(h('button', { type: 'button', class: `hab-tile garden${locked ? ' locked' : ''}${placing?.id === item.id ? ' open' : ''}`,
          disabled: locked || (!stored && s.leaves < item.cost) || s.garden.length >= GARDEN.maxPieces,
          onclick: () => (placing?.id === item.id ? stopPlacing() : startPlacing(item)) },
          icon('world', 18), h('span', { class: 'hab-tile-title' }, L(item.name)),
          h('span', { class: 'hab-tile-sub' }, locked ? t('from level {n}', { n: item.level }) : price)));
      }
      out.push(grid);
      if (s.garden.length) {
        out.push(h('h4', { class: 'hab-h4' }, t('In the terrarium')));
        out.push(h('div', { class: 'hab-pieces' }, ...s.garden.map((g) => h('span', { class: 'hab-piece' },
          L(byId(GARDEN_ITEMS, g.item).name),
          h('button', { type: 'button', class: 'hab-piece-x', title: t('Back into storage'), 'aria-label': t('Back into storage'),
            onclick: () => act({ type: 'unplace', tag: g.tag }) }, icon('close', 12))))));
        out.push(h('p', { class: 'hab-small' }, t('Drag a piece in the terrarium to move it. Pieces taken back stay in storage and cost nothing to place again.')));
      }
      return out;
    }

    // ---- big question tab ------------------------------------------------------------------
    function questionTab() {
      const s = game.state;
      const n = Object.keys(s.criteria).length;
      const out = [h('div', { class: 'hab-question-intro' },
        h('div', { class: 'hab-eyebrow' }, t('Could a fly feel?')),
        h('p', {}, t('Scientists judge sentience by evidence for eight criteria (Birch et al. 2021). Investigate each one in your own fly: what does the model contain, what does it not?')),
        h('div', { class: 'hab-progress' }, h('span', { style: { transform: `scaleX(${n / CRITERIA.length})` } })),
        h('div', { class: 'hab-small' }, t('{n} of {m} investigated', { n, m: CRITERIA.length })))];
      for (const c of CRITERIA) {
        const a = audit.criteria.find((x) => x.id === c.id);
        const done = !!s.criteria[c.id];
        let action = null;
        if (!done && c.via.read) action = h('button', { type: 'button', class: 'btn small', onclick: () => { act({ type: 'read', criterion: c.id }); ctx.shell?.select('sentience'); } }, t('Read the evidence'));
        else if (!done && c.via.lab) action = h('button', { type: 'button', class: 'btn small', onclick: () => ctx.shell?.select('experiments') }, t('Open the Lab'));
        out.push(h('div', { class: `hab-crit${done ? ' done' : ''}` },
          h('div', { class: 'hab-crit-n' }, String(a?.n ?? '')),
          h('div', { class: 'hab-crit-body' },
            h('b', {}, t(a?.name ?? c.id)),
            h('div', { class: 'hab-small' }, t(a?.question ?? '')),
            done ? h('span', { class: `hab-status st-${a?.status}` }, `${t('In the model')}: ${statusLabel(a?.status)}`)
              : h('div', { class: 'hab-small hab-how' }, L(c.how)),
            action)));
      }
      const all = n === CRITERIA.length;
      out.push(h('div', { class: `hab-crit final${all ? ' done' : ''}` },
        h('div', { class: 'hab-crit-n' }, '?'),
        h('div', { class: 'hab-crit-body' },
          h('b', {}, t('Subjective experience')),
          all ? h('p', {}, t('You have looked at every criterion. The model contains some mechanisms in part, one only experimentally, others not at all. Whether a fly feels anything cannot be measured in a simulation: this question stays open, and that is the honest answer.'))
            : h('div', { class: 'hab-small' }, t('Opens when all eight criteria are investigated.')))));
      return out;
    }

    // ---- footer ------------------------------------------------------------------------------
    const noticeEl = h('p', { class: 'hab-notice', hidden: !S.notice });
    if (S.notice) {
      noticeEl.textContent = S.notice === 'storage' ? t('Local storage is not available: the game cannot be saved on this device.')
        : S.notice === 'unreadable' ? t('The saved game could not be read. It is kept aside and a new game started.')
          : t('Your leaves and your first fly\'s name were taken over from the prototype.');
      S.notice = null;
    }
    const exportBtn = h('button', { type: 'button', class: 'btn small ghost', onclick: () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(game.state, null, 2)], { type: 'application/json' }));
      const a = h('a', { href: url, download: 'NeuroCause-Habitat.json' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } }, icon('download', 14), t('Export save'));
    const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    importInput.addEventListener('change', async () => {
      try {
        const file = importInput.files[0];
        if (!file || file.size > 200_000) throw new Error('size');
        const state = decodeGame(await file.text());
        if (!window.confirm(t('Replace the current game with this save?'))) return;
        game.state = state;
        stateVersion++;
        saveGame();
        refresh();
        ctx.toast(t('Save loaded.'), 'ok');
      } catch { ctx.toast(t('This file is not a valid Habitat save.'), 'err'); }
      importInput.value = '';
    });
    const footer = h('div', { class: 'hab-foot' },
      h('div', { class: 'hab-layers' },
        h('span', { class: 'hab-layer data' }, t('Data'), h('small', {}, t('the wiring'))),
        h('span', { class: 'hab-layer sim' }, t('Simulation'), h('small', {}, t('everything the fly does'))),
        h('span', { class: 'hab-layer game' }, t('Game'), h('small', {}, t('care values, leaves, ranks')))),
      h('p', { class: 'hab-small' }, t('Care values describe how well the habitat looks after the fly. They are not its feelings.')),
      h('div', { class: 'hab-foot-actions' }, exportBtn,
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => importInput.click() }, t('Import save')), importInput));

    const root = h('section', { class: 'hab' }, header, noticeEl, flyCard, tabNav, tabBody, footer);

    // ---- live refresh (at most ~8 Hz from the shell) --------------------------------------------
    const DOING = {
      walking: [() => t('walks'), 'DNp09', 'fwd'], idle: [() => t('rests'), null, null], flying: [() => t('flies'), null, null],
      feeding: [() => t('feeds'), 'MN9', 'proboscis'], sleeping: [() => t('sleeps'), null, null],
    };
    let lastDoing = '', lastHead = '', lastAway = null, lastTemp = '';
    function refresh() {
      const s = game.state, snap = ctx.snap, fly = game.fly;
      // Header.
      const r = rankInfo(s.xp);
      const head = `${r.level}|${s.xp}|${s.leaves}|${getLanguage()}`;
      if (head !== lastHead) {
        lastHead = head;
        rankNum.textContent = String(r.level + 1);
        rankName.textContent = L(r.rank);
        xpFill.style.transform = `scaleX(${r.progress})`;
        xpText.textContent = r.next === null ? `${s.xp} XP` : `${s.xp} / ${r.next} XP`;
        leavesText.textContent = String(s.leaves);
      }
      // Fly card.
      if (!renaming && nameBtn.textContent !== fly.name) nameBtn.textContent = fly.name;
      const geno = genotypeText(fly.genotype);
      if (genoChip.textContent !== geno) { genoChip.textContent = geno; genoChip.classList.toggle('gm', !!fly.genotype); }
      const meta = `${modelSex === 'male' ? '♂' : '♀'} ${modelSex === 'male' ? t('male brain') : t('female brain')}`;
      if (metaChip.textContent !== meta) metaChip.textContent = meta;
      const bound = game.isBound(snap);
      const awayKey = !snap ? 'none' : snap.dead && snap.seed === fly.seed ? 'dead' : bound ? 'bound' : 'other';
      if (awayKey !== lastAway) {
        lastAway = awayKey;
        stateVersion++;     // the colony list shows who is in the terrarium
        away.hidden = awayKey === 'bound' || awayKey === 'none';
        flyCard.classList.toggle('away', !away.hidden);
        if (awayKey === 'dead') {
          awayText.textContent = t('The simulated body of {name} stopped. Restart the individual: same seed, same genotype.', { name: fly.name });
          bringBtn.textContent = t('Restart {name}', { name: fly.name });
          adoptBtn.hidden = true;
        } else if (awayKey === 'other') {
          awayText.textContent = t('Another individual is in the terrarium right now (seed {seed}).', { seed: snap.seed });
          bringBtn.textContent = t('Bring {name} in', { name: fly.name });
          adoptBtn.hidden = false;
        }
      }
      for (const k of NEEDS) gauges[k].set(fly.needs[k]);
      let d = '';
      if (bound && snap?.fly) {
        const st = snap.fly.state;
        if (st === 'grooming') {
          const head = snap.fly.groomMode === 'head';
          d = `${head ? t('grooms the head') : t('rubs the legs')} · ${head ? 'DNg12' : 'DNg11'} ${num(head ? snap.rates?.dng12 : snap.rates?.groom, 0)} Hz`;
        } else {
          const [label, cell, rate] = DOING[st] ?? DOING.idle;
          d = `${label()}${cell ? ` · ${cell} ${num(snap.rates?.[rate], 0)} Hz` : ''}`;
        }
        if (snap.fly.backward) d = `${t('walks backward')} · MDN ${num(snap.rates?.mdn, 0)} Hz`;
      } else d = t('not in the terrarium');
      if (d !== lastDoing) { lastDoing = d; doing.lastChild.textContent = d; doing.dataset.state = bound ? snap?.fly?.state ?? '' : 'away'; }
      const temp = snap?.env ? `${num(snap.env.tempC, 0)} °C` : '—';
      if (temp !== lastTemp) { lastTemp = temp; tempText.textContent = temp; }
      const opsin = fly.genotype && byId(STOCKS, fly.genotype.effector)?.mode === 'activate';
      lightBtn.hidden = !opsin || !bound;
      const heat = fly.genotype && byId(STOCKS, fly.genotype.effector)?.mode === 'heat';
      heatChip.hidden = !heat || !bound;
      const heatText = game.rt.heatOn ? t('Heat switch open (above 27 °C)') : t('Heat switch closed: opens at 29 °C');
      if (heatChip.textContent !== heatText) { heatChip.textContent = heatText; heatChip.classList.toggle('on', game.rt.heatOn); }
      lightBtn.classList.toggle('on', game.rt.lightOn);
      lightBtn.lastChild.textContent = game.rt.lightOn ? t('Red light off') : t('Red light on');
      // The most urgent need, as a bubble over the fly.
      const low = bound ? NEEDS.map((k) => ({ k, v: fly.needs[k] })).filter((x) => x.v < 35).sort((a, b) => a.v - b.v)[0] : null;
      overlay.setBubble(low ? { key: low.k, icon: NEED_UI[low.k].icon, label: NEED_UI[low.k].low() } : null);
      // Tabs: rebuilt only when something changed.
      for (const [id] of TABS) {
        tabBtns[id].setAttribute('aria-selected', String(S.tab === id));
        tabBtns[id].classList.toggle('on', S.tab === id);
      }
      const readyVials = game.state.vials.filter((v) => Date.now() >= v.ready).length;
      setBadge('lab', readyVials);
      if (shownVersion !== stateVersion) {
        shownVersion = stateVersion;
        const build = { quests: questsTab, journal: journalTab, garden: gardenTab, lab: labTab, question: questionTab }[S.tab];
        const top = root.parentElement?.scrollTop;
        tabBody.replaceChildren(...build());
        if (top !== undefined && root.parentElement) root.parentElement.scrollTop = top;
      } else if (S.tab === 'lab') {
        for (const el of tabBody.querySelectorAll('[data-vial]')) {
          const v = game.state.vials.find((x) => String(x.id) === el.dataset.vial);
          if (!v) continue;
          const now = Date.now();
          const text = vialStage(v, now);
          const stageEl = el.querySelector('.hab-vial-stage');
          if (stageEl && stageEl.textContent !== text) stageEl.textContent = text;
          el.querySelector('.hab-vial-fill').style.transform = `scaleY(${Math.min(1, (now - v.started) / (v.ready - v.started))})`;
          if (now >= v.ready && !el.classList.contains('ready')) stateVersion++;
        }
      }
    }
    function setBadge(id, n) {
      const b = tabBtns[id].querySelector('.hab-badge');
      const text = n ? String(n) : '';
      if (b.textContent !== text) { b.textContent = text; b.hidden = !n; }
    }

    // Every snapshot: events arrive once, so the game sees all of them.
    // A restarted app has a new terrarium: the garden comes back.
    if (terrarium?.world) send(game.restoreCommands(terrarium.world.objects.map((o) => o.tag).filter(Boolean)));

    // The first visit: who the fly is and what the game is about.
    if (!game.state.introSeen) {
      game.state.introSeen = true;
      saveGame();
      setTimeout(() => overlay.card({ tone: 'quest', iconName: 'spark', eyebrow: t('Welcome to the Habitat'),
        title: t('This is {name}.', { name: name() }),
        text: t('Every move {name} makes comes from a simulated brain of {n} neurons, wired like the real connectome. Look after {name}, discover what the neurons do, breed new lines, and find out what the model can say about feelings.',
          { name: name(), n: int(ctx.snap?.n ?? ctx.data?.circuit?.neurons?.length ?? 0) }), ms: 16000 }), 600);
    }

    const offFrame = ctx.onFrame((snap, extra) => {
      if (extra?.pick || snap === lastSnap) return;
      lastSnap = snap;
      handleRewards(game.observe(snap, Date.now()));
      overlay.follow();
    });
    const onLeave = () => saveGame();
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onLeave);
    refresh();

    return {
      el: root,
      update() {
        // Lab protocols finished in this session count for the big question.
        for (const [id, st] of ctx.state.experiments ?? []) {
          if (st?.status === 'done' && !game.state.labRuns[id]) handleRewards(game.act({ type: 'lab', protocol: id }, Date.now()).rewards);
        }
        // Pieces dragged in the terrarium keep their new places.
        if (terrarium?.world && game.syncGarden(terrarium.world.objects)) stateVersion++;
        refresh();
        if (performance.now() - S.savedAt > SAVE_EVERY_MS) saveGame();
      },
      dispose() {
        offFrame();
        stopPlacing();
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('pagehide', onLeave);
        document.removeEventListener('visibilitychange', onLeave);
        // The red light belongs to the game: off when the player leaves.
        if (game.rt.lightOn) act({ type: 'light', on: false });
        overlay.dispose();
        sound.dispose();
        saveGame();
      },
    };
  },
};
