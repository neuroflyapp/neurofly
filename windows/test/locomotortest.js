// locomotortest.js — causal checks of the MaleCNS nerve cord and the legs it
// moves. Every neural trial here runs with the cord: the anatomy validates,
// the cord is silent without input, recruitment needs its synapses and motor
// neurons, proprioception reaches it, the legs move the body only on the
// ground, the whole loop is independent of the display rate, descending
// commands steer and reverse, the stepping rules walk the cord, and posture
// stays continuous through every change of behaviour.
//   node test/locomotortest.js
import assert from 'node:assert/strict';
import { resetRandom } from './random.js';
import { loadBrainData } from '../src/data.js';
import { LocomotorSim, validateLocomotorCircuit } from '../src/locomotor.js';
import { SixLegDynamics, makeLegMotorCommand } from '../src/legdynamics.js';
import { Fly, makeSignals } from '../src/flymodel.js';
import { LIFSim, SimulationClock } from '../src/sim.js';
import { SignalBuilder } from '../src/signals.js';
import * as THREE from '../node_modules/three/build/three.module.js';

const data = loadBrainData();
assert(data?.locomotor, 'shipped MaleCNS dataset is required');
const cordData = data.locomotor;
const BOUNDS = { width: 1512, height: 982 };
const SIDES = ['left', 'right'];
const geometries = new Fly({ x: 0, y: 0 }).model.legs.map((leg) => leg.geometry);

let failed = 0;
// Each check draws from its own random stream, named after it.
function check(name, run) {
  resetRandom(name);
  try {
    console.log(`PASS ${name}: ${run()}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const restingCommands = () => Array.from({ length: 6 }, makeLegMotorCommand);
const commandTotal = (commands) => commands.flatMap(Object.values).reduce((sum, x) => sum + Math.abs(x), 0);
const newCord = (params) => new LocomotorSim(cordData, params);
const newBrain = (options) => new LIFSim(data.circuit, null, cordData, options);

// A fly standing at the origin, facing along x, in the walking state.
function walkingFly(speed = 0) {
  const fly = new Fly({ x: 0, y: 0 });
  fly.state = 'walking';
  fly.speed = speed;
  fly.heading = 0;
  return fly;
}

// Accumulates wall time into whole neural milliseconds for one tick.
function msStepper() {
  let carry = 0;
  return (dt) => {
    carry += dt * 1000;
    const whole = Math.floor(carry);
    carry -= whole;
    return whole;
  };
}

// ---- the cord on its own -----------------------------------------------------

check('the cord data validate; out-of-range indices are rejected', () => {
  assert(validateLocomotorCircuit(cordData));
  const outOfRange = { ...cordData, edges: [[cordData.neurons.length, 0, 1]] };
  assert(!validateLocomotorCircuit(outOfRange));
  return `${cordData.neurons.length} neurons, ${cordData.edges.length} observed edges`;
});

check('cord rejects ambiguous identity, malformed counts and false motor pools', () => {
  for (const mutate of [
    c => c.neurons[0] = null,
    c => c.neurons[0].id = Number(c.neurons[0].id),
    c => c.neurons[0].id = c.neurons[1].id,
    c => c.neurons[0].role = 'invented',
    c => c.provenance.specimen = 'female Drosophila melanogaster',
    c => c.provenance.dataset = 'BANC v888',
    c => c.legOrder.reverse(),
    c => c.edges[0][2] = 1.5,
    c => { const edge = c.edges.find(e => e[2] !== 0); edge[2] *= -1; },
    c => c.rawSynapseCounts[0] = 0,
    c => c.rawSynapseCounts.pop(),
    c => c.rawSynapseCounts[0]++,
    c => { c.edges.push(c.edges[0]); c.rawSynapseCounts.push(c.rawSynapseCounts[0]); },
    c => c.summary.contacts++,
    c => { for (const n of c.neurons) if (n.motorChannel === 'tibia_flexor') n.role = 'premotor'; },
  ]) {
    const invalid = structuredClone(cordData);
    mutate(invalid);
    assert.equal(validateLocomotorCircuit(invalid), false);
    assert.throws(() => new LocomotorSim(invalid), /Invalid MaleCNS/);
  }
  assert(cordData.edges.some((e, i) => e[2] === 0 && cordData.rawSynapseCounts[i] > 0));
  assert(validateLocomotorCircuit(cordData), 'unknown-sign anatomy is retained');
  return '15 malformed cases fail closed; native unknown-sign contacts remain valid';
});

check('the cord stays silent without descending or sensory input', () => {
  const cord = newCord();
  cord.step(2000);
  assert.equal(cord.totalSpikes, 0);
  assert.equal(commandTotal(cord.commands), 0);
  return 'zero spontaneous spikes and motor command';
});

check('batched ascending feedback is bit-identical to one-millisecond steps', () => {
  const [batched, single] = [0, 1].map(() => newBrain({ seed: 47382 }));
  for (const brain of [batched, single]) {
    brain.gaitPhase = 0.237;
    for (const i of brain._ascendVncIdx) brain.locomotor.rates[i] = 40;
  }
  batched.step(8);
  for (let ms = 0; ms < 8; ms++) single.step(1);
  assert(batched._ascendWave?.length > 0, 'ascending wave was not exercised');
  assert.deepEqual(batched.v, single.v);
  assert.deepEqual(batched.refr, single.refr);
  assert.deepEqual(batched.locomotor.rates, single.locomotor.rates);
  return `${batched.ascend.length} ascending cells, same neural and cord state after 8 ms`;
});

check('descending drive reaches the legs only through synapses and motor neurons', () => {
  const intact = newCord(), noSynapses = newCord(), noMotorNeurons = newCord();
  noSynapses.synapsesEnabled = false;
  noMotorNeurons.silenced = new Set(noMotorNeurons.indices('motor'));
  for (const cord of [intact, noSynapses, noMotorNeurons]) {
    for (const side of SIDES) cord.setDescending('DNp09', side, 70);
    cord.step(2000);
  }
  assert(intact.motorSpikes > 0, 'DNp09 must recruit actual motor cells');
  for (const lesioned of [noSynapses, noMotorNeurons]) {
    assert.equal(lesioned.motorSpikes, 0);
  }
  assert.equal(commandTotal(noSynapses.commands), 0);
  assert.equal(commandTotal(noMotorNeurons.commands), 0);
  return `motor spikes intact=${intact.motorSpikes}, cut=${noSynapses.motorSpikes}, ablated=${noMotorNeurons.motorSpikes}`;
});

check('leg proprioception changes the activity of the cord', () => {
  const sensing = newCord(), numb = newCord();
  const legs = new SixLegDynamics(geometries).feedback;
  legs[0].kneeVelocity = 20; // the right front leg moves
  legs[0].hipVelocity = 16;
  sensing.feedback = legs;
  numb.feedback = legs;
  numb.feedbackEnabled = false;
  sensing.step(1000);
  numb.step(1000);
  assert(sensing.sensorySpikes > 0);
  assert.equal(numb.sensorySpikes, 0);
  assert(sensing.meanRate('sensory', 0) > sensing.meanRate('sensory', 1)); // RF above LF
  return `RF sensory spikes=${sensing.sensorySpikes}; no-feedback=${numb.sensorySpikes}`;
});

// ---- the legs on their own ---------------------------------------------------

check('limp or airborne legs do not move the body', () => {
  const limp = new SixLegDynamics(geometries), inAir = new SixLegDynamics(geometries);
  const pushing = restingCommands().map((c) => ({ ...c, retract: 1, depress: 1 }));
  let limpPath = 0, inAirPath = 0;
  for (let frame = 0; frame < 120; frame++) {
    const a = limp.advance(restingCommands(), 1 / 60);
    const b = inAir.advance(pushing, 1 / 60, false);
    limpPath += Math.hypot(a.forward, a.lateral);
    inAirPath += Math.hypot(b.forward, b.lateral);
  }
  assert(limpPath < 1e-8);
  assert.equal(inAirPath, 0);
  assert(inAir.feedback.every((leg) => !leg.contact && leg.load === 0));
  return 'zero ground translation for both controls';
});

check('the leg mechanics give lasting support strokes at 60 and 120 Hz', () => {
  // A fixed tripod pattern from outside isolates the mechanics; the running
  // app has no commanded gait phase, and this is no evidence that the
  // connectome generates such a rhythm.
  const TRIPOD_OFFSET = [0, 0.5, 0.5, 0, 0, 0.5]; // RF LF RM LM RH LH
  const strokes = (hz) => {
    const legs = new SixLegDynamics(geometries);
    const contactChanges = Array(6).fill(0);
    let forward = 0, lowestFoot = 0;
    let before = legs.feedback;
    for (let frame = 0; frame < 6 * hz; frame++) {
      const time = frame / hz;
      const commands = restingCommands().map((c, i) => {
        const swing = (time * 4 + TRIPOD_OFFSET[i]) % 1 < 0.3; // 4 Hz, 30% swing
        const [on, off] = swing ? [0.8, 0] : [0, 0.8];
        return { ...c, protract: on, retract: off, lift: on, depress: off, flex: swing ? 0 : 0.2, extend: swing ? 0.2 : 0 };
      });
      const motion = legs.advance(commands, 1 / hz);
      if (time > 1) forward += motion.forward;
      const after = legs.feedback;
      after.forEach((leg, i) => {
        if (leg.contact !== before[i].contact) contactChanges[i]++;
        lowestFoot = Math.min(lowestFoot, leg.footHeight);
        assert(Object.values(leg).every((x) => typeof x === 'boolean' || Number.isFinite(x)));
      });
      before = after;
    }
    assert(lowestFoot >= -1e-8);
    assert(contactChanges.every((count) => count > 10));
    assert(forward > 40);
    return forward;
  };
  const at60 = strokes(60), at120 = strokes(120);
  assert(Math.abs(at60 - at120) / at60 < 0.15);
  return `late forward ${at60.toFixed(1)} / ${at120.toFixed(1)} units`;
});

// Signals for a walking fly whose six legs push with fixed commands.
function pushingSignals(tempo) {
  const signals = makeSignals();
  signals.walkDrive = 1;
  signals.tempo = tempo;
  signals.legCommands = restingCommands().map((c) => ({ ...c, retract: 0.6, depress: 0.4 }));
  return signals;
}

check('the thermal tempo path matches the mechanics at 0.5, 1 and 2 times', () => {
  for (const tempo of [0.5, 1, 2]) {
    resetRandom('tempo reference fixture');
    const fly = walkingFly();
    const reference = new SixLegDynamics(fly.model.legs.map((leg) => leg.geometry));
    const signals = pushingSignals(tempo);
    // A controller handoff clears the support history and converts the pose
    // velocities to motor time before either integration begins.
    reference.adoptPose(fly.legFeedback, true, 1 / tempo);
    const expected = reference.advance(signals.legCommands, SimulationClock.fixedDT * tempo);
    fly.update(SimulationClock.fixedDT, BOUNDS, null, signals);
    assert.deepEqual(fly.legDynamics.feedback, reference.feedback);
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    assert(close(fly.pos.x, expected.forward) && close(fly.pos.y, -expected.lateral) && close(fly.heading, expected.yaw));
  }
  return 'at every tempo she moves exactly as an independent integration of joints and body';
});

check('the thermal tempo changes motor-driven joint speed', () => {
  const hipExcursion = (tempo) => {
    resetRandom('tempo motor fixture');
    const fly = walkingFly();
    fly.update(SimulationClock.fixedDT, BOUNDS, null, pushingSignals(tempo));
    return Math.abs(fly.legDynamics.feedback[0].hipAngle);
  };
  const cool = hipExcursion(0.5), warm = hipExcursion(2);
  assert(cool > 0 && warm > cool * 2);
  return `same motor input: joint excursion ${cool.toFixed(4)} / ${warm.toFixed(4)} rad`;
});

// Each leg's toe in the fly's body frame, as the renderer places it.
function renderedToes(fly) {
  return fly.model.legs.map((leg) => fly.node.worldToLocal(
    leg.ankle.localToWorld(new THREE.Vector3(leg.geometry.tarsus, 0, 0))));
}

check('drawn toes match the mechanics; a speed value cannot move silent legs', () => {
  const fly = walkingFly(70);
  fly.dartCooldown = 100;
  const signals = makeSignals();
  signals.walkDrive = 1;
  signals.turnBias = 1;
  signals.legCommands = restingCommands(); // a high speed field, but silent motors
  fly.update(1 / 60, BOUNDS, null, signals);
  assert(Math.hypot(fly.pos.x, fly.pos.y) < 1e-8 && Math.abs(fly.heading) < 1e-8, 'silent motors must not move her');
  fly.node.updateMatrixWorld(true);
  const feet = fly.legDynamics.feedback;
  const largestError = renderedToes(fly).reduce((worst, toe, i) => Math.max(worst,
    Math.hypot(toe.x - feet[i].footX, toe.y - feet[i].footY, toe.z - feet[i].footHeight)), 0);
  assert(largestError < 1e-6);
  return `toe geometry max error ${largestError.toExponential(1)}, translation=0`;
});

// ---- cord and legs in closed loop ---------------------------------------------

// Ten seconds of cord and legs on the simulation clock, fed at a display
// rate. DNp09 drives walking (30 Hz), or MDN alone (70 Hz) for 'backward';
// for 'left'/'right' the DNa01/02 of that side join after 3 s (tick 360).
// Displacement and yaw count from tick 360 on.
function cordTrial(kind, displayHz = 60) {
  const cord = newCord(), legs = new SixLegDynamics(geometries);
  const clock = new SimulationClock();
  const toMs = msStepper();
  for (const side of SIDES) {
    cord.setDescending('DNp09', side, kind === 'backward' ? 0 : 30);
    if (kind === 'backward') cord.setDescending('MDN', side, 70);
  }
  const steers = kind === 'left' || kind === 'right';
  let forward = 0, yaw = 0, ticks = 0;
  for (let frame = 0; frame < displayHz * 10; frame++) {
    clock.advance(1 / displayHz, (dt) => {
      if (steers && ticks === 360) {
        cord.setDescending('DNa01', kind, 70);
        cord.setDescending('DNa02', kind, 70);
      }
      cord.feedback = legs.feedback;
      cord.step(toMs(dt));
      const motion = legs.advance(cord.commands, dt);
      if (ticks >= 360) {
        forward += motion.forward;
        yaw += motion.yaw;
      }
      ticks++;
    });
  }
  return { forward, yaw, ticks, simMs: cord.simMs, feedback: legs.feedback };
}

check('the cord and body loop is independent of the display rate', () => {
  const [at60, at120] = [60, 120].map((displayHz) => cordTrial('forward', displayHz));
  assert.deepEqual(at60, at120);
  assert.deepEqual([at60.ticks, at60.simMs], [1200, 10000]);
  return 'a 60 Hz and a 120 Hz display give identical neurons, joints, displacement and yaw';
});

check('left and right DNa drive steers through the leg mechanics', () => {
  // The three runs share the same first 3 s, so each steered run is compared
  // with its own control: the reduced network turns a little on its own.
  const control = cordTrial('forward'), left = cordTrial('left'), right = cordTrial('right');
  const leftTurn = left.yaw - control.yaw, rightTurn = right.yaw - control.yaw;
  assert(leftTurn > 0.1 && rightTurn < -0.1,
    `left effect=${leftTurn.toFixed(3)}, right effect=${rightTurn.toFixed(3)} rad`);
  return `yaw baseline=${control.yaw.toFixed(2)}, left effect=${leftTurn.toFixed(2)}, right effect=${rightTurn.toFixed(2)} rad`;
});

check('MDN alone walks the body backwards', () => {
  const { forward } = cordTrial('backward');
  assert(forward < -5, `late displacement=${forward.toFixed(2)} units (must be backward)`);
  return `late displacement=${forward.toFixed(2)} units`;
});

// ---- the stepping rules (rhythm.js → decoder → measured cord) -----------------

// Ten seconds at 120 Hz (8/8/9 neural ms per tick) of cord and legs; steps,
// displacement, yaw and how often both legs of a pair swing together are
// counted over the last 7 s.
function steppingTrial({ forwardHz = 30, backwardHz = 0, params = {}, cut = null } = {}) {
  const cord = newCord(params), legs = new SixLegDynamics(geometries);
  if (cut === 'synapses') cord.synapsesEnabled = false;
  if (cut === 'proprioception') cord.feedbackEnabled = false;
  for (const side of SIDES) {
    cord.setDescending('DNp09', side, forwardHz);
    if (backwardHz) cord.setDescending('MDN', side, backwardHz);
  }
  const PAIRS = [[0, 1], [2, 3], [4, 5]];
  let forward = 0, yaw = 0, stepsBefore = 0, pairSwing = 0, lateTicks = 0;
  for (let tick = 0; tick < 1200; tick++) {
    if (tick === 360) stepsBefore = cord.stepper?.steps ?? 0;
    cord.feedback = legs.feedback;
    cord.step(tick % 3 === 2 ? 9 : 8);
    const motion = legs.advance(cord.commands, 1 / 120);
    if (tick < 360) continue;
    forward += motion.forward;
    yaw += motion.yaw;
    lateTicks++;
    const swing = cord.stepper?.swing;
    if (swing && PAIRS.some(([a, b]) => swing[a] && swing[b])) pairSwing++;
  }
  const steps = (cord.stepper?.steps ?? 0) - stepsBefore;
  return { sim: cord, forward, yaw, stepHz: steps / 6 / 7, bothSwing: pairSwing / lateTicks };
}

check('rhythm decoder is attached, locked to this cord and its model', () => {
  const decoder = cordData.rhythmDecoder;
  assert(decoder, 'data/rhythm_decoder.json must be attached (tools/derive-rhythm-decoder.mjs)');
  assert.equal(decoder.locomotorContentSHA256, data.provenance.locomotorContentSHA256);
  assert.equal(data.provenance.rhythmDecoderStatus, 'attached');
  assert(newCord().stepper, 'stepping rules must run with a matching decoder');
  assert.equal(newCord({ baseline: 0.023 }).stepper, null, 'a decoder derived for other cord parameters must not be applied');
  const unknownCell = (d, i) => (i ? d : { ...d, cells: [['not-a-neuron', 1]] });
  const foreign = { ...cordData, rhythmDecoder: { ...decoder, decoders: decoder.decoders.map(unknownCell) } };
  assert.equal(new LocomotorSim(foreign).stepper, null, 'unknown decoder cells must disable stepping');
  assert.equal(newCord({ rhythm: false }).stepper, null);
  const cells = new Set(decoder.decoders.flatMap((d) => d.cells.map(([cell]) => cell)));
  return `${decoder.decoders.length} axis decoders over ${cells.size} premotor cells; mismatched model or cells: stepping off`;
});

check('stepping rules make the cord walk in an alternating gait', () => {
  const walking = steppingTrial(), rulesOff = steppingTrial({ params: { rhythm: false } });
  const slow = steppingTrial({ forwardHz: 4 });
  const perSecond = (trial) => (trial.forward / 7).toFixed(1);
  assert(walking.forward > 40, `forward ${walking.forward.toFixed(1)} units in 7 s`);
  assert(walking.forward > 3 * Math.abs(rulesOff.forward),
    `stepping ${walking.forward.toFixed(1)} vs rules off ${rulesOff.forward.toFixed(1)} units`);
  assert(walking.stepHz > 1.5, `step frequency ${walking.stepHz.toFixed(2)} Hz`);
  // Rule 1: the legs of a pair never lift off together; they overlap in
  // swing only when a stance time limit forces a leg up.
  assert(walking.bothSwing < 0.05, `contralateral pairs both in swing ${(100 * walking.bothSwing).toFixed(1)}% of the time`);
  assert(slow.forward > 0 && slow.forward < walking.forward,
    `DNp09 4 Hz ${slow.forward.toFixed(1)} vs 30 Hz ${walking.forward.toFixed(1)} units`);
  return `DNp09 30 Hz: ${perSecond(walking)} units/s at ${walking.stepHz.toFixed(1)} Hz, `
    + `pairs both swinging ${(100 * walking.bothSwing).toFixed(1)}%; 4 Hz: ${perSecond(slow)} units/s; `
    + `rules off: ${perSecond(rulesOff)} units/s`;
});

check('stepping needs the cord synapses and leg proprioception', () => {
  const noSynapses = steppingTrial({ cut: 'synapses' }), numb = steppingTrial({ cut: 'proprioception' });
  assert.equal(noSynapses.sim.motorSpikes, 0, 'stepping drive must reach motor neurons only through synapses');
  assert(Math.abs(noSynapses.forward) < 1e-6, `synapses cut: ${noSynapses.forward} units`);
  assert(numb.stepHz === 0, 'without proprioception the stepping rules cannot run');
  return `synapses cut: ${noSynapses.sim.motorSpikes} motor spikes, 0 displacement; no proprioception: no steps`;
});

check('MDN reverses stepping', () => {
  const reversed = steppingTrial({ forwardHz: 0, backwardHz: 70 });
  assert.equal(reversed.sim.stepper.direction, -1);
  assert(reversed.forward < -20, `MDN: ${reversed.forward.toFixed(1)} units`);
  return `MDN 70 Hz: ${(reversed.forward / 7).toFixed(1)} units/s at ${reversed.stepHz.toFixed(1)} Hz`;
});

// ---- brain, cord and body together ----------------------------------------------

check('brain, cord and body together keep walking after start-up', () => {
  const brain = newBrain(), builder = new SignalBuilder();
  const fly = walkingFly();
  // Stimulation isolates the forward pathway and the escape/grooming
  // decisions are held off; the leg commands stay purely neural outputs.
  brain.stimulate(brain.fwd, 0.15, 10000);
  const contactChanges = Array(6).fill(0);
  const clock = new SimulationClock();
  const toMs = msStepper();
  let path = 0, ticks = 0, before = fly.legFeedback;
  for (let frame = 0; frame < 600; frame++) {
    clock.advance(1 / 60, (dt) => {
      brain.legFeedback = fly.legFeedback;
      brain.step(toMs(dt));
      const signals = builder.make(brain, dt);
      Object.assign(signals, { escape: false, groomDrive: 0, nervous: 0, arousal: 0 });
      const from = { ...fly.pos };
      fly.update(dt, BOUNDS, null, signals);
      if (ticks >= 360) {
        path += Math.hypot(fly.pos.x - from.x, fly.pos.y - from.y);
        fly.legFeedback.forEach((leg, i) => { if (leg.contact !== before[i].contact) contactChanges[i]++; });
      }
      before = fly.legFeedback;
      ticks++;
    });
  }
  const detail = `late path=${path.toFixed(2)} units, contacts=${contactChanges.join('/')}`;
  assert(path > 20 && contactChanges.every((count) => count >= 4), detail);
  return detail;
});

check('real VNC ascending activity reaches the brain ascend population', () => {
  // With the cord loaded (the normal configuration) the brain's
  // ascend-labelled partners once received no drive from anywhere. They are
  // now driven by the cord's own ascending-neuron rate (sim.js step()); real
  // descending drive must raise the cord's spiking and, through it, the
  // brain's ascend population.
  const driven = newBrain(), idle = newBrain();
  driven.stimulate(driven.fwd, 0.15, 4000);
  driven.step(3000);
  idle.step(3000);
  assert(driven.locomotor.totalSpikes > idle.locomotor.totalSpikes,
    'descending drive must actually recruit more real VNC spiking');
  assert(driven.rateAscend > idle.rateAscend + 3,
    `driven=${driven.rateAscend.toFixed(2)} Hz, idle=${idle.rateAscend.toFixed(2)} Hz`);
  return `brain ascend rate: driven=${driven.rateAscend.toFixed(2)} Hz vs idle=${idle.rateAscend.toFixed(2)} Hz`;
});

// ---- posture continuity through changes of behaviour -----------------------------

// Wrapped difference of two angles, magnitude only.
const turnBetween = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

// A walking fly in the full loop runs through `phases` ([ticks, walkDrive,
// groomDrive, sleep] each) and must pass through the `expected` states in
// order, with no joint, toe, heading or pitch jump between ticks. Special
// kinds add a stimulus: an escape or a nervous turn at the first tick, or a
// walk to the end of a ledge that is then dragged away under the fly.
function transitionCheck(kind, phases, expected) {
  check(`posture continuity: ${kind}`, () => {
    const brain = newBrain(), builder = new SignalBuilder();
    const fly = walkingFly();
    const dt = SimulationClock.fixedDT;
    brain.stimulate(brain.fwd, 0.15, 20000);
    let tickCount = 0;
    const nextSignals = () => {
      brain.legFeedback = fly.legFeedback;
      brain.step(tickCount % 3 === 2 ? 9 : 8);
      tickCount++;
      const s = builder.make(brain, dt);
      Object.assign(s, { escape: false, nervous: 0, arousal: 0, groomDrive: 0, walkDrive: 1, backward: false });
      return s;
    };
    for (let i = 0; i < 360; i++) fly.update(dt, BOUNDS, null, nextSignals());
    // A spontaneous flight can still happen at low arousal: let it end, then
    // make sure the scenario really starts from walking.
    for (let i = 0; i < 1200 && fly.state !== 'walking'; i++) fly.update(dt, BOUNDS, null, nextSignals());
    assert.equal(fly.state, 'walking', 'motor warmup must finish walking');
    const onLedge = kind === 'end of a window edge';
    if (onLedge) {
      const edge = { y: 0, x0: -40, x1: 40, id: 42 };
      fly.terrain = [edge];
      fly.ledge = edge;
      fly.pos = { x: 39, y: 0 };
      fly.heading = 0;
      fly.syncNode();
    }
    const pose = () => {
      fly.node.updateMatrixWorld(true);
      return {
        joints: fly.model.legs.flatMap((leg) => [leg.root, leg.knee, leg.ankle].map((node) => node.quaternion.clone())),
        toes: renderedToes(fly),
        heading: fly.heading,
        pitch: fly.pitch,
      };
    };
    const jump = { joint: 0, toe: 0, heading: 0, pitch: 0 };
    const states = [fly.state];
    let previous = pose(), tick = 0;
    let turnedAtEnd = !onLedge, leftMovedSupport = !onLedge, supportShift = 0;
    for (const [ticks, walk, groom, sleep] of phases) {
      for (let i = 0; i < ticks; i++, tick++) {
        const s = nextSignals();
        s.walkDrive = walk;
        s.groomDrive = groom;
        s.sleep = sleep;
        let mouse = null;
        if (tick === 0 && (kind === 'takeoff and landing' || kind === 'nervous dash')) {
          // a hand closing in 180 units ahead of the fly
          mouse = { x: fly.pos.x + 180 * Math.cos(fly.heading), y: fly.pos.y + 180 * Math.sin(fly.heading) };
          s.escape = kind === 'takeoff and landing';
          s.nervous = kind === 'nervous dash' ? 0.9 : 0;
        }
        const dragTick = onLedge && tick === 60;
        if (dragTick) {
          turnedAtEnd = fly.state === 'walking' && turnBetween(0, fly.heading) > 0.5;
          // The window under the fly moves away at the same height: she must
          // leave it, never be clamped onto the dragged window.
          fly.ledge = { y: 0, x0: -40, x1: 40, id: 42 };
          fly.terrain = [{ y: 0, x0: 360, x1: 440, id: 42 }];
        }
        const from = { ...fly.pos };
        fly.update(dt, BOUNDS, mouse, s);
        if (dragTick) {
          supportShift = Math.hypot(fly.pos.x - from.x, fly.pos.y - from.y);
          leftMovedSupport = fly.state === 'flying' && supportShift < 1;
        }
        const now = pose();
        previous.joints.forEach((q, j) => { jump.joint = Math.max(jump.joint, q.angleTo(now.joints[j])); });
        previous.toes.forEach((p, j) => { jump.toe = Math.max(jump.toe, p.distanceTo(now.toes[j])); });
        jump.heading = Math.max(jump.heading, turnBetween(previous.heading, now.heading));
        jump.pitch = Math.max(jump.pitch, Math.abs(now.pitch - previous.pitch));
        if (states.at(-1) !== fly.state) states.push(fly.state);
        previous = now;
      }
    }
    let reached = 0;
    for (const state of states) if (state === expected[reached]) reached++;
    const ledgeDetail = onLedge
      ? `; endpoint reversed ${turnedAtEnd}, moved support takeoff ${leftMovedSupport}, position delta ${supportShift.toFixed(3)}` : '';
    const detail = `joint ${jump.joint.toFixed(3)} rad, toe ${jump.toe.toFixed(3)} units, `
      + `heading ${jump.heading.toFixed(3)} rad, pitch ${jump.pitch.toFixed(3)} rad per tick; states ${states.join(' -> ')}`
      + ledgeDetail;
    assert(reached === expected.length && turnedAtEnd && leftMovedSupport
      && jump.joint < 0.35 && jump.toe < 3 && jump.heading < 0.18 && jump.pitch < 0.08, detail);
    return detail;
  });
}

// A moderate walking drive waits for grooming to end; a strong one
// (WALK_OVERRIDES_GROOMING) interrupts it, as DNp09 activation does.
transitionCheck('grooming, then walking again', [[120, 0, 1, false], [240, 0.6, 0, false]],
  ['walking', 'grooming', 'idle', 'walking']);
transitionCheck('walking breaks off grooming', [[120, 0, 1, false], [240, 1.2, 1, false]],
  ['walking', 'grooming', 'walking']);
transitionCheck('rest, sleep, wake', [[120, 0, 0, false], [120, 0, 0, true], [240, 0.6, 0, false]],
  ['walking', 'idle', 'sleeping', 'grooming', 'idle', 'walking']);
transitionCheck('takeoff and landing', [[480, 0, 0, false], [180, 1, 0, false]],
  ['walking', 'flying', 'idle', 'walking']);
transitionCheck('nervous dash', [[120, 1, 0, false]], ['walking']);
transitionCheck('end of a window edge', [[120, 1, 0, false]], ['walking', 'flying']);

if (failed) process.exitCode = 1;
else console.log('locomotortest: all checks pass');
