// Full closed-loop fingerprint: runs ClosedLoop through every body and brain
// path (walking, grooming, flight, landing, sleep, feeding, injuries, dragging,
// weather, temperature, food, dust, death and a new fly) and hashes the whole
// state every half second — the fly's own fields, her body snapshot, the
// neural and nerve-cord state and the world. Run before and after a refactoring
// that must not change behaviour; the printed hashes must be identical.
//   node tools/loop-fingerprint.mjs
import crypto from 'node:crypto';
import '../test/random.js';
import { loadBrainData } from '../src/data.js';
import { ClosedLoop } from '../src/closed-loop.js';

const data = loadBrainData();

// Every number, string and flag reachable from `obj` (typed arrays included),
// skipping three.js objects and functions; order is the insertion order.
function feed(h, obj, depth = 0, seen = new Set()) {
  if (obj === null || obj === undefined) { h.update('~'); return; }
  const t = typeof obj;
  if (t === 'number') { h.update(Number.isNaN(obj) ? 'NaN' : obj.toString()); h.update(','); return; }
  if (t === 'string' || t === 'boolean') { h.update(String(obj)); h.update(','); return; }
  if (t !== 'object' || depth > 4 || seen.has(obj) || obj.isObject3D || obj.isMaterial || obj.isBufferGeometry) return;
  seen.add(obj);
  if (ArrayBuffer.isView(obj)) { h.update(Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength)); return; }
  if (Array.isArray(obj)) { for (const v of obj) feed(h, v, depth + 1, seen); return; }
  if (obj instanceof Map) { for (const [k, v] of obj) { h.update(String(k)); feed(h, v, depth + 1, seen); } return; }
  if (obj instanceof Set) { for (const v of obj) feed(h, v, depth + 1, seen); return; }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'function') continue;
    h.update(k); feed(h, v, depth + 1, seen);
  }
}

function run(seed, hour, sleepy) {
  const loop = new ClosedLoop({ data, bounds: { width: 1300, height: 800 }, seed, hour, spikeBus: false });
  loop.ambient = { typing: 0, sleepy, activity: sleepy ? 0.3 : 1 };
  const h = crypto.createHash('sha256');
  const events = [];
  const emit = loop._emit.bind(loop);
  loop._emit = (e) => { events.push(e.kind); return emit(e); };
  const at = (s, fn) => ({ s, fn });
  const script = [
    at(2, () => loop.stimulateGroup('walk')), at(4, () => loop.stimulateGroup('groom')), at(6, () => loop.stimulateGroup('backward')),
    at(7, () => loop.stimulateGroup('steerLeft')), at(8, () => loop.stimulateGroup('headGroom')), at(9, () => loop.stimulateGroup('proboscis')),
    at(10, () => { loop.env.tempC = 34; }), at(12, () => { loop.env.tempC = 24; loop.env.windKmh = 30; }),
    at(13, () => { loop.env.windKmh = 0; loop.env.rain = true; }), at(15, () => { loop.env.rain = false; loop.dustLoad = 1; }),
    at(17, () => loop.stimulateGroup('escape')), at(20, () => loop.removeNextLeg()), at(22, () => loop.cycleWingDamage()),
    at(24, () => { const o = loop.world.objects.find((x) => x.kind !== 'firefly'); if (o) { loop.dragStart({ kind: 'object', id: loop.world.objects.indexOf(o), x: o.pos.x, y: o.pos.y }); loop.dragMove({ x: o.pos.x + 40, y: o.pos.y + 25 }); loop.dragEnd(); } }),
    at(25, () => { const f = loop.fly; loop.dragStart({ kind: 'fly', id: 0, x: f.pos.x, y: f.pos.y }); loop.dragMove({ x: f.pos.x - 60, y: f.pos.y + 30 }); loop.dragEnd(); }),
    at(27, () => loop.squeeze()), at(29, () => loop.resetBody()), at(31, () => { loop.env.gravity = 0.4; }), at(33, () => { loop.env.gravity = 1; loop.env.quake = true; }),
    at(34, () => { loop.env.quake = false; loop.env.tempC = 2; }), at(37, () => { loop.env.tempC = 24; loop.toggleFreeze(); }), at(38, () => loop.toggleFreeze()),
    at(40, () => loop.triggerDeath()), at(42, () => loop.respawn({ seed: seed + 1 })),
  ];
  let next = 0;
  for (let k = 0; k < 46 * 120; k++) {
    const t = k / 120;
    while (next < script.length && t >= script[next].s) { try { script[next].fn(); } catch (e) { h.update(`err:${e.message}`); } next++; }
    loop.tick(1 / 120);
    if (k % 60 === 0) {
      feed(h, loop.fly); feed(h, loop.bodySnapshot()); feed(h, loop.env);   // environmentSnapshot() carries the wall clock
      feed(h, loop.sim.v); feed(h, loop.sim.popRate); feed(h, loop.world.packState());
      feed(h, [loop.simTime, loop.health, loop.dustLoad, loop.flies.length]);
    }
  }
  feed(h, events);
  return { hash: h.digest('hex').slice(0, 16), states: [...new Set(events)].length, events: events.length };
}

const t0 = Date.now();
for (const [seed, hour, sleepy] of [[11, 12, false], [101, 12, false], [7, 2, true]]) {
  const r = run(seed, hour, sleepy);
  console.log(`seed ${seed} hour ${hour}${sleepy ? ' sleepy' : ''}: ${r.hash}  (${r.events} events, ${r.states} kinds)`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`);
