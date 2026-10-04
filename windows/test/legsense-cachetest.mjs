import assert from 'node:assert/strict';
import { loadBrainData } from '../src/data.js';
import { LocomotorSim } from '../src/locomotor.js';
import { Fly } from '../src/flymodel.js';
import { SixLegDynamics } from '../src/legdynamics.js';
import { referenceSenseLegs } from './leg-sense-reference.mjs';
const fields = ['voltage', 'adaptation', 'rates', 'refractory', 'excitatory', 'inhibitory',
  'nextExcitatory', 'nextInhibitory', 'drive', 'sensoryDrive', 'rhythmDrive'];
const geometry = new Fly({ x: 0, y: 0 }).legDynamics.legs.map(l => l.geometry);
for (const model of ['mixed', 'male', 'female']) {
  const data = loadBrainData(undefined, { model });
  const a = new LocomotorSim(data.locomotor), b = new LocomotorSim(data.locomotor);
  b._senseLegs = referenceSenseLegs;
  const bodyA = new SixLegDynamics(geometry), bodyB = new SixLegDynamics(geometry);
  for (let tick = 0; tick < 240; tick++) {
    for (const sim of [a, b]) {
      sim.feedbackEnabled = !(tick >= 60 && tick < 90);
      sim.synapsesEnabled = !(tick >= 120 && tick < 150);
      for (const side of ['left', 'right']) {
        sim.setDescending('DNp09', side, tick < 180 ? 60 : 0);
        sim.setDescending('MDN', side, tick >= 180 ? 45 : 0);
      }
    }
    a.feedback = bodyA.feedback; b.feedback = bodyB.feedback;
    const ms = tick % 3 === 2 ? 9 : 8;
    a.step(ms); b.step(ms);
    bodyA.advance(a.commands, 1 / 120); bodyB.advance(b.commands, 1 / 120);
    for (const field of fields) assert.deepEqual(a[field], b[field], `${model} ${field} tick ${tick}`);
    assert.deepEqual(a.commands, b.commands);
    assert.deepEqual(bodyA.feedback, bodyB.feedback);
    assert.equal(a.totalSpikes, b.totalSpikes);
  }
  // Invalid/no feedback must clear stale drive, just as the reference did.
  a.feedback = b.feedback = [];
  a._senseLegs(); b._senseLegs();
  assert.deepEqual(a.sensoryDrive, b.sensoryDrive);
  assert.ok(a.sensory.every(i => a.sensoryDrive[i] === 0));
  console.log(`PASS ${model}: per-millisecond sensory cache is bit-identical to reference`);
}
