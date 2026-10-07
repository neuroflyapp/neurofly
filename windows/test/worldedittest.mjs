// Objects added to and removed from the terrarium (the Habitat game's
// garden) in the real closed loop: never on top of the fly, journaled, and a
// renderer copy rebuilt from the layout matches the simulation's world.
import assert from 'node:assert/strict';
import './random.js';
import { loadBrainData } from '../src/data.js';
import { ClosedLoop } from '../src/closed-loop.js';
import { World } from '../src/world.js';

const data = loadBrainData();
const loop = new ClosedLoop({ data, bounds: { width: 1100, height: 700 }, seed: 7, spikeBus: false, hour: 12 });
loop.run(0.5);
const fly = loop.fly.pos;
const n0 = loop.world.objects.length, rev0 = loop.world.rev;
const near = loop.handle({ name: 'world.add', args: { kind: 'fern', x: fly.x + 30, y: fly.y, seed: 5, radius: 15, tag: 'g1' } });
assert.equal(near.ok, false, 'an object right next to the fly is refused');
const far = { x: fly.x > 0 ? fly.x - 300 : fly.x + 300, y: 0 };
const added = loop.handle({ name: 'world.add', args: { kind: 'flower', ...far, seed: 5, radius: 12, tag: 'g1' } });
assert.ok(added.ok && loop.world.objects.length === n0 + 1 && loop.world.rev === rev0 + 1);
assert.equal(loop.handle({ name: 'world.add', args: { kind: 'flower', ...far, seed: 5, radius: 12, tag: 'g1' } }).ok, false, 'a tag is unique');
assert.equal(loop.handle({ name: 'world.add', args: { kind: 'castle', x: 0, y: 300, seed: 5, tag: 'g2' } }).ok, false, 'only the world\'s own kinds');
assert.ok(loop.journal.snapshot().events.some((e) => e.kind === 'world-edit' && e.details.action === 'add' && e.details.tag === 'g1'));
const snap = loop.snapshot();
assert.equal(snap.worldRev, loop.world.rev);
assert.equal(snap.objects.length, (n0 + 1) * 5);
// A renderer copy rebuilt from the layout has the same objects in the same order.
const copy = new World({ width: 1100, height: 700 }, { layout: { ...loop.world.layout(), objects: [] }, dressing: false });
copy.replaceObjects(loop.world.layout());
assert.equal(copy.rev, loop.world.rev);
assert.deepEqual(copy.objects.map((o) => [o.kind, o.tag ?? null, o.pos.x, o.pos.y]), loop.world.objects.map((o) => [o.kind, o.tag ?? null, o.pos.x, o.pos.y]));
const g1 = copy.objects.find((o) => o.tag === 'g1');
const src = loop.world.objects.find((o) => o.tag === 'g1');
assert.equal(g1.topZ, src.topZ, 'built from the same seed: the same shape');
// The new flower is part of her world: it carries a scent like the others.
assert.ok(src.scent > 0);
assert.ok(loop.handle({ name: 'world.remove', args: { tag: 'g1' } }));
assert.equal(loop.world.objects.length, n0);
assert.equal(loop.handle({ name: 'world.remove', args: { tag: 'g1' } }), false);
// Restoring after a restart may come nearer, but never onto the fly.
const restore = loop.handle({ name: 'world.add', args: { kind: 'fern', x: fly.x + 60, y: fly.y, seed: 9, radius: 15, tag: 'g3', minFlyDistance: 40 } });
assert.ok(restore.ok);
assert.equal(loop.handle({ name: 'world.add', args: { kind: 'fern', x: fly.x + 10, y: fly.y, seed: 9, radius: 15, tag: 'g4', minFlyDistance: 0 } }).ok, false);
console.log('PASS  world edits: refused next to the fly, unique tags, own kinds only, journaled, renderer copy identical, removal, restore distance');

// Every Habitat neuron card names populations the running circuit has.
const { NEURONS, STOCKS } = await import('../src/habitat-content.js');
for (const card of NEURONS) {
  assert.ok(card.pops?.length, `${card.id} names its populations`);
  for (const pop of card.pops) assert.ok(loop.resolvePopulation(pop)?.indices.length > 0, `${card.id}: ${pop}`);
}
for (const s of STOCKS.filter((x) => x.kind === 'driver')) assert.ok(loop.resolvePopulation(s.population)?.indices.length > 0, `driver ${s.id}`);
console.log(`PASS  Habitat cards and driver lines: all ${NEURONS.length} cards and ${STOCKS.filter((x) => x.kind === 'driver').length} drivers resolve to populations of the running circuit`);

// Behaviour driven by virtual genetics names it as the trigger (it read "no
// external trigger" before): MDN activated -> backward walking.
loop.handle({ name: 'genetics.set', args: { population: 'mdn', mode: 'activate', strength: 0.06, on: true } });
const seen = [];
for (let k = 0; k < 40 && !seen.some((e) => e.kind === 'backward'); k++) { loop.run(0.25); seen.push(...loop.pendingEvents.splice(0)); }
const back = seen.find((e) => e.kind === 'backward');
assert.ok(back, 'activated MDN walks the fly backward');
assert.equal(back.trigger?.channel, 'genetics');
assert.match(back.trigger.label, /MDN/);
loop.handle({ name: 'genetics.clear' });
console.log(`PASS  virtual genetics is named as the trigger of the behaviour it drives: ${back.kind} <- ${back.trigger.label}`);
