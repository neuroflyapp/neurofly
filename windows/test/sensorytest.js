// sensorytest.js — each stimulus must reach the neurons that actually sense
// it, and the consequence must come from their real wiring.
//   node test/sensorytest.js
//
// The 199 "sensory" partners in this FlyWire subset are Johnston's-organ
// neurons: 176 vibration-sensitive JO-A/B (near-field sound) and 18
// deflection-sensitive JO-C/D/E (wind, gravity). In the connectome JO-A/B
// make 1,467 synapses onto the giant fiber and JO-C/D/E only 34. So a steady
// wind — delivered only to JO-C/D/E — must drive those neurons strongly while
// leaving the giant fiber close to silent, and a sound-like input to JO-A/B
// must drive it far more. That is what Drosophila does (wind suppresses
// walking rather than triggering escape; Yorozu et al. 2009), and it is what
// the model previously got backwards by feeding wind into the hearing neurons.

import './random.js';
import { expectationsFor } from './fly-models.js';
import { loadBrainData } from '../src/data.js';
import { LIFSim } from '../src/sim.js';
import { ClosedLoop } from '../src/closed-loop.js';

const data = loadBrainData();
if (!data) { process.stderr.write('no data/ — run etl.py first\n'); process.exit(1); }

let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

function run({ wind = 0, sound = 0, puff = 0, ms = 2500, seed = 7 }) {
  const sim = new LIFSim(data.circuit, null, null, { seed });
  sim.step(600); sim.consumeGF();
  let gfSpikes = 0;
  for (let t = 0; t < ms; t++) {
    sim.windDrive = wind; sim.soundDrive = sound; sim.airPuff = puff;
    sim.step(1);
    if (sim.consumeGF()) gfSpikes++;
  }
  return { sim, gfSpikes };
}

const base = run({});
const wind = run({ wind: 1 });
const sound = run({ sound: 1 });

check('the sensory population splits into FlyWire\'s two JO populations', () => {
  const s = base.sim;
  const { auditory, wind } = expectationsFor(data);
  return [s.sensoryAnnotated && s.sensAuditory.length === auditory && s.sensWind.length === wind,
    `JO-A/B ${s.sensAuditory.length}, JO-C/D/E ${s.sensWind.length}, other ${s.sensOther.length}`];
});

check('steady wind reaches the wind neurons and not the hearing neurons', () => {
  const w = wind.sim, b = base.sim;
  const windUp = w.rateJOWind > b.rateJOWind + 20;
  const hearingUnmoved = Math.abs(w.rateJOAuditory - b.rateJOAuditory) < Math.max(5, b.rateJOAuditory * 0.5);
  return [windUp && hearingUnmoved,
    `JO-C/D/E ${b.rateJOWind.toFixed(1)} -> ${w.rateJOWind.toFixed(1)} Hz; `
    + `JO-A/B ${b.rateJOAuditory.toFixed(1)} -> ${w.rateJOAuditory.toFixed(1)} Hz`];
});

check('wind drives the giant fiber far less than sound does, as the wiring predicts', () => {
  const ok = sound.gfSpikes > wind.gfSpikes * 3 && sound.sim.rateGF > wind.sim.rateGF;
  return [ok, `GF spikes over 2.5 s: wind ${wind.gfSpikes}, sound ${sound.gfSpikes}, rest ${base.gfSpikes}`];
});

check('a sudden air puff still reaches both populations (fast onset + deflection)', () => {
  const p = run({ puff: 1 }).sim;
  const ok = p.rateJOWind > base.sim.rateJOWind + 20 && p.rateJOAuditory > base.sim.rateJOAuditory + 20;
  return [ok, `JO-A/B ${p.rateJOAuditory.toFixed(1)} Hz, JO-C/D/E ${p.rateJOWind.toFixed(1)} Hz`];
});

check('experimenter taps excite deflection-sensitive JO cells, not hearing cells', () => {
  const rig = new ClosedLoop({ data, seed: 91, empty: true, spikeBus: false, instruments: false, hour: 12 });
  const point = { ...rig.fly.pos };
  rig.injectTap(point);
  rig.stimulateGroup('tap');
  const targets = rig.sim.pendingStims;
  const expected = new Set(rig.sim.sensWind);
  const okay = targets.length === 2 && targets.every((pulse) =>
    pulse.idx.length === expected.size && pulse.idx.every((index) => expected.has(index)));
  return [okay, `${targets.length} pulses, ${expected.size} JO-C/D/E targets, `
    + `${rig.sim.sensAuditory.length} JO-A/B hearing cells excluded`];
});

check('without the annotation, stimuli fall back to the whole population instead of vanishing', () => {
  const bare = { ...data.circuit, neurons: data.circuit.neurons.map(({ sensoryGroup, ...n }) => n) };
  const sim = new LIFSim(bare, null, null, { seed: 7 });
  sim.step(600);
  for (let t = 0; t < 1500; t++) { sim.windDrive = 1; sim.step(1); }
  return [!sim.sensoryAnnotated && sim.rateSens > 30,
    `unannotated: sensoryAnnotated=${sim.sensoryAnnotated}, all-sensory rate ${sim.rateSens.toFixed(1)} Hz`];
});

console.log(failures === 0 ? 'ALL SENSORY TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
