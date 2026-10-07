// habitat-game.js — the rules of the Habitat game. It reads simulation
// snapshots and turns them into care values, discoveries and quest progress;
// it answers player actions with the Studio commands they need (a new
// individual, its genotype). It never touches the simulation itself, has no
// DOM, and is deterministic for a given state, snapshot stream and clock, so
// test/habitatgametest.mjs can drive it with synthetic snapshots.
//
// Care values are a game model of how well the habitat looks after the fly
// (food eaten, startles, climate, dust). They are not her feelings.

import { BEHAVIOURS, NEURONS, QUESTS, CHAPTERS, DAILY, DAILY_REWARD, STOCKS, VIAL, FLY_NAMES, RANKS, RARITY,
  CRITERIA, TRIGGER_CARDS, OPTO_STRENGTH, HEAT_ON_C, HEAT_OFF_C, GARDEN_ITEMS, GARDEN, byId } from './habitat-content.js';

export const SAVE_KEY = 'neurocause.habitat.v2';
export const LEGACY_KEY = 'neurocause.habitat.v1';   // the first prototype
export const SCHEMA = 5;
export const NEEDS = Object.freeze(['energy', 'calm', 'climate', 'clean']);
const STATES = ['walking', 'idle', 'grooming', 'flying', 'feeding', 'sleeping'];

// Game model of the body's energy, per simulated second (flight costs most).
const ENERGY_USE = { idle: 0.07, walking: 0.14, grooming: 0.09, flying: 0.5, feeding: 0, sleeping: 0.03 };
const FEED_GAIN = 4;                  // per second actually feeding
const CALM_RECOVERY = 0.6, CALM_SLEEP = 1.5;
const STARTLE = { takeoff: 18, dart: 8, backward: 5 };
const HARSH = { quake: 3, fire: 3, flood: 3, smoke: 2, iceRain: 1.5, rain: 0.6 };
const CARE_TICK_S = 120, CARE_LEAVES = 2, CARE_XP = 2, CARE_LEAVES_PER_DAY = 40;
const CRITERION_REWARD = { xp: 25, leaves: 5 };
const CARD_REWARD = { xp: 15, leaves: 2 };
const MILESTONE = { xp: 100, leaves: 30 };
const INPUT_ON = 0.2;
const MAX_DT = 1;                    // longer gaps (pause, new run) count nothing
export const DOSE_PERCENTS = Object.freeze([60, 80, 100]);
const DOSE_WINDOW_S = 4;             // simulated seconds for the proboscis to come out

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp100 = (v) => Math.max(0, Math.min(100, v));
export const fillName = (text, name) => String(text).replaceAll('{name}', name);

export function localDay(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function levelOf(xp) {
  let level = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) level = i;
  return level;
}

// Where the player stands: rank, progress to the next one.
export function rankInfo(xp) {
  const level = levelOf(xp);
  const from = RANKS[level].xp, to = RANKS[level + 1]?.xp ?? null;
  return { level, rank: RANKS[level], next: to, progress: to === null ? 1 : (xp - from) / (to - from) };
}

export function climateScore(snap) {
  const c = snap?.body?.effectiveTempC ?? snap?.env?.tempC ?? 25;
  let v = c >= 24 && c <= 26 ? 100 : c < 24 ? 100 * clamp01((c - 16) / 8) : 100 * clamp01((34 - c) / 8);
  v *= 1 - 0.5 * clamp01(snap?.body?.wetness ?? 0);
  v *= clamp01(snap?.body?.oxygenScale ?? 1);
  const env = snap?.env ?? {};
  if (env.fire) v *= 0.3;
  if (env.smoke) v *= 0.5;
  if (env.flood) v *= 0.2;
  return v;
}

export const cleanScore = (snap) => 100 * (1 - clamp01(snap?.env?.dustLoad ?? 0));

function hashDay(day) {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

function newFly(id, name, seed, origin, now, genotype = null) {
  return {
    id, name, seed: seed >>> 0, origin, born: now, genotype,
    needs: { energy: 80, calm: 90, climate: 100, clean: 100 },
    time: Object.fromEntries(STATES.map((k) => [k, 0])), observed: 0,
    counts: { takeoff: 0, feeding: 0, grooming: 0, dart: 0 },
  };
}

// A new game. The founder adopts the fly running in the terrarium (seed 0 =
// adopt on the first snapshot).
export function newGame({ now = Date.now(), seed = 0, rng = 1 } = {}) {
  const day = localDay(now);
  const state = {
    version: SCHEMA, created: now, rng: (rng >>> 0) || 1, xp: 0, leaves: 30, sound: true, introSeen: false,
    flies: [newFly('f1', FLY_NAMES[0], seed, 'founder', now)], activeFly: 'f1', nextFly: 2,
    journal: {}, cards: {}, quests: {}, criteria: {}, labRuns: {},
    stocks: [], vials: [], nextVial: 1, counters: { crosses: 0, wilds: 0, collected: 0, events: 0 },
    garden: [], gardenStock: {}, nextTag: 1,
    daily: { day, tasks: [], bonus: false, careLeaves: 0 }, daysPlayed: 1,
  };
  state.daily.tasks = dailyTasks(day);
  return state;
}

function dailyTasks(day) {
  const pool = DAILY.map((d) => d.id);
  let h = hashDay(day);
  const out = [];
  while (out.length < 3 && pool.length) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    out.push({ id: pool.splice(h % pool.length, 1)[0], n: 0, done: false });
  }
  return out;
}

// ---- saves ------------------------------------------------------------------------------------
// Rebuilds a known schema from untrusted JSON: anything unknown or out of
// range is dropped, nothing else is carried along.
export function decodeGame(text) {
  if (typeof text !== 'string' || text.length > 200_000) throw new Error('save too large');
  const s = JSON.parse(text);
  if (!s || s.version !== SCHEMA || !Array.isArray(s.flies) || !s.flies.length) throw new Error('not a habitat save');
  const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const int = (v, lo, hi, fallback) => Math.round(num(v, lo, hi, fallback));
  const name = (v) => (typeof v === 'string' && v.trim() && v.length <= 24 && !/[\u0000-\u001f]/.test(v) ? v.trim() : null);
  const stockIds = new Set(STOCKS.map((x) => x.id));
  const genotype = (g) => (g && byId(STOCKS, g.driver)?.kind === 'driver' && byId(STOCKS, g.effector)?.kind === 'effector'
    ? { driver: g.driver, effector: g.effector } : null);
  const ids = new Set();
  const flies = [];
  for (const f of s.flies.slice(0, VIAL.maxFlies)) {
    if (!f || typeof f.id !== 'string' || !/^f\d{1,4}$/.test(f.id) || ids.has(f.id) || !name(f.name)) continue;
    ids.add(f.id);
    const fly = newFly(f.id, name(f.name), int(f.seed, 0, 4294967295, 0), ['founder', 'wild', 'cross'].includes(f.origin) ? f.origin : 'wild',
      num(f.born, 0, 1e15, 0), genotype(f.genotype));
    for (const k of NEEDS) fly.needs[k] = num(f.needs?.[k], 0, 100, fly.needs[k]);
    for (const k of STATES) fly.time[k] = num(f.time?.[k], 0, 1e9, 0);
    fly.observed = num(f.observed, 0, 1e9, 0);
    for (const k of Object.keys(fly.counts)) fly.counts[k] = int(f.counts?.[k], 0, 1e9, 0);
    flies.push(fly);
  }
  if (!flies.length) throw new Error('no valid fly');
  const stamps = (obj, valid) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {})
    .filter(([k, v]) => valid(k) && typeof v === 'number' && Number.isFinite(v)));
  const journal = {};
  for (const [k, v] of Object.entries(s.journal && typeof s.journal === 'object' ? s.journal : {})) {
    if (byId(BEHAVIOURS, k) && v && Number.isFinite(v.first)) journal[k] = { first: v.first, count: int(v.count, 1, 1e9, 1) };
  }
  const quests = {};
  for (const [k, v] of Object.entries(s.quests && typeof s.quests === 'object' ? s.quests : {})) {
    if (byId(QUESTS, k) && v) quests[k] = { n: num(v.n, 0, 1e9, 0), done: num(v.done, 0, 1e15, 0) };
  }
  const vials = (Array.isArray(s.vials) ? s.vials : []).slice(0, VIAL.maxVials).filter((v) => v && (v.kind === 'wild'
    || (v.kind === 'cross' && genotype(v))) && Number.isFinite(v.ready) && Number.isFinite(v.started))
    .map((v) => ({ id: int(v.id, 1, 1e9, 1), kind: v.kind, ...(v.kind === 'cross' ? genotype(v) : {}), started: v.started, ready: v.ready }));
  const day = typeof s.daily?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.daily.day) ? s.daily.day : localDay(Date.now());
  const tasks = (Array.isArray(s.daily?.tasks) ? s.daily.tasks : []).filter((x) => byId(DAILY, x?.id)).slice(0, 3)
    .map((x) => ({ id: x.id, n: num(x.n, 0, 1e9, 0), done: x.done === true }));
  const state = {
    version: SCHEMA, created: num(s.created, 0, 1e15, Date.now()), rng: int(s.rng, 1, 4294967295, 1),
    xp: int(s.xp, 0, 1e7, 0), leaves: int(s.leaves, 0, 1e7, 0), sound: s.sound !== false, introSeen: s.introSeen === true,
    flies, activeFly: ids.has(s.activeFly) ? s.activeFly : flies[0].id,
    nextFly: Math.max(int(s.nextFly, 2, 1e6, 2), ...flies.map((f) => Number(f.id.slice(1)) + 1)),
    journal, cards: stamps(s.cards, (k) => byId(NEURONS, k)), quests,
    criteria: stamps(s.criteria, (k) => byId(CRITERIA, k)), labRuns: stamps(s.labRuns, (k) => /^[a-z-]{1,40}$/.test(k)),
    stocks: (Array.isArray(s.stocks) ? s.stocks : []).filter((x, i, a) => stockIds.has(x) && a.indexOf(x) === i),
    vials, nextVial: Math.max(int(s.nextVial, 1, 1e9, 1), ...vials.map((v) => v.id + 1)),
    counters: { crosses: int(s.counters?.crosses, 0, 1e9, 0), wilds: int(s.counters?.wilds, 0, 1e9, 0),
      collected: int(s.counters?.collected, 0, 1e9, 0), events: int(s.counters?.events, 0, 1e9, 0) },
    garden: (Array.isArray(s.garden) ? s.garden : []).filter((g, i, a) => g && byId(GARDEN_ITEMS, g.item)
      && typeof g.tag === 'string' && /^g\d{1,6}$/.test(g.tag) && a.findIndex((x) => x?.tag === g.tag) === i
      && Number.isFinite(g.x) && Number.isFinite(g.y)).slice(0, GARDEN.maxPieces)
      .map((g) => ({ tag: g.tag, item: g.item, seed: int(g.seed, 1, 4294967295, 1), x: num(g.x, -5000, 5000, 0), y: num(g.y, -5000, 5000, 0) })),
    gardenStock: Object.fromEntries(Object.entries(s.gardenStock && typeof s.gardenStock === 'object' ? s.gardenStock : {})
      .filter(([k]) => byId(GARDEN_ITEMS, k)).map(([k, v]) => [k, int(v, 0, 999, 0)]).filter(([, v]) => v > 0)),
    nextTag: 1,
    daily: { day, tasks: tasks.length ? tasks : dailyTasks(day), bonus: s.daily?.bonus === true,
      careLeaves: int(s.daily?.careLeaves, 0, 1e6, 0) },
    daysPlayed: int(s.daysPlayed, 1, 1e6, 1),
  };
  state.nextTag = Math.max(int(s.nextTag, 1, 1e6, 1), ...state.garden.map((g) => Number(g.tag.slice(1)) + 1));
  return state;
}

// The first prototype's save (schema 1-4): its leaves and the first
// companion's name carry over into a new game.
export function migrateLegacy(text, opts = {}) {
  const old = JSON.parse(text);
  if (!old || ![1, 2, 3, 4].includes(old.version)) throw new Error('not a prototype save');
  const state = newGame(opts);
  const points = Number.isSafeInteger(old.points) ? Math.min(500, Math.max(0, old.points)) : 0;
  state.leaves = Math.max(state.leaves, points);
  const first = Array.isArray(old.pets) ? old.pets[0]?.name : null;
  if (typeof first === 'string' && first.trim() && first.length <= 24 && !/[\u0000-\u001f]/.test(first)) state.flies[0].name = first.trim();
  return state;
}

// ---- the game ---------------------------------------------------------------------------------
export class HabitatGame {
  constructor(state) {
    this.state = state;
    this.rt = { lastT: null, lastIndividual: null, prevState: null, careT: 0, bitterT: 0, climateT: 0, lightOn: false,
      offer: null, dose: {}, heatOn: false };   // dose: { [percent]: true | false } for the sweetness quest
  }

  get fly() { return this.state.flies.find((f) => f.id === this.state.activeFly) ?? this.state.flies[0]; }
  flyById(id) { return this.state.flies.find((f) => f.id === id) ?? null; }
  stockOwned(id) { return this.state.stocks.includes(id); }
  questDone(id) { return Boolean(this.state.quests[id]?.done); }
  rank() { return rankInfo(this.state.xp); }

  // Is the active game fly the one in the terrarium?
  isBound(snap) { return Boolean(snap) && snap.seed === this.fly.seed && !snap.dead; }

  chapterUnlocked(chapterId) {
    const at = CHAPTERS.findIndex((c) => c.id === chapterId);
    return CHAPTERS.slice(0, at).every((c) => QUESTS.filter((q) => q.chapter === c.id).every((q) => this.questDone(q.id)));
  }

  currentChapter() {
    return CHAPTERS.find((c) => !QUESTS.filter((q) => q.chapter === c.id).every((q) => this.questDone(q.id))) ?? null;
  }

  questAvailable(q) { return !this.questDone(q.id) && this.chapterUnlocked(q.chapter); }

  // ---- every snapshot -----------------------------------------------------------------------
  observe(snap, now = Date.now()) {
    const R = [];
    const s = this.state, rt = this.rt;
    if (!snap) return R;
    this._rollDay(now, R);
    const fly = this.fly;
    // The founder adopts the fly that is running when the game starts.
    if (fly.seed === 0 && Number.isFinite(snap.seed) && snap.seed > 0 && !snap.dead) fly.seed = snap.seed >>> 0;
    const sameRun = rt.lastIndividual === snap.individual;
    let dt = sameRun && rt.lastT !== null ? snap.t - rt.lastT : 0;
    if (!(dt > 0) || dt > MAX_DT || snap.paused) dt = 0;
    rt.lastT = snap.t;
    rt.lastIndividual = snap.individual;
    const bound = this.isBound(snap);

    for (const e of snap.events ?? []) this._onEvent(e, snap, bound, now, R);
    this._checkOffer(snap, bound, now, R);
    const st = snap.fly?.state;
    if (st && st !== rt.prevState) {
      if (st === 'walking') this._discover('walk', null, now, R);
      if (st === 'sleeping') this._discover('sleep', null, now, R);
      if (rt.prevState === 'flying') this._discover('landing', null, now, R);
      rt.prevState = st;
    }
    for (const card of NEURONS) {
      if (card.inputs && !s.cards[card.id] && card.inputs.some((k) => (snap.inputs?.[k] ?? 0) > INPUT_ON)) this._card(card.id, now, R);
    }
    if (bound && dt > 0) this._tickBody(fly, snap, dt, now, R);
    if (bound) this._heatSwitch(fly, snap, R);
    this._checkQuests(now, R);
    return R;
  }

  _tickBody(fly, snap, dt, now, R) {
    const s = this.state, rt = this.rt, n = fly.needs;
    const st = STATES.includes(snap.fly?.state) ? snap.fly.state : 'idle';
    n.energy = clamp100(n.energy - ENERGY_USE[st] * dt + (st === 'feeding' ? FEED_GAIN * dt : 0));
    let calm = n.calm + (st === 'sleeping' ? CALM_SLEEP : CALM_RECOVERY) * dt;
    for (const [k, v] of Object.entries(HARSH)) if (snap.env?.[k]) calm -= (v + CALM_RECOVERY) * dt;
    n.calm = clamp100(calm);
    // Climate and dust follow the world, eased so a brief change does not jump.
    const k = 1 - Math.exp(-dt / 3);
    n.climate = clamp100(n.climate + (climateScore(snap) - n.climate) * k);
    n.clean = clamp100(n.clean + (cleanScore(snap) - n.clean) * Math.min(1, k * 2));
    fly.time[st] += dt;
    fly.observed += dt;
    // Looked after: a few leaves every two simulated minutes, up to a daily cap.
    rt.careT += dt;
    if (rt.careT >= CARE_TICK_S) {
      rt.careT -= CARE_TICK_S;
      if (NEEDS.every((x) => n[x] >= 60) && s.daily.careLeaves < CARE_LEAVES_PER_DAY) {
        s.daily.careLeaves += CARE_LEAVES;
        this._reward(CARE_XP, CARE_LEAVES, R);
        R.push({ kind: 'care', leaves: CARE_LEAVES });
      }
    }
    this._dailyProgress('live', null, dt, now, R);
    if (st === 'walking') this._dailyProgress('walking', null, dt, now, R);
    if (n.calm >= 80) this._dailyProgress('calm', null, dt, now, R);
    // Quest: a bitter drop on the labellum, and the proboscis stays in.
    const bitterQ = byId(QUESTS, 'bitter');
    if (this.questAvailable(bitterQ)) {
      if (st === 'feeding') rt.bitterT = 0;
      else if ((snap.inputs?.bitter ?? 0) > 0.15 && (snap.fly?.proboscis ?? 0) < 0.5) rt.bitterT += dt;
      if (rt.bitterT >= 2) this._completeQuest(bitterQ, now, R);
    }
    // Quest: hot cells driven, then back in the comfortable range.
    const climateQ = byId(QUESTS, 'climate');
    if (this.questAvailable(climateQ)) {
      const q = this._quest(climateQ.id);
      if (q.n === 0 && (snap.inputs?.hot ?? 0) > 0.3) { q.n = 1; R.push({ kind: 'step', id: climateQ.id }); }
      else if (q.n === 1) {
        rt.climateT = climateScore(snap) >= 90 && (snap.inputs?.hot ?? 0) < 0.1 ? rt.climateT + dt : 0;
        if (rt.climateT >= 20) this._completeQuest(climateQ, now, R);
      }
    }
  }

  _onEvent(e, snap, bound, now, R) {
    const s = this.state, fly = this.fly;
    if (e.kind === 'death') { R.push({ kind: 'death' }); return; }
    const b = BEHAVIOURS.find((x) => x.event === e.kind);
    if (!b) return;
    s.counters.events++;
    this._discover(b.id, e, now, R);
    for (const id of TRIGGER_CARDS[e.trigger?.channel] ?? []) this._card(id, now, R);
    if (bound) {
      if (STARTLE[e.kind]) fly.needs.calm = clamp100(fly.needs.calm - STARTLE[e.kind]);
      if (e.kind === 'takeoff' || e.kind === 'dart') fly.counts[e.kind]++;
      if (e.kind === 'feeding') fly.counts.feeding++;
      if (e.kind === 'headGrooming' || e.kind === 'legGrooming') fly.counts.grooming++;
    }
    this._dailyProgress('event', e.kind, 1, now, R);
    if (s.counters.events % 10 === 0) this._dailyProgress('card', null, 1, now, R);
    // Genetics quests read the genotype the simulation actually runs.
    const silenced = (pop) => (snap.genetics ?? []).some((g) => g.mode === 'silence' && g.population === pop);
    const activated = (pop) => (snap.genetics ?? []).some((g) => g.mode === 'activate' && g.population === pop);
    if (bound && e.kind === 'dart' && silenced('gf') && this.questAvailable(byId(QUESTS, 'silent'))) {
      this._completeQuest(byId(QUESTS, 'silent'), now, R);
    }
    if (bound && e.kind === 'headGrooming' && this.rt.lightOn && activated('dng12') && this.questAvailable(byId(QUESTS, 'opto'))) {
      this._completeQuest(byId(QUESTS, 'opto'), now, R);
    }
    if (bound && e.kind === 'backward' && this.rt.heatOn && activated('mdn') && this.questAvailable(byId(QUESTS, 'heat'))) {
      this._completeQuest(byId(QUESTS, 'heat'), now, R);
    }
  }

  // UAS-TrpA1: the population is activated while the terrarium is warm, with
  // a little hysteresis. The command goes out with the rewards (kind 'command').
  _heatSwitch(fly, snap, R) {
    const g = fly.genotype;
    if (!g || byId(STOCKS, g.effector)?.mode !== 'heat') return;
    const c = snap.body?.effectiveTempC ?? snap.env?.tempC;
    if (!Number.isFinite(c)) return;
    const want = this.rt.heatOn ? c >= HEAT_OFF_C : c >= HEAT_ON_C;
    if (want === this.rt.heatOn) return;
    this.rt.heatOn = want;
    R.push({ kind: 'command', name: 'genetics.set', args: { population: byId(STOCKS, g.driver).population, mode: 'activate', strength: OPTO_STRENGTH, on: want } });
    R.push({ kind: 'heatSwitch', on: want });
  }

  // The sweetness quest: did the proboscis come out within a few seconds of
  // the drop touching it (an explained proboscis or feeding event)?
  _checkOffer(snap, bound, now, R) {
    const o = this.rt.offer;
    if (!o) return;
    if (!bound || !Number.isFinite(snap.t)) { this.rt.offer = null; return; }
    if (o.t === null) o.t = snap.t;
    const responded = (snap.events ?? []).some((e) => e.kind === 'proboscis' || e.kind === 'feeding')
      || (snap.fly?.proboscis ?? 0) > 0.5;
    if (!responded && snap.t - o.t < DOSE_WINDOW_S) return;
    this.rt.offer = null;
    this.rt.dose[o.percent] = responded;
    R.push({ kind: 'dose', percent: o.percent, responded });
    const q = byId(QUESTS, 'dose');
    const results = Object.values(this.rt.dose);
    if (this.questAvailable(q) && results.includes(true) && results.includes(false)) this._completeQuest(q, now, R);
  }

  _discover(id, e, now, R) {
    const s = this.state, b = byId(BEHAVIOURS, id);
    if (!b) return;
    const entry = s.journal[id];
    if (entry) { entry.count++; return; }
    s.journal[id] = { first: now, count: 1 };
    const r = RARITY[b.rarity];
    this._reward(r.xp, r.leaves, R);
    R.push({ kind: 'discovery', id, event: e ? { trigger: e.trigger ?? null, command: e.command ?? null, commandRateHz: e.commandRateHz ?? null } : null });
    for (const c of b.neurons) this._card(c, now, R);
    if (Object.keys(s.journal).length === BEHAVIOURS.length) this._milestone('behaviours', R);
  }

  _card(id, now, R) {
    const s = this.state;
    if (s.cards[id] || !byId(NEURONS, id)) return;
    s.cards[id] = now;
    this._reward(CARD_REWARD.xp, CARD_REWARD.leaves, R);
    R.push({ kind: 'card', id });
    if (Object.keys(s.cards).length === NEURONS.length) this._milestone('cards', R);
    this._dailyProgress('card', null, 1, now, R);
  }

  // A completed collection: a one-off bonus.
  _milestone(id, R) {
    this._reward(MILESTONE.xp, MILESTONE.leaves, R);
    R.push({ kind: 'milestone', id });
  }

  _reward(xp, leaves, R) {
    const s = this.state;
    const before = levelOf(s.xp);
    s.xp = Math.min(1e7, s.xp + xp);
    s.leaves = Math.min(1e7, s.leaves + leaves);
    const after = levelOf(s.xp);
    if (after > before) R.push({ kind: 'level', level: after });
  }

  _quest(id) { return (this.state.quests[id] ??= { n: 0, done: 0 }); }

  _completeQuest(q, now, R) {
    if (this.questDone(q.id)) return;
    const chapterBefore = this.currentChapter()?.id ?? null;
    this._quest(q.id).done = now;
    this._reward(q.xp, q.leaves, R);
    R.push({ kind: 'quest', id: q.id });
    for (const g of q.gift ?? []) this._gift(g, R);
    const chapterNow = this.currentChapter();
    if (chapterNow && chapterNow.id !== chapterBefore) {
      R.push({ kind: 'chapter', id: chapterNow.id });
      for (const g of chapterNow.gift ?? []) this._gift(g, R);
    }
  }

  _gift(stockId, R) {
    if (this.stockOwned(stockId)) return;
    this.state.stocks.push(stockId);
    R.push({ kind: 'gift', id: stockId });
  }

  _checkQuests(now, R) {
    const s = this.state;
    for (const q of QUESTS) {
      if (!this.questAvailable(q)) continue;
      if (q.kind === 'discover' && q.targets.every((t) => s.journal[t])) this._completeQuest(q, now, R);
      else if (q.kind === 'cross' && s.counters.crosses > 0) this._completeQuest(q, now, R);
      else if (q.kind === 'collect' && s.counters.collected > 0) this._completeQuest(q, now, R);
      else if (q.kind === 'garden' && s.garden.length > 0) this._completeQuest(q, now, R);
      else if (q.kind === 'criteria' && Object.keys(s.criteria).length >= q.n) this._completeQuest(q, now, R);
    }
    this._checkCriteria(now, R);
  }

  modalitiesSeen() {
    return new Set(Object.keys(this.state.cards).map((id) => byId(NEURONS, id)?.modality).filter(Boolean));
  }

  _checkCriteria(now, R) {
    const s = this.state;
    for (const c of CRITERIA) {
      if (s.criteria[c.id]) continue;
      const v = c.via;
      const ok = (v.quest && v.quest.some((id) => this.questDone(id)))
        || (v.modalities && this.modalitiesSeen().size >= v.modalities)
        || (v.lab && s.labRuns[v.lab]);
      if (ok) this._investigate(c.id, now, R);
    }
  }

  _investigate(id, now, R) {
    if (this.state.criteria[id]) return;
    this.state.criteria[id] = now;
    this._reward(CRITERION_REWARD.xp, CRITERION_REWARD.leaves, R);
    R.push({ kind: 'criterion', id });
    // The criterion quests count investigated criteria.
    for (const q of QUESTS) if (q.kind === 'criteria' && this.questAvailable(q) && Object.keys(this.state.criteria).length >= q.n) this._completeQuest(q, now, R);
  }

  // ---- daily field notes ----------------------------------------------------------------------
  _rollDay(now, R) {
    const s = this.state, day = localDay(now);
    if (s.daily.day === day) return;
    s.daily = { day, tasks: dailyTasks(day), bonus: false, careLeaves: 0 };
    s.daysPlayed = Math.min(1e6, s.daysPlayed + 1);
    R.push({ kind: 'newDay', day });
  }

  _dailyProgress(kind, target, amount, now, R) {
    const s = this.state;
    for (const task of s.daily.tasks) {
      if (task.done) continue;
      const d = byId(DAILY, task.id);
      if (!d || d.kind !== kind || (d.targets && !d.targets.includes(target))) continue;
      task.n = Math.min(d.n, task.n + amount);
      if (task.n >= d.n) {
        task.done = true;
        this._reward(DAILY_REWARD.task.xp, DAILY_REWARD.task.leaves, R);
        R.push({ kind: 'daily', id: task.id });
        if (!s.daily.bonus && s.daily.tasks.every((x) => x.done)) {
          s.daily.bonus = true;
          this._reward(DAILY_REWARD.bonus.xp, DAILY_REWARD.bonus.leaves, R);
          R.push({ kind: 'dailyBonus' });
        }
      }
    }
  }

  // ---- player actions -------------------------------------------------------------------------
  // Returns { ok, reason, rewards, commands }: `commands` are Studio commands
  // ([name, args]) the caller sends to the simulation.
  act(action, now = Date.now(), snap = null) {
    const R = [], s = this.state;
    const done = (extra = {}) => { this._checkQuests(now, R); return { ok: true, rewards: R, commands: [], ...extra }; };
    const fail = (reason) => ({ ok: false, reason, rewards: R, commands: [] });
    switch (action?.type) {
      case 'rename': {
        const name = String(action.name ?? '').trim();
        if (!name || name.length > 24 || /[\u0000-\u001f]/.test(name)) return fail('name');
        const fly = this.flyById(action.fly ?? s.activeFly);
        if (!fly) return fail('fly');
        fly.name = name;
        const q = byId(QUESTS, 'name');
        if (this.questAvailable(q)) this._completeQuest(q, now, R);
        return done();
      }
      case 'activate': {
        const fly = this.flyById(action.fly);
        if (!fly) return fail('fly');
        s.activeFly = fly.id;
        this.rt.lightOn = false;
        this.rt.heatOn = false;
        this.rt.prevState = null;
        return done({ commands: this.commandsFor(fly, snap) });
      }
      case 'adopt': {
        if (!snap || !(snap.seed > 0) || snap.dead) return fail('nothing running');
        if (s.flies.some((f) => f.seed === snap.seed >>> 0)) return fail('known');
        if (s.flies.length >= VIAL.maxFlies) return fail('full');
        if ((snap.genetics ?? []).length) return fail('genetics');
        const fly = newFly(`f${s.nextFly++}`, this._freeName(), snap.seed, 'wild', now);
        s.flies.push(fly);
        s.activeFly = fly.id;
        return done({ fly: fly.id });
      }
      case 'buy': {
        const stock = byId(STOCKS, action.stock);
        if (!stock) return fail('stock');
        if (this.stockOwned(stock.id)) return fail('owned');
        if (this.rank().level + 1 < stock.level) return fail('level');
        if (s.leaves < stock.cost) return fail('leaves');
        s.leaves -= stock.cost;
        s.stocks.push(stock.id);
        return done();
      }
      case 'cross': case 'wild': {
        const cross = action.type === 'cross';
        if (s.vials.length >= VIAL.maxVials) return fail('vials');
        const cost = cross ? VIAL.crossCost : VIAL.wildCost;
        if (s.leaves < cost) return fail('leaves');
        let genotype = null;
        if (cross) {
          const d = byId(STOCKS, action.driver), e = byId(STOCKS, action.effector);
          if (d?.kind !== 'driver' || e?.kind !== 'effector' || !this.stockOwned(d.id) || !this.stockOwned(e.id)) return fail('stock');
          genotype = { driver: d.id, effector: e.id };
        }
        const first = cross ? s.counters.crosses === 0 : s.counters.wilds === 0;
        const ms = first ? VIAL.firstMs : cross ? VIAL.crossMs : VIAL.wildMs;
        s.leaves -= cost;
        s.vials.push({ id: s.nextVial++, kind: cross ? 'cross' : 'wild', ...(genotype ?? {}), started: now, ready: now + ms });
        if (cross) s.counters.crosses++; else s.counters.wilds++;
        this._dailyProgress('vial', null, 1, now, R);
        return done();
      }
      case 'collect': {
        const vial = s.vials.find((v) => v.id === action.vial);
        if (!vial) return fail('vial');
        if (now < vial.ready) return fail('not ready');
        if (s.flies.length >= VIAL.maxFlies) return fail('full');
        const genotype = vial.kind === 'cross' ? { driver: vial.driver, effector: vial.effector } : null;
        const fly = newFly(`f${s.nextFly++}`, this._freeName(), this._seed(), vial.kind === 'cross' ? 'cross' : 'wild', now, genotype);
        s.flies.push(fly);
        s.vials = s.vials.filter((v) => v !== vial);
        s.counters.collected++;
        R.push({ kind: 'hatch', fly: fly.id });
        return done({ fly: fly.id });
      }
      case 'release': {
        const fly = this.flyById(action.fly);
        if (!fly || fly.id === s.activeFly || s.flies.length <= 1) return fail('fly');
        s.flies = s.flies.filter((f) => f !== fly);
        return done();
      }
      case 'light': {
        const fly = this.fly, g = fly.genotype;
        const e = g ? byId(STOCKS, g.effector) : null;
        if (e?.mode !== 'activate') return fail('no opsin');
        this.rt.lightOn = Boolean(action.on);
        const d = byId(STOCKS, g.driver);
        return done({ commands: [['genetics.set', { population: d.population, mode: 'activate', strength: OPTO_STRENGTH, on: this.rt.lightOn }]] });
      }
      case 'read': {
        const c = byId(CRITERIA, action.criterion);
        if (!c?.via.read) return fail('criterion');
        this._investigate(c.id, now, R);
        return done();
      }
      case 'lab': {
        if (typeof action.protocol !== 'string' || !/^[a-z-]{1,40}$/.test(action.protocol)) return fail('protocol');
        s.labRuns[action.protocol] ??= now;
        return done();
      }
      case 'place': {
        const item = byId(GARDEN_ITEMS, action.item);
        if (!item) return fail('item');
        if (this.rank().level + 1 < item.level) return fail('level');
        if (s.garden.length >= GARDEN.maxPieces) return fail('garden full');
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return fail('place');
        const f = snap?.fly;
        if (f && Math.hypot(f.x - action.x, f.y - action.y) < GARDEN.minFlyDistance) return fail('near');
        const stored = s.gardenStock[item.id] ?? 0;
        if (!stored && s.leaves < item.cost) return fail('leaves');
        if (stored) { if (stored > 1) s.gardenStock[item.id] = stored - 1; else delete s.gardenStock[item.id]; }
        else s.leaves -= item.cost;
        const piece = { tag: `g${s.nextTag++}`, item: item.id, seed: this._seed(), x: action.x, y: action.y };
        s.garden.push(piece);
        this._dailyProgress('garden', null, 1, now, R);
        return done({ commands: [this._addCommand(piece, GARDEN.minFlyDistance)] });
      }
      case 'unplace': {
        const piece = s.garden.find((g) => g.tag === action.tag);
        if (!piece) return fail('piece');
        s.garden = s.garden.filter((g) => g !== piece);
        s.gardenStock[piece.item] = (s.gardenStock[piece.item] ?? 0) + 1;
        return done({ commands: [['world.remove', { tag: piece.tag }]] });
      }
      case 'offer': {
        // A clean test: old drops go, the new one touches the proboscis.
        if (!DOSE_PERCENTS.includes(action.percent) || !Number.isFinite(action.x) || !Number.isFinite(action.y)) return fail('offer');
        if (!this.isBound(snap)) return fail('away');
        if ((snap.fly?.proboscis ?? 0) > 0.3 || snap.fly?.state === 'flying') return fail('busy');
        this.rt.offer = { percent: action.percent, t: null };
        return done({ commands: [['food.clear', {}], ['food.add', { kind: 'sugar', conc: action.percent / 100, x: action.x, y: action.y }]] });
      }
      case 'sound': s.sound = Boolean(action.on); return done();
      default: return fail('unknown');
    }
  }

  // The Studio commands that put `fly` into the terrarium: a new individual
  // with its seed, and the genotype it carries. Activation by light waits for
  // the light switch.
  commandsFor(fly, snap = null) {
    const commands = [];
    if (!snap || snap.seed !== fly.seed || snap.dead) commands.push(['respawn', { seed: fly.seed }]);
    commands.push(['genetics.clear', {}]);
    const g = fly.genotype;
    if (g && byId(STOCKS, g.effector)?.mode === 'silence') {
      commands.push(['genetics.set', { population: byId(STOCKS, g.driver).population, mode: 'silence', on: true }]);
    }
    return commands;
  }

  _addCommand(piece, minFlyDistance) {
    const item = byId(GARDEN_ITEMS, piece.item);
    return ['world.add', { kind: item.kind, x: piece.x, y: piece.y, seed: piece.seed, radius: item.radius, tag: piece.tag, minFlyDistance }];
  }

  // After a restart the terrarium is new: the commands that put the garden
  // back (`tags`: the tags the world already has).
  restoreCommands(tags) {
    const have = new Set(tags);
    return this.state.garden.filter((g) => !have.has(g.tag)).map((g) => this._addCommand(g, GARDEN.restoreMinFlyDistance));
  }

  // A piece the player dragged in the terrarium keeps its new place.
  syncGarden(objects) {
    let changed = false;
    for (const o of objects) {
      if (!o.tag) continue;
      const g = this.state.garden.find((x) => x.tag === o.tag);
      if (g && (Math.abs(g.x - o.pos.x) > 0.5 || Math.abs(g.y - o.pos.y) > 0.5)) { g.x = o.pos.x; g.y = o.pos.y; changed = true; }
    }
    return changed;
  }

  _seed() {
    let x = this.state.rng;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.state.rng = x || 1;
    return (Math.imul(x, 2654435761) >>> 0) || 1;
  }

  _freeName() {
    const used = new Set(this.state.flies.map((f) => f.name));
    return FLY_NAMES.find((n) => !used.has(n)) ?? `Fly ${this.state.nextFly}`;
  }
}

// What the colony's time budget says about one individual (measured in the
// simulation, per behavioural state). Null until a minute was observed.
export function temperament(fly) {
  if (!fly || fly.observed < 60) return null;
  const share = (k) => fly.time[k] / fly.observed;
  return { observed: fly.observed, walking: share('walking'), grooming: share('grooming'), flying: share('flying'),
    feeding: share('feeding'), idle: share('idle'), sleeping: share('sleeping'),
    escapesPerMin: fly.counts.takeoff / (fly.observed / 60) };
}

export function careScore(fly) { return NEEDS.reduce((sum, k) => sum + fly.needs[k], 0) / NEEDS.length; }
