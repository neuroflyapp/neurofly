// Local microbenchmark only; not an end-to-end app speed claim.
import { performance } from 'node:perf_hooks';
import { loadBrainData } from '../src/data.js';
import { LocomotorSim } from '../src/locomotor.js';
import { Fly } from '../src/flymodel.js';
import { referenceSenseLegs } from '../test/leg-sense-reference.mjs';
const sim = new LocomotorSim(loadBrainData(undefined, { model: 'male' }).locomotor);
sim.feedback = new Fly({ x: 0, y: 0 }).legDynamics.feedback;
const optimized = sim._senseLegs, runs = 200000;
const measure = fn => {
  for (let i = 0; i < 10000; i++) fn.call(sim);
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn.call(sim);
  return performance.now() - start;
};
const old = [], next = [];
for (let i = 0; i < 7; i++) {
  if (i % 2) { next.push(measure(optimized)); old.push(measure(referenceSenseLegs)); }
  else { old.push(measure(referenceSenseLegs)); next.push(measure(optimized)); }
}
const median = a => a.sort((x, y) => x - y)[3];
const before = median(old), after = median(next);
console.log(JSON.stringify({ scope: 'leg sensory transduction only', calls: runs,
  sensoryCells: sim.sensory.length, referenceMs: before, optimizedMs: after, factor: before / after }, null, 2));
