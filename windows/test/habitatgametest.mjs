// The Habitat game's rules, driven by synthetic snapshots (no simulation):
// care from the body and world, discoveries from explained events, quests,
// fly genetics, daily notes, saves and the content's integrity.
import assert from 'node:assert/strict';
import { HabitatGame, newGame, decodeGame, migrateLegacy, localDay, levelOf, climateScore, temperament,
  SCHEMA } from '../src/habitat-game.js';
import { BEHAVIOURS, NEURONS, QUESTS, CHAPTERS, DAILY, STOCKS, CRITERIA, RANKS, TRIGGER_CARDS, VIAL, GARDEN, GARDEN_ITEMS } from '../src/habitat-content.js';
import { assessSentience } from '../src/sentience.js';
import { WORLD_EDIT_KINDS, WORLD_EDIT_MIN_FLY_DISTANCE } from '../src/closed-loop.js';

const T0 = Date.UTC(2026, 9, 7, 10, 0, 0);
let t = 0;
function snap(over = {}) {
  return { t, individual: 1, seed: 4242, paused: false, dead: false, events: [], genetics: [],
    fly: { state: 'idle', proboscis: 0 }, env: { tempC: 25, dustLoad: 0 }, inputs: {},
    body: { effectiveTempC: 25, wetness: 0, oxygenScale: 1 }, ...over, fly: { state: 'idle', proboscis: 0, ...over.fly } };
}
// Advance simulated time in 0.1 s frames.
function run(game, seconds, over = {}, now = T0) {
  const out = [];
  for (let k = 0; k < Math.round(seconds * 10); k++) { t += 0.1; out.push(...game.observe(snap(over), now)); }
  return out;
}
const event = (kind, extra = {}) => ({ kind, t, trigger: null, command: null, ...extra });
const kinds = (rewards, kind) => rewards.filter((r) => r.kind === kind).map((r) => r.id ?? r.level ?? true);
let passed = 0;
const pass = (what) => { passed++; console.log(`PASS  ${what}`); };

// ---- content integrity ----------------------------------------------------------------------
{
  const bilingual = [];
  const walk = (v, where) => {
    if (v && typeof v === 'object' && 'en' in v && 'de' in v) bilingual.push([v, where]);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
  };
  walk({ BEHAVIOURS, NEURONS, QUESTS, CHAPTERS, DAILY, STOCKS, CRITERIA, GARDEN_ITEMS }, 'content');
  for (const [v, where] of bilingual) {
    assert.ok(typeof v.en === 'string' && v.en.trim() && typeof v.de === 'string' && v.de.trim(), `${where} has both languages`);
    assert.ok(!/\b(she|her|hers|herself|he|him|his)\b/i.test(v.en), `${where} names the fly instead of a pronoun: ${v.en}`);
  }
  for (const b of BEHAVIOURS) for (const n of b.neurons) assert.ok(NEURONS.some((x) => x.id === n), `${b.id} -> ${n}`);
  for (const ids of Object.values(TRIGGER_CARDS)) for (const n of ids) assert.ok(NEURONS.some((x) => x.id === n), n);
  for (const q of QUESTS) {
    assert.ok(CHAPTERS.some((c) => c.id === q.chapter), q.id);
    for (const target of q.targets ?? []) assert.ok(BEHAVIOURS.some((b) => b.id === target), `${q.id} -> ${target}`);
    for (const g of q.gift ?? []) assert.ok(STOCKS.some((s) => s.id === g), g);
  }
  for (const s of STOCKS.filter((x) => x.kind === 'driver')) assert.ok(NEURONS.some((n) => n.id === s.card), s.id);
  const sentienceIds = assessSentience({}).criteria.map((c) => c.id);
  assert.deepEqual(CRITERIA.map((c) => c.id), sentienceIds, 'one game card per Birch criterion, same order');
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].xp > RANKS[i - 1].xp);
  pass(`content: ${bilingual.length} bilingual texts without pronouns, every reference resolves, criteria = sentience.js`);
}

// ---- founder, care ----------------------------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  game.observe(snap(), T0);
  assert.equal(game.fly.seed, 4242, 'the founder adopts the running fly');
  assert.ok(game.isBound(snap()));
  const e0 = game.fly.needs.energy;
  run(game, 60, { fly: { state: 'walking' } });
  const walked = e0 - game.fly.needs.energy;
  assert.ok(walked > 7 && walked < 10, `a minute of walking costs energy (${walked})`);
  const e1 = game.fly.needs.energy;
  run(game, 60, { fly: { state: 'flying' } });
  assert.ok(e1 - game.fly.needs.energy > 3 * walked, 'flying costs more than walking');
  const e2 = game.fly.needs.energy;
  run(game, 5, { fly: { state: 'feeding' } });
  assert.ok(game.fly.needs.energy > e2 + 15, 'only feeding refills energy');
  // Startles lower calm; quiet time restores it.
  const c0 = game.fly.needs.calm;
  game.observe(snap({ events: [event('takeoff')] }), T0);
  assert.equal(game.fly.needs.calm, Math.max(0, c0 - 18));
  run(game, 20);
  assert.ok(game.fly.needs.calm > c0 - 18 + 10, 'calm recovers');
  // Climate follows the temperature; dust lowers cleanliness.
  run(game, 30, { env: { tempC: 31, dustLoad: 0.8 }, body: { effectiveTempC: 31, wetness: 0, oxygenScale: 1 } });
  assert.ok(game.fly.needs.climate < 50 && game.fly.needs.clean < 30);
  assert.equal(climateScore(snap({ body: { effectiveTempC: 25 } })), 100);
  // A different fly in the terrarium is a visitor: no care, no stats.
  const before = JSON.stringify(game.fly);
  run(game, 10, { seed: 999, individual: 2, fly: { state: 'walking' } });
  assert.equal(JSON.stringify(game.fly), before, 'a visitor does not change the active fly');
  // A pause or a gap counts no time.
  const paused = JSON.stringify(game.fly.needs);
  for (let k = 0; k < 20; k++) game.observe(snap({ paused: true, fly: { state: 'flying' } }), T0);
  assert.equal(JSON.stringify(game.fly.needs), paused);
  pass('care: energy by behaviour (feeding only refills), startles, climate, dust; visitors and pauses count nothing');
}

// ---- harsh treatment earns nothing ------------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  game.observe(snap(), T0);
  const leaves = game.state.leaves;
  run(game, 300, { env: { tempC: 25, dustLoad: 0, fire: true, quake: true } });
  assert.equal(game.state.leaves, leaves, 'no care leaves under fire and quake');
  assert.ok(game.fly.needs.calm < 5 && game.fly.needs.climate < 40);
  const calm = new HabitatGame(newGame({ now: T0 }));
  calm.observe(snap(), T0);
  const r = run(calm, 241);
  assert.equal(kinds(r, 'care').length, 2, 'a well-kept habitat earns care leaves every two minutes');
  pass('care leaves only for a well-kept habitat; fire and quake earn nothing');
}

// ---- discoveries, cards, quests, chapters ----------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  game.observe(snap(), T0);
  let r = game.observe(snap({ events: [event('feeding', { trigger: { channel: 'sugar' } })] }), T0);
  assert.deepEqual(kinds(r, 'discovery'), ['feeding']);
  assert.deepEqual(kinds(r, 'card').sort(), ['perMN', 'sugarGRN']);
  r = game.observe(snap({ events: [event('feeding')] }), T0);
  assert.equal(kinds(r, 'discovery').length, 0);
  assert.equal(game.state.journal.feeding.count, 2);
  // Inputs that drive receptors unlock their cards.
  r = game.observe(snap({ inputs: { hot: 0.5 } }), T0);
  assert.deepEqual(kinds(r, 'card'), ['hotCell']);
  // Chapter 1.
  assert.ok(game.questDone('sugar'), 'chapter 1 is open: feeding completes its quest at once');
  r = game.act({ type: 'rename', name: '  Pip ' }, T0).rewards;
  assert.equal(game.fly.name, 'Pip');
  assert.ok(kinds(r, 'quest').includes('name'));
  assert.equal(game.act({ type: 'rename', name: 'x'.repeat(25) }, T0).ok, false);
  run(game, 1, { fly: { state: 'walking' } });
  game.observe(snap({ events: [event('headGrooming')] }), T0);
  assert.ok(kinds(game.act({ type: 'place', item: 'fern', x: 300, y: 0 }, T0, snap({ fly: { state: 'idle', x: 0, y: 0 } })).rewards, 'quest').includes('home'));
  assert.equal(game.currentChapter().id, 'meet');
  assert.ok(!game.chapterUnlocked('brain'));
  r = game.observe(snap({ events: [event('takeoff', { trigger: { channel: 'loomL' } })] }), T0);
  assert.ok(kinds(r, 'quest').includes('shadow'));
  assert.deepEqual(kinds(r, 'chapter'), ['brain']);
  assert.ok(game.chapterUnlocked('brain'));
  pass('discoveries once with cards; inputs unlock cards; chapter 1 quests and the next chapter');

  // Chapter 2: turns, bitter refusal, climate in two steps, moonwalk.
  game.observe(snap({ events: [event('turnLeft'), event('turnRight')] }), T0);
  assert.ok(game.questDone('turns'));
  run(game, 1, { inputs: { bitter: 0.4 }, fly: { state: 'idle', proboscis: 0.1 } });
  assert.ok(!game.questDone('bitter'), 'one second on bitter is not yet a refusal');
  run(game, 1.2, { inputs: { bitter: 0.4 }, fly: { state: 'idle', proboscis: 0.1 } });
  assert.ok(game.questDone('bitter'));
  run(game, 1, { inputs: { hot: 0.6 }, env: { tempC: 30, dustLoad: 0 }, body: { effectiveTempC: 30, wetness: 0, oxygenScale: 1 } });
  assert.equal(game.state.quests.climate.n, 1);
  run(game, 21);
  assert.ok(game.questDone('climate'));
  assert.ok(game.state.criteria.nociception, 'the bitter and climate quests investigate nociception');
  // How sweet must it be: one drop that brings the proboscis out, one that does not.
  assert.equal(game.act({ type: 'offer', percent: 100, x: 1, y: 1 }, T0, snap({ fly: { state: 'idle', proboscis: 0.6 } })).reason, 'busy');
  const offer = game.act({ type: 'offer', percent: 100, x: 1, y: 1 }, T0, snap());
  assert.deepEqual(offer.commands, [['food.clear', {}], ['food.add', { kind: 'sugar', conc: 1, x: 1, y: 1 }]]);
  run(game, 0.5);
  r = game.observe(snap({ events: [event('proboscis')] }), T0);
  assert.deepEqual(r.filter((x) => x.kind === 'dose').map((x) => [x.percent, x.responded]), [[100, true]]);
  game.act({ type: 'offer', percent: 60, x: 1, y: 1 }, T0, snap());
  r = run(game, 3.5);
  assert.equal(r.filter((x) => x.kind === 'dose').length, 0, 'still waiting within the response window');
  r = run(game, 1);
  assert.deepEqual(r.filter((x) => x.kind === 'dose').map((x) => [x.percent, x.responded]), [[60, false]]);
  assert.ok(game.questDone('dose'), 'a threshold lies between 60 and 100 %');
  r = run(game, 0.1, { events: [event('backward')] });
  assert.ok(kinds(r, 'quest').includes('moon'));
  assert.deepEqual(kinds(r, 'gift').sort(), ['gf', 'kir'], 'the genetics chapter gives the first stocks');
  pass('chapter 2: turns, bitter refusal (proboscis stays in), warmth then comfort, moonwalk; genetics gifts');

  // Chapter 3: a cross, its F1, the silent giant fiber, optogenetics.
  assert.equal(game.act({ type: 'cross', driver: 'lc4', effector: 'kir' }, T0).reason, 'stock');
  const leaves = game.state.leaves;
  assert.ok(game.act({ type: 'cross', driver: 'gf', effector: 'kir' }, T0).ok);
  assert.equal(game.state.leaves, leaves - VIAL.crossCost);
  assert.ok(game.questDone('cross'));
  const vial = game.state.vials[0];
  assert.equal(vial.ready - vial.started, VIAL.firstMs, 'the first cross is quick');
  assert.equal(game.act({ type: 'collect', vial: vial.id }, T0 + 1000).reason, 'not ready');
  const hatch = game.act({ type: 'collect', vial: vial.id }, vial.ready);
  assert.ok(hatch.ok && game.questDone('hatch'));
  const f1 = game.flyById(hatch.fly);
  assert.deepEqual(f1.genotype, { driver: 'gf', effector: 'kir' });
  assert.ok(f1.seed > 0 && f1.seed !== game.state.flies[0].seed);
  const act = game.act({ type: 'activate', fly: f1.id }, vial.ready, snap());
  assert.deepEqual(act.commands, [['respawn', { seed: f1.seed }], ['genetics.clear', {}],
    ['genetics.set', { population: 'gf', mode: 'silence', on: true }]]);
  assert.equal(game.act({ type: 'light', on: true }, T0).reason, 'no opsin');
  const silencedGF = { seed: f1.seed, individual: 3, genetics: [{ mode: 'silence', population: 'gf' }] };
  game.observe(snap(silencedGF), T0);
  r = game.observe(snap({ ...silencedGF, events: [event('dart')] }), T0);
  assert.ok(kinds(r, 'quest').includes('silent'));
  assert.deepEqual(kinds(r, 'gift').sort(), ['chrimson', 'dng12']);
  assert.ok(game.act({ type: 'cross', driver: 'dng12', effector: 'chrimson' }, T0).ok);
  const v2 = game.state.vials[0];
  assert.equal(v2.ready - v2.started, VIAL.crossMs, 'later crosses take the standard time');
  const f2 = game.flyById(game.act({ type: 'collect', vial: v2.id }, v2.ready).fly);
  assert.deepEqual(game.act({ type: 'activate', fly: f2.id }, T0, snap()).commands.at(-1), ['genetics.clear', {}],
    'an opsin line is not active until the light is on');
  assert.deepEqual(game.act({ type: 'light', on: true }, T0).commands,
    [['genetics.set', { population: 'dng12', mode: 'activate', strength: 0.06, on: true }]]);
  const lit = { seed: f2.seed, individual: 4, genetics: [{ mode: 'activate', population: 'dng12' }] };
  game.observe(snap(lit), T0);
  r = game.observe(snap({ ...lit, events: [event('headGrooming')] }), T0);
  assert.ok(kinds(r, 'quest').includes('opto'));
  assert.deepEqual(kinds(r, 'gift').sort(), ['mdn', 'trpa1']);
  // Thermogenetics: MDN > TrpA1 opens above 29 °C and closes below 27 °C.
  assert.ok(game.act({ type: 'cross', driver: 'mdn', effector: 'trpa1' }, T0).ok);
  const v3 = game.state.vials[0];
  const f3 = game.flyById(game.act({ type: 'collect', vial: v3.id }, v3.ready).fly);
  assert.deepEqual(game.act({ type: 'activate', fly: f3.id }, T0, snap()).commands.at(-1), ['genetics.clear', {}]);
  const warm = (c, extra = {}) => snap({ seed: f3.seed, individual: 5, env: { tempC: c, dustLoad: 0 }, body: { effectiveTempC: c, wetness: 0, oxygenScale: 1 }, ...extra });
  assert.equal(game.observe(warm(28), T0).filter((x) => x.kind === 'command').length, 0, 'closed below 29 °C');
  r = game.observe(warm(29.5), T0);
  assert.deepEqual(r.filter((x) => x.kind === 'command').map((x) => [x.name, x.args.population, x.args.on]), [['genetics.set', 'mdn', true]]);
  assert.equal(game.observe(warm(28), T0).filter((x) => x.kind === 'command').length, 0, 'stays open down to 27 °C');
  r = game.observe(warm(28, { genetics: [{ mode: 'activate', population: 'mdn' }], events: [event('backward')] }), T0);
  assert.ok(kinds(r, 'quest').includes('heat'));
  assert.deepEqual(kinds(r, 'chapter'), ['question']);
  r = game.observe(warm(26.5), T0);
  assert.deepEqual(r.filter((x) => x.kind === 'command').map((x) => x.args.on), [false], 'closes below 27 °C');
  pass('chapter 3: cross with owned stocks, quick first vial, F1 genotype -> respawn + silence; dart without GF; red light -> DNg12');

  // Chapter 4: criteria through quests, modalities, reading and Lab runs.
  assert.equal(game.act({ type: 'read', criterion: 'nociception' }, T0).reason, 'criterion');
  game.act({ type: 'read', criterion: 'integrated-nociception' }, T0);
  game.act({ type: 'lab', protocol: 'taste-tradeoff' }, T0);
  game.observe(snap({ inputs: { sound: 0.5 } }), T0);
  assert.ok(game.state.criteria['sensory-integration'], 'three senses seen');
  assert.ok(game.questDone('evidence'));
  game.act({ type: 'read', criterion: 'analgesia-preference' }, T0);
  game.act({ type: 'lab', protocol: 'inhibition-escape' }, T0);
  r = game.act({ type: 'lab', protocol: 'associative' }, T0).rewards;
  assert.ok(kinds(r, 'quest').includes('atlas'));
  assert.equal(game.currentChapter(), null, 'every quest done');
  pass('chapter 4: criteria via quests, three senses, reading and Lab protocols; the whole atlas');
}

// ---- adoption, colony limits, release, temperament -----------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  game.observe(snap(), T0);
  assert.equal(game.act({ type: 'adopt' }, T0, snap()).reason, 'known');
  assert.equal(game.act({ type: 'adopt' }, T0, snap({ seed: 77, genetics: [{ mode: 'silence', population: 'mdn' }] })).reason, 'genetics');
  const adopted = game.act({ type: 'adopt' }, T0, snap({ seed: 77 }));
  assert.ok(adopted.ok && game.fly.seed === 77 && game.fly.name === 'Pip');
  assert.equal(game.act({ type: 'release', fly: adopted.fly }, T0).reason, 'fly', 'the active fly stays');
  assert.ok(game.act({ type: 'release', fly: 'f1' }, T0).ok);
  assert.equal(temperament(game.fly), null);
  run(game, 61, { seed: 77, fly: { state: 'walking' } });
  const tm = temperament(game.fly);
  assert.ok(tm.walking > 0.95);
  assert.equal(game.act({ type: 'buy', stock: 'mdn' }, T0).reason, 'level');
  game.state.xp = RANKS[4].xp;
  game.state.leaves = 45;
  assert.equal(game.act({ type: 'buy', stock: 'mdn' }, T0).reason, 'leaves');
  game.state.leaves = 50;
  assert.ok(game.act({ type: 'buy', stock: 'mdn' }, T0).ok && game.state.leaves === 0);
  for (let i = 0; i < VIAL.maxVials; i++) { game.state.leaves += 5; assert.ok(game.act({ type: 'wild' }, T0).ok); }
  game.state.leaves += 5;
  assert.equal(game.act({ type: 'wild' }, T0).reason, 'vials');
  assert.equal(levelOf(0), 0);
  pass('adopting the running fly (wild type only), release, measured temperament, rank-gated stocks, vial limit');
}

// ---- daily notes ------------------------------------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  const tasks = game.state.daily.tasks.map((x) => x.id);
  assert.equal(new Set(tasks).size, 3);
  assert.deepEqual(new HabitatGame(newGame({ now: T0 + 3600_000 })).state.daily.tasks.map((x) => x.id), tasks, 'same day, same notes');
  const next = T0 + 86400_000;
  const r = game.observe(snap(), next);
  assert.equal(kinds(r, 'newDay').length, 1);
  assert.equal(game.state.daysPlayed, 2);
  assert.equal(game.state.daily.day, localDay(next));
  // Complete whatever the day asks for, through the matching inputs.
  game.state.daily.tasks = [{ id: 'feed3', n: 0, done: false }, { id: 'turns5', n: 0, done: false }, { id: 'vial', n: 0, done: false }];
  game.observe(snap(), next);
  const feed = game.observe(snap({ events: [event('feeding'), event('feeding'), event('feeding')] }), next);
  assert.deepEqual(kinds(feed, 'daily'), ['feed3']);
  game.observe(snap({ events: Array.from({ length: 5 }, (_, i) => event(i % 2 ? 'turnLeft' : 'turnRight')) }), next);
  const done = game.act({ type: 'wild' }, next).rewards;
  assert.deepEqual(kinds(done, 'daily'), ['vial']);
  assert.equal(kinds(done, 'dailyBonus').length, 1);
  pass('daily notes: three per local day, deterministic, days played count up, bonus for all three');
}

// ---- saves --------------------------------------------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0, rng: 99 }));
  game.observe(snap(), T0);
  game.observe(snap({ events: [event('feeding')] }), T0);
  game.act({ type: 'rename', name: 'Juno' }, T0);
  game.state.stocks.push('gf', 'kir');
  game.act({ type: 'cross', driver: 'gf', effector: 'kir' }, T0);
  const text = JSON.stringify(game.state);
  assert.deepEqual(decodeGame(text), game.state, 'a save round-trips exactly');
  const tampered = JSON.parse(text);
  tampered.leaves = -5; tampered.xp = 'lots'; tampered.extra = { evil: true };
  tampered.flies[0].name = 'x\u0007'; tampered.flies.push({ id: 'f9', name: 'Ok', seed: 5, needs: { energy: 1e9 } });
  tampered.stocks.push('nonsense', 'gf');
  tampered.journal.flyingSaucer = { first: 1, count: 1 };
  tampered.vials.push({ kind: 'cross', driver: 'gf', effector: 'gf', started: 1, ready: 2 });
  const clean = decodeGame(JSON.stringify(tampered));
  assert.equal(clean.leaves, 0);
  assert.equal(clean.xp, 0);
  assert.ok(!('extra' in clean));
  assert.deepEqual(clean.flies.map((f) => f.id), ['f9'], 'a fly with an invalid name is dropped');
  assert.equal(clean.flies[0].needs.energy, 100);
  assert.equal(clean.activeFly, 'f9');
  assert.deepEqual(clean.stocks, ['gf', 'kir']);
  assert.ok(!clean.journal.flyingSaucer);
  assert.equal(clean.vials.length, 1);
  assert.throws(() => decodeGame('{"version":4}'));
  assert.throws(() => decodeGame('not json'));
  assert.throws(() => decodeGame('x'.repeat(200_001)));
  const legacy = JSON.stringify({ version: 4, points: 87, pets: [{ name: 'Nova-Alt' }, { name: 'Orbit' }] });
  const migrated = migrateLegacy(legacy, { now: T0 });
  assert.equal(migrated.version, SCHEMA);
  assert.equal(migrated.leaves, 87);
  assert.equal(migrated.flies[0].name, 'Nova-Alt');
  assert.throws(() => migrateLegacy('{"version":9}'));
  pass('saves: exact round trip; tampered values clamped or dropped; old versions rejected; prototype leaves and name migrate');
}

// ---- the garden ----------------------------------------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  game.observe(snap({ fly: { state: 'idle', x: 0, y: 0 } }), T0);
  const at = snap({ fly: { state: 'idle', x: 0, y: 0 } });
  assert.equal(game.act({ type: 'place', item: 'fern', x: 50, y: 0 }, T0, at).reason, 'near', 'never right next to the fly');
  const fern = game.act({ type: 'place', item: 'fern', x: 200, y: 0 }, T0, at);
  assert.ok(fern.ok);
  const [name, args] = fern.commands[0];
  assert.equal(name, 'world.add');
  assert.deepEqual({ kind: args.kind, x: args.x, y: args.y, tag: args.tag, minFlyDistance: args.minFlyDistance },
    { kind: 'fern', x: 200, y: 0, tag: 'g1', minFlyDistance: GARDEN.minFlyDistance });
  assert.equal(game.act({ type: 'place', item: 'rock', x: 200, y: 100 }, T0, at).reason, 'level');
  const leaves = game.state.leaves;
  assert.ok(game.act({ type: 'place', item: 'flower', x: -200, y: 0 }, T0, at).ok);
  assert.equal(game.state.leaves, leaves - 8);
  assert.deepEqual(game.act({ type: 'unplace', tag: 'g2' }, T0).commands, [['world.remove', { tag: 'g2' }]]);
  assert.equal(game.state.gardenStock.flower, 1);
  assert.ok(game.act({ type: 'place', item: 'flower', x: -250, y: 0 }, T0, at).ok);
  assert.equal(game.state.leaves, leaves - 8, 'a stored piece is placed again for free');
  assert.equal(game.state.gardenStock.flower, undefined);
  // After a restart: the missing pieces come back, nearer to the fly allowed.
  const restore = game.restoreCommands(['g1']);
  assert.deepEqual(restore.map(([, a]) => [a.tag, a.minFlyDistance]), [['g3', GARDEN.restoreMinFlyDistance]]);
  assert.ok(game.syncGarden([{ tag: 'g1', pos: { x: 260, y: 40 } }, { tag: null, pos: { x: 0, y: 0 } }]));
  assert.deepEqual([game.state.garden[0].x, game.state.garden[0].y], [260, 40]);
  const copy = decodeGame(JSON.stringify(game.state));
  assert.deepEqual(copy.garden, game.state.garden);
  assert.equal(copy.nextTag, game.state.nextTag);
  const bad = JSON.parse(JSON.stringify(game.state));
  bad.garden.push({ tag: 'g1', item: 'fern', x: 1, y: 1 }, { tag: 'x9', item: 'fern', x: 1, y: 1 }, { tag: 'g9', item: 'castle', x: 1, y: 1 });
  bad.gardenStock = { flower: 3, castle: 2 };
  const clean = decodeGame(JSON.stringify(bad));
  assert.equal(clean.garden.length, 2, 'duplicate tags, bad tags and unknown items are dropped');
  assert.deepEqual(clean.gardenStock, { flower: 3 });
  for (const item of GARDEN_ITEMS) assert.ok(WORLD_EDIT_KINDS.includes(item.kind), item.id);
  assert.equal(GARDEN.minFlyDistance, WORLD_EDIT_MIN_FLY_DISTANCE);
  pass('garden: never next to the fly, rank-gated, leaves once, storage reused, restore after restart, dragged pieces kept, saves');
}

// ---- collection milestones ------------------------------------------------------------------------------
{
  const game = new HabitatGame(newGame({ now: T0 }));
  const all = [];
  for (const b of BEHAVIOURS) { const R = []; game._discover(b.id, null, T0, R); all.push(...R); }
  assert.deepEqual(all.filter((x) => x.kind === 'milestone').map((x) => x.id).sort(), ['behaviours'].concat(
    NEURONS.every((n) => BEHAVIOURS.some((b) => b.neurons.includes(n.id))) ? ['cards'] : []).sort());
  for (const n of NEURONS) { const R = []; game._card(n.id, T0, R); all.push(...R); }
  assert.equal(all.filter((x) => x.kind === 'milestone' && x.id === 'cards').length, 1, 'once per collection');
  pass('collection milestones: every behaviour, every neuron card, once each');
}

// ---- determinism ----------------------------------------------------------------------------------------
{
  const play = () => {
    t = 0;
    const game = new HabitatGame(newGame({ now: T0, rng: 7 }));
    run(game, 30, { fly: { state: 'walking' } });
    game.observe(snap({ events: [event('takeoff'), event('dart')] }), T0);
    game.state.stocks.push('gf', 'kir');
    game.act({ type: 'cross', driver: 'gf', effector: 'kir' }, T0);
    game.act({ type: 'collect', vial: 1 }, T0 + VIAL.firstMs);
    return JSON.stringify(game.state);
  };
  assert.equal(play(), play());
  pass('the same snapshots, actions and clock give the same game');
}

console.log(`habitat game: ${passed} groups passed`);
