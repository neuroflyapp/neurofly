// simtest.js — invariants of the running brain network. MUST pass after any
// sim/etl change:
//   - every synapse carries its transmitter class, and the per-neuron
//     modulatory counts agree with the rows;
//   - the giant fiber stays silent over 4 s of rest and fires on an abrupt
//     loom;
//   - with walking proprioception the DNp09 walking command crosses its
//     threshold now and then, and still does in the siesta (scale 0.84);
//   - an air puff reaches Johnston's organ;
//   - stimulating the GF cluster makes it spike.
//   node test/simtest.js

import './random.js';
import { loadBrainData } from '../src/data.js';
import { LIFSim } from '../src/sim.js';

const data = loadBrainData();
if (!data) {
  console.error('no data/ — run etl.py first');
  process.exit(1);
}
const brain = new LIFSim(data.circuit, null);
const fixed = (x, digits = 1) => x.toFixed(digits);
const signed = (x) => (x >= 0 ? '+' : '') + fixed(x);
const percent = (part, whole) => fixed((100 * part) / whole, 0);

// Steps the network one millisecond at a time. `drive(t)` sets inputs before
// a step, `observe(t, gfFired)` reads the state after it. Returns the number
// of milliseconds in which the giant fiber fired.
function run(ms, { drive, observe } = {}) {
  let gfMs = 0;
  for (let t = 0; t < ms; t++) {
    drive?.(t);
    brain.step(1);
    const fired = brain.consumeGF();
    if (fired) gfMs++;
    observe?.(t, fired);
  }
  return gfMs;
}

// The walking command counts as "on" above 22% of its 10 Hz scale.
const walking = () => brain.rateFwd / 10 > 0.22;

const sizes = [
  ['loom L/R', `${brain.loomLeft.length}/${brain.loomRight.length}`], ['GF', brain.gf.length],
  ['DNa L/R', `${brain.dnaL.length}/${brain.dnaR.length}`], ['MDN', brain.mdn.length],
  ['DNp09', brain.fwd.length], ['DNg11', brain.groom.length], ['escW', brain.escw.length],
  ['ascend', brain.ascend.length], ['sens', brain.sens.length],
];
console.log(`circuit: ${brain.n} neurons | ${sizes.map(([name, size]) => `${name}: ${size}`).join(' | ')}`);

// ---- transmitter classes -------------------------------------------------
// Every edge must carry its real, aligned class (etl.py's edge[3]);
// daEdgeCount/modOtherEdgeCount normalise rateDA/rateModOther, so a zero here
// would make those rates silently meaningless.
const classesAligned = brain.ntCode.length === data.circuit.edges.length
  && brain.daEdgeCount > 0 && brain.modOtherEdgeCount > 0;
let countsAgree = true;
for (let i = 0; i < brain.n && countsAgree; i++) {
  const row = brain.ntCode.subarray(brain.rowStart[i], brain.rowStart[i + 1]);
  const dopamine = row.filter((nt) => nt === 1).length;
  const otherModulators = row.filter((nt) => nt === 2 || nt === 3).length;
  countsAgree = dopamine === brain.daOutgoingCount[i] && otherModulators === brain.modOutgoingCount[i];
}
console.log(`transmitter classes: ${brain.daEdgeCount} DA edges, ${brain.modOtherEdgeCount} 5-HT/OA edges, `
  + `aligned: ${classesAligned}, per-neuron counts: ${countsAgree}`);

// ---- 4 s of rest: no escape ----------------------------------------------
const gfAtRest = run(4000);
console.log(`rest 4 s: ${fixed(brain.totalSpikes / 4 / brain.n, 2)} Hz per neuron, LC ${fixed(brain.rateLoom)} Hz, `
  + `DNa L/R ${fixed(brain.rateDNaL)}/${fixed(brain.rateDNaR)} Hz, MDN ${fixed(brain.rateMDN)} Hz, GF spikes ${gfAtRest}`);

// ---- abrupt loom (a step, as from a cursor lunge — ramps lose to inhibition)
let gfLatencyMs = -1;
const gfOnLoom = run(400, {
  drive: () => { brain.loomL = 1.0; brain.loomR = 0.5; },
  observe: (t, fired) => { if (fired && gfLatencyMs < 0) gfLatencyMs = t; },
});
brain.loomL = 0;
brain.loomR = 0;
console.log(`abrupt loom 0.4 s: LC ${fixed(brain.rateLoom)} Hz, GF spikes ${gfOnLoom}, first after ${gfLatencyMs} ms`);

// ---- 20 s of walking proprioception (8 Hz gait): does the command move? ----
let samples = 0, walkSamples = 0, groomSamples = 0;
let fwdLow = Infinity, fwdHigh = 0;
run(20000, {
  drive: (t) => { brain.gaitDrive = 0.5; brain.gaitPhase = (t % 125) / 125; },
  observe: (t) => {
    if (t % 10 !== 0) return;
    samples++;
    if (walking()) walkSamples++;
    if (brain.rateGroom / 8 > 0.5) groomSamples++;
    fwdLow = Math.min(fwdLow, brain.rateFwd);
    fwdHigh = Math.max(fwdHigh, brain.rateFwd);
  },
});
console.log(`gait 20 s: walk command on ${percent(walkSamples, samples)}%, groom command on `
  + `${percent(groomSamples, samples)}%, DNp09 ${fixed(fwdLow)}-${fixed(fwdHigh)} Hz, population ${fixed(brain.ratePop)} Hz`);

// ---- siesta: slower, not paralysed ----------------------------------------
// 0.84 is a mood factor of 0.55 compressed toward 1 (1 − 0.45 × 0.35).
brain.activityScale = 1 - (1 - 0.55) * 0.35;
let siestaSamples = 0, siestaWalk = 0;
run(15000, {
  observe: (t) => {
    if (t % 10 !== 0) return;
    siestaSamples++;
    if (walking()) siestaWalk++;
  },
});
brain.activityScale = 1;
const siestaWalkPct = (100 * siestaWalk) / siestaSamples;
console.log(`siesta 15 s (scale 0.84): walk command on ${fixed(siestaWalkPct, 0)}%`);

// ---- air puff for 1 s: the antenna's mechanosensors respond ---------------
const gfOnPuff = run(1000, { drive: () => { brain.airPuff = 1.0; } });
brain.airPuff = 0;
const joRateAfterPuff = brain.rateSens;
console.log(`air puff 1 s: GF spikes ${gfOnPuff}, Johnston's organ ${fixed(joRateAfterPuff)} Hz`);

// ---- gentle loom on the left eye only: a steering probe -------------------
run(500);
const steerBefore = brain.rateDNaL - brain.rateDNaR;
run(1000, { drive: () => { brain.loomL = 0.30; brain.loomR = 0; } });
const steerDuring = brain.rateDNaL - brain.rateDNaR;
brain.loomL = 0;
console.log(`left-eye loom: DNa L-R ${signed(steerBefore)} -> ${signed(steerDuring)} Hz, LC ${fixed(brain.rateLoom)} Hz`);

// ---- click probes, as from the brain view ---------------------------------
brain.stimulate(brain.gf, 0.5, 40);
const gfFiredOnClick = run(60) > 0;
const gfRateAfterClick = brain.rateGF;
brain.stimulate(brain.groom, 0.25, 400);
run(400);
const groomRateAfterClick = brain.rateGroom;
console.log(`click probes: GF cluster -> ${gfFiredOnClick ? 'spike' : 'NO spike'} (${fixed(gfRateAfterClick)} Hz), `
  + `DNg11 cluster -> ${fixed(groomRateAfterClick, 0)} Hz`);

const checks = [
  ['transmitter classes aligned', classesAligned],
  ['per-neuron modulatory counts agree', countsAgree],
  ['GF silent over 4 s of rest', gfAtRest === 0],
  ['GF fires on an abrupt loom', gfOnLoom > 0],
  ['walking command crosses threshold', walkSamples > 0],
  ['walking command alive in the siesta (> 3%)', siestaWalkPct > 3],
  ['air puff drives Johnston\'s organ (> 30 Hz)', joRateAfterPuff > 30],
  ['GF cluster click spikes', gfFiredOnClick],
  ['GF rate after the click > 5 Hz', gfRateAfterClick > 5],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name] of failed) console.log(`  failed: ${name}`);
console.log(failed.length === 0
  ? 'PASS: giant fiber silent at rest and firing on a loom; walking command alive, also in the siesta; stimulation works'
  : 'FAIL: check the synaptic weights and the noise');
process.exit(failed.length === 0 ? 0 : 1);
