// oneanimaltest.js — the single-specimen flies: brain and nerve cord of one
// animal, coupled cell by cell. The male from MaleCNS v1.0 (data/male/), the
// female from BANC v888 (data/female/; etl_banc_adapter.py, then the same
// extraction scripts).   node test/oneanimaltest.js
// Checks, for each: the model loads as one specimen of its sex; every
// descending and ascending cell of its cord is found, by body ID, in its
// brain circuit; the giant fiber is silent at rest and fires on an abrupt
// loom; a brain DN's spikes are its cord copy's spikes (and nothing else
// drives that copy); the cord's ascending spikes reach their brain copies;
// the same seed gives the same run. And: the FlyWire model is untouched.
import { loadBrainData, availableFlyModels } from '../src/data.js';
import { LIFSim } from '../src/sim.js';
import { makeExperimentManifest } from '../src/experiment-manifest.js';
import { assessSentience, STATUS } from '../src/sentience.js';

let failures = 0;
const check = (ok, name, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };

const ANIMALS = [
  { model: 'male', sex: 'male', specimen: 'malecns-v1' },
  { model: 'female', sex: 'female', specimen: 'banc-v888' },
];
const models = availableFlyModels();

function run(sim, ms, drive) {
  let gf = 0, first = -1;
  for (let t = 0; t < ms; t++) {
    drive?.(t);
    sim.step(1);
    if (sim.consumeGF()) { gf++; if (first < 0) first = t; }
  }
  return { gf, first };
}

for (const { model, sex, specimen } of ANIMALS) {
  const data = models.includes(model) ? loadBrainData(undefined, { model }) : null;
  check(!!data, `the ${model} model is installed`, `available: ${models.join(', ')}`);
  if (!data) continue;
  const spec = data.provenance.specimens;
  check(data.provenance.flyModel === model && spec.compatibility?.sameSpecimen && spec.compatibility?.sameSex
    && spec.brain?.id === specimen && spec.nerveCord?.id === specimen && spec.body.sex === sex,
  `${model}: brain and nerve cord come from one ${sex} animal`, `${spec.brain?.id} + ${spec.nerveCord?.id}, ${spec.compatibility?.reason}`);

  const brain = new LIFSim(data.circuit, null, data.locomotor, { seed: 7 });
  const cord = brain.locomotor;
  const roles = { descending: 0, ascending: 0 };
  for (const nr of cord.circuit.neurons) if (nr.role in roles) roles[nr.role]++;
  check(brain.identityCoupled && brain.identityPairs.descending === roles.descending && brain.identityPairs.ascending === roles.ascending
    && roles.descending > 0 && roles.ascending > 0,
  `${model}: every descending and ascending cell of the cord is the brain's own cell`,
  `${JSON.stringify(brain.identityPairs)} of ${roles.descending} descending / ${roles.ascending} ascending`);

  const manifest = makeExperimentManifest({ data, simulation: brain });
  const coupling = manifest.model.brainVncCoupling, parameters = manifest.model.parameters;
  check(manifest.model.flyModel === model && coupling.mode === 'shared-cell-spike-transfer'
    && coupling.sharedDescendingCells === roles.descending && coupling.sharedAscendingCells === roles.ascending
    && coupling.populationRateAscendingTargets === brain.ascend.length - roles.ascending
    && coupling.populationRateDescendingDrive === false
    && parameters.coreSynapseScale === brain.synapseScale && parameters.pathwayWeightPerSynapse === brain.pathwayWeight
    && parameters.pathwayRecurrentFraction === brain.pathwayRecurrent && parameters.arousalScale === brain.arousalScale
    && parameters.giantFiberThresholds[0] === brain.thresholds[brain.gf[0]]
    && manifest.data.rhythmDecoderSHA256 === data.provenance.rhythmDecoderSHA256
    && manifest.data.brainCoordinateRegistration?.rmsMicrometres === data.circuit.frame?.rmsMicrometres,
  `${model}: exported run identifies actual shared cells, residual feedback, gains and decoder`,
  `${coupling.sharedDescendingCells}/${coupling.sharedAscendingCells} shared; ${coupling.populationRateAscendingTargets} modelled feedback targets; core x${parameters.coreSynapseScale}`);

  const evidence = assessSentience({ ...data, hasPlasticity: true });
  const criterion = (id) => evidence.criteria.find((c) => c.id === id);
  check(evidence.anatomicalAnalysis.status === 'unmatched-reference'
    && criterion('integrated-nociception').status === STATUS.notAssessed
    && criterion('integrated-nociception').anatomy === null
    && criterion('nociception').model.bitter === brain.bitterDrive.length
    && criterion('motivational-tradeoffs').model.sugar === brain.sugarDrive.length
    && criterion('flexible-self-protection').model.joF === brain.joFDrive.length
    && evidence.counts.notAssessed === 1,
  `${model}: evidence map uses this animal's receptor targets and does not borrow FAFB paths`,
  `${brain.sugarDrive.length} sugar / ${brain.bitterDrive.length} bitter / ${brain.joFDrive.length} JO-F; full-brain routes unassessed`);

  const rest = run(brain, 4000);
  check(rest.gf === 0, `${model}: the giant fiber is silent over 4 s of rest`, `${rest.gf} spikes`);
  const loom = run(brain, 400, () => { brain.loomL = 1; brain.loomR = 0.5; });
  brain.loomL = 0; brain.loomR = 0;
  check(loom.gf > 0 && loom.first >= 0 && loom.first <= 12, `${model}: an abrupt loom fires the giant fiber within 12 ms`,
    `${loom.gf} spike-ms, first after ${loom.first} ms`);

  // A brain DN's spikes are its cord copy's spikes: count both over a stimulation.
  const pairs = [];
  cord.circuit.neurons.forEach((nr, c) => { if (nr.role === 'descending') pairs.push([c, brain.cordTwin.indexOf(c)]); });
  check(pairs.every(([, b]) => b >= 0) && pairs.every(([c]) => cord.drive[c] === 0),
    `${model}: no modelled drive reaches the cord's copies of the brain DNs`, `${pairs.length} cells, drive 0`);
  const dnp09 = pairs.filter(([c]) => cord.circuit.neurons[c].type === 'DNp09');
  const before = dnp09.map(([c]) => cord.rates[c]);
  const stimIdx = dnp09.map(([, b]) => b);
  for (let t = 0; t < 300; t++) {
    if (t % 20 === 0) brain.stimulate(stimIdx, 0.6, 20);
    brain.step(1);
  }
  const after = dnp09.map(([c]) => cord.rates[c]);
  check(dnp09.length > 0 && after.every((r, k) => r > before[k] + 1), `${model}: driving the brain's DNp09 makes the same cells fire in the cord`,
    `cord DNp09 rates ${before.map((r) => r.toFixed(1)).join('/')} -> ${after.map((r) => r.toFixed(1)).join('/')}`);

  // The cord's ascending spikes reach their brain copies while the cord walks
  // (its DNp09 cells fired directly, the stepping rules told to walk).
  let ascSpikes = 0;
  cord.setDescending('DNp09', 'left', 60); cord.setDescending('DNp09', 'right', 60);
  for (let t = 0; t < 1500; t++) {
    for (const [c] of dnp09) cord.inject(c);
    brain.step(1);
    for (let q = 0; q < brain.ascendTwins.length; q += 2) if (cord.spikedNow[brain.ascendTwins[q]]) ascSpikes++;
  }
  check(ascSpikes > 0, `${model}: the cord's ascending cells fire into their brain copies while it walks`, `${ascSpikes} mirrored ascending spikes in 1.5 s`);

  // Reproducible: the same seed, the same run.
  const a = new LIFSim(data.circuit, null, data.locomotor, { seed: 11 }), b = new LIFSim(data.circuit, null, data.locomotor, { seed: 11 });
  for (let t = 0; t < 1500; t++) { a.loomL = b.loomL = t > 500 && t < 700 ? 0.8 : 0; a.step(1); b.step(1); }
  check(a.totalSpikes === b.totalSpikes && a.locomotor.totalSpikes === b.locomotor.totalSpikes,
    `${model}: two runs with the same seed are identical`, `${a.totalSpikes}/${a.locomotor.totalSpikes} spikes in both`);
}

const mixed = loadBrainData(undefined, { model: 'mixed' });
const mixedBrain = new LIFSim(mixed.circuit, null, mixed.locomotor, { seed: 7 });
check(!mixedBrain.identityCoupled && !mixedBrain.locomotor.mirrorDescending,
  'the FlyWire brain keeps the modelled population-rate interface', `identity pairs ${JSON.stringify(mixedBrain.identityPairs)}`);
const mixedManifest = makeExperimentManifest({ data: mixed, simulation: mixedBrain });
check(mixedManifest.model.brainVncCoupling.mode === 'population-rate-interface'
  && mixedManifest.model.brainVncCoupling.sharedDescendingCells === 0
  && mixedManifest.model.brainVncCoupling.sharedAscendingCells === 0
  && mixedManifest.model.brainVncCoupling.populationRateAscendingTargets === mixedBrain.ascend.length
  && mixedManifest.model.brainVncCoupling.populationRateDescendingDrive === true,
  'the mixed manifest preserves cross-specimen mode, zero shared cells and all rate-feedback targets',
  mixedManifest.model.brainVncBridge);

console.log(failures ? `${failures} ONE-ANIMAL MODEL FAILURES` : 'ALL ONE-ANIMAL MODEL TESTS PASS');
process.exit(failures ? 1 : 0);
