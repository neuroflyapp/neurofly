// behaviortest.js — from simulated neurons to the body. Stimulating a command
// population must produce its behaviour, and the body model must keep its
// contracts: ledges, sleep, temperature, flight, landing, the circadian curve
// and frame-rate independence. MUST pass after any behaviour change.
//   node test/behaviortest.js

import { resetRandom } from './random.js';
import { loadBrainData } from '../src/data.js';
import { LIFSim, makeSignals } from '../src/sim.js';
import { SignalBuilder } from '../src/signals.js';
import { Fly, FLY_SCALE, WANDER_JITTER, EDGE_MARGIN } from '../src/flymodel.js';
import { circadianActivity, makeLedge } from '../src/environment.js';
import { rnd, lag, TUNED_HZ, withRandom } from '../src/util.js';

const data = loadBrainData();
if (!data) {
  console.error('no data/ — run etl.py first');
  process.exit(1);
}

const BOUNDS = { width: 1512, height: 982 };
const FRAME = 1 / 60;                      // s per body update
const FRAME_MS = Math.round(FRAME * 1000); // neural ms per body update
const fixed = (x, digits = 2) => x.toFixed(digits);
const signed = (x, digits = 2) => (x >= 0 ? '+' : '') + x.toFixed(digits);
let failures = 0;

function report(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

// ---- brain → body ------------------------------------------------------------
// A fresh network and an idle fly; the network settles for 400 ms (any GF
// spike of its start-up is discarded), then the stimulus is applied and the
// signals drive the fly frame by frame until `reached(fly)` or time is up.
// Each scenario draws from its own random stream, named after it.
function brainScenario({ name, stimulate, seconds, prepare, withoutGrooming = false, reached, detail }) {
  resetRandom(name);
  const brain = new LIFSim(data.circuit, null);
  const signals = new SignalBuilder();
  const fly = Object.assign(new Fly({ x: 0, y: 0 }), { state: 'idle', speed: 0 });
  prepare?.(fly);
  brain.step(400);
  brain.consumeGF();
  stimulate(brain);
  let ok = false;
  for (let frame = 0, frames = Math.floor(seconds / FRAME); frame < frames && !ok; frame++) {
    brain.step(FRAME_MS);
    const s = signals.make(brain, FRAME);
    // A spontaneous grooming bout would compete with forward recruitment;
    // the DNg11 scenario covers grooming itself.
    if (withoutGrooming) s.groomDrive = 0;
    fly.update(FRAME, BOUNDS, null, s);
    ok = reached(fly);
  }
  report(name, ok, detail(fly));
}

const stateOf = (fly) => `state=${fly.state}`;
const stateAndSpeed = (fly) => `state=${fly.state} speed=${Math.trunc(fly.speed)}`;

const BRAIN_SCENARIOS = [
  {
    name: 'giant fiber stimulated: escape flight', seconds: 0.5,
    stimulate: (b) => b.stimulate(b.gf, 0.5, 40),
    reached: (fly) => fly.state === 'flying', detail: stateOf,
  },
  {
    name: 'DNg11 stimulated: grooming', seconds: 1.5,
    stimulate: (b) => b.stimulate(b.groom, 0.25, 600),
    reached: (fly) => fly.state === 'grooming', detail: stateOf,
  },
  {
    name: 'DNp09 stimulated: walks faster, within a cap', seconds: 1.5, withoutGrooming: true,
    stimulate: (b) => b.stimulate(b.fwd, 0.25, 1200),
    reached: (fly) => fly.state === 'walking' && fly.speed > 40 && fly.speed < 100, detail: stateAndSpeed,
  },
  {
    name: 'MDN stimulated at rest: walks backwards', seconds: 1.2,
    stimulate: (b) => b.stimulate(b.mdn, 0.3, 600),
    reached: (fly) => fly.backwardTimer > 0, detail: (fly) => `backwardTimer=${fixed(fly.backwardTimer)}`,
  },
  {
    // heading grows counter-clockwise; the fly starts walking along 0 rad
    name: 'left DNa stimulated while walking: turns left', seconds: 1.4,
    prepare: (fly) => { fly.state = 'walking'; fly.speed = 30; fly.heading = 0; },
    stimulate: (b) => b.stimulate(b.dnaL, 0.3, 900),
    reached: (fly) => fly.heading > 0.25, detail: (fly) => `heading change ${signed(fly.heading)} rad`,
  },
  {
    name: 'moderate loom: darts or escapes', seconds: 1.0,
    stimulate: (b) => { b.loomL = 0.45; b.loomR = 0.45; },
    reached: (fly) => (fly.state === 'walking' && fly.speed > 100) || fly.state === 'flying', detail: stateAndSpeed,
  },
  {
    name: 'Johnston-organ neurons stimulated: startle escape', seconds: 0.8,
    stimulate: (b) => b.stimulate(b.sens, 0.45, 150),
    reached: (fly) => fly.state === 'flying', detail: stateOf,
  },
];
for (const scenario of BRAIN_SCENARIOS) brainScenario(scenario);

// ---- body contracts (hand-made signals, no network) --------------------------
function bodyCheck(name, run) {
  resetRandom(name);
  report(name, ...run()); // run() gives [ok, detail]
}

// Updates the fly `frames` times with `signals` (a function of the frame, or
// one object), stopping early once `until(fly)` holds; returns whether it did.
function play(fly, frames, signals, until = () => false) {
  for (let frame = 0; frame < frames; frame++) {
    fly.update(FRAME, BOUNDS, null, typeof signals === 'function' ? signals(frame) : signals);
    if (until(fly)) return true;
  }
  return false;
}

function walkingFly(x, y, speed) {
  const fly = new Fly({ x, y });
  fly.state = 'walking';
  fly.speed = speed;
  fly.heading = 0;
  return fly;
}

function flyingFly(options) {
  const fly = new Fly({ x: 0, y: 0 });
  fly.state = 'idle';
  fly.startFlight(BOUNDS, options);
  return fly;
}

bodyCheck('flight target stays on a display when random samples fall in a monitor gap', () => {
  const fly = new Fly({ x: 250, y: 0 });
  fly.screens = [
    { x0: -756, x1: -200, y0: -491, y1: 491 },
    { x0: 200, x1: 756, y0: -491, y1: 491 },
  ];
  fly.pos = { x: 250, y: 0 };
  const target = withRandom(() => 0.5, () => fly._randomFlightTarget(BOUNDS, true, { x: 600, y: 0 }));
  const safe = fly.onScreen(target.x, target.y, EDGE_MARGIN);
  return [safe && target.x < 0 && Math.hypot(target.x - fly.pos.x, target.y) > 350,
    `target (${fixed(target.x)}, ${fixed(target.y)}), on display=${safe}`];
});

bodyCheck('flight target degrades safely when a display is narrower than the margin', () => {
  const fly = new Fly({ x: 0, y: 0 });
  fly.screens = [{ x0: -40, x1: 40, y0: -50, y1: 50 }];
  const target = withRandom(() => 0.5, () => fly._randomFlightTarget(BOUNDS, false, null));
  return [fly.onScreen(target.x, target.y) && Number.isFinite(target.x) && Number.isFinite(target.y),
    `target (${fixed(target.x)}, ${fixed(target.y)})`];
});

const walkSignals = makeSignals();
walkSignals.walkDrive = 0.6;
const wingOf = (fly) => fly.model.foldedWings.children[0].rotation;

bodyCheck('walks onto a window edge and follows it', () => {
  const fly = walkingFly(0, -55, 30);
  fly.terrain = [makeLedge(-40, -300, 300, 1)];
  const attached = play(fly, 240, walkSignals, (f) => f.ledge && Math.abs(f.pos.y + 40) < 8);
  return [attached, attached ? `attached, y=${Math.trunc(fly.pos.y)}`
    : `state=${fly.state} y=${Math.trunc(fly.pos.y)} ledge=${!!fly.ledge}`];
});

bodyCheck('takes off when the window under her closes', () => {
  const fly = walkingFly(0, -40, 25);
  fly.ledge = makeLedge(-40, -300, 300, 1); // standing on it, and it is gone
  fly.terrain = [];
  const tookOff = play(fly, 60, walkSignals, (f) => f.state === 'flying');
  return [tookOff, tookOff ? 'took off' : `state=${fly.state}`];
});

bodyCheck('sleeps on the sleep signal, grooms on waking', () => {
  const fly = new Fly({ x: 0, y: 0 });
  fly.state = 'idle';
  const s = makeSignals();
  s.sleep = true;
  play(fly, 60, s);
  if (fly.state !== 'sleeping') return [false, `no sleep: ${fly.state}`];
  s.sleep = false;
  play(fly, 1, s);
  return [fly.state === 'grooming', `woke to ${fly.state}`];
});

bodyCheck('warmth speeds up walking', () => {
  const fly = walkingFly(0, 0, 20);
  play(fly, 120, { ...walkSignals, tempo: 1.0 });
  const coolSpeed = fly.speed;
  play(fly, 120, { ...walkSignals, tempo: 1.5 });
  const hotSpeed = fly.speed;
  const faster = fly.state === 'walking' && hotSpeed > coolSpeed + 10;
  return [faster, `${Math.trunc(coolSpeed)} pt/s at tempo 1, ${Math.trunc(hotSpeed)} pt/s at tempo 1.5`];
});

bodyCheck('flight: size follows altitude, escapes climb higher', () => {
  // Highest altitude and on-screen scale over a flight (at most 400 frames).
  const peak = (options) => {
    const fly = flyingFly(options);
    let alt = 0, scale = 0;
    for (let frame = 0; fly.state === 'flying' && frame < 400; frame++) {
      fly.update(FRAME, BOUNDS, null, makeSignals());
      alt = Math.max(alt, fly.alt);
      scale = Math.max(scale, fly.node.scale.x);
    }
    return { alt, scale };
  };
  const escape = peak({ escape: true, effort: null });
  const casual = peak({ escape: false, effort: 0.45 });
  // the scale follows altitude: FLY_SCALE × (1 + 0.8 × alt)
  const ok = escape.alt > casual.alt + 0.15 && escape.scale > FLY_SCALE * 1.5
    && Math.abs(escape.scale - FLY_SCALE * (1 + 0.8 * escape.alt)) < 0.15;
  return [ok, `escape alt ${fixed(escape.alt)} scale ${fixed(escape.scale)} | `
    + `casual alt ${fixed(casual.alt)} scale ${fixed(casual.scale)}`];
});

bodyCheck('flight: the wings beat', () => {
  const fly = flyingFly({ effort: 0.8 });
  let low = Infinity, high = -Infinity;
  for (let frame = 0; frame < 30 && fly.state === 'flying'; frame++) {
    fly.update(FRAME, BOUNDS, null, makeSignals());
    low = Math.min(low, wingOf(fly).z);
    high = Math.max(high, wingOf(fly).z);
  }
  return [high - low > 0.25, `wing sweep ${fixed(high - low)} rad over 0.5 s`];
});

bodyCheck('escape DNs in flight raise the wing-beat effort', () => {
  const fly = flyingFly({ effort: 0.5 });
  play(fly, 12, makeSignals());
  const calmEffort = fly.effortCurrent;
  const aroused = makeSignals();
  aroused.wingDrive = 1.0;
  aroused.arousal = 0.6;
  play(fly, 12, aroused, (f) => f.state !== 'flying');
  const drivenEffort = fly.effortCurrent;
  return [fly.state === 'flying' && drivenEffort > calmEffort + 0.2,
    `effort ${fixed(calmEffort)} -> ${fixed(drivenEffort)}`];
});

bodyCheck('a threat on the ground raises the wings without takeoff', () => {
  const fly = new Fly({ x: 0, y: 0 });
  fly.state = 'walking';
  fly.speed = 20;
  fly.dartCooldown = 99; // no darting: only the posture is under test
  const threat = makeSignals();
  threat.wingDrive = 0.9;
  threat.walkDrive = 0.4;
  play(fly, 40, threat);
  const tilt = wingOf(fly).x;
  return [fly.state !== 'flying' && fly.wingRaise > 0.6 && tilt < -0.2,
    `raise ${fixed(fly.wingRaise)}, wing tilt ${fixed(tilt)} rad`];
});

bodyCheck('lands without a jump in size or height', () => {
  // Largest frame-to-frame jump in scale and height, through the landing and
  // 20 frames beyond it.
  const fly = flyingFly({ escape: true });
  let scale = fly.node.scale.x, z = fly.node.position.z;
  let scaleJump = 0, zJump = 0, landed = false;
  for (let frame = 0, after = 20; after > 0 && frame < 600; frame++) {
    fly.update(FRAME, BOUNDS, null, makeSignals());
    scaleJump = Math.max(scaleJump, Math.abs(fly.node.scale.x - scale));
    zJump = Math.max(zJump, Math.abs(fly.node.position.z - z));
    scale = fly.node.scale.x;
    z = fly.node.position.z;
    if (fly.state !== 'flying') {
      landed = true;
      after--;
    }
  }
  return [landed && scaleJump < 0.2 && zJump < 25,
    `landed=${landed ? 'yes' : 'NO'}, max per-frame dScale ${fixed(scaleJump)}, dz ${fixed(zJump, 1)}`];
});

bodyCheck('daily rhythm: low at night and siesta, high at dawn and dusk', () => {
  const [night, dawn, siesta, dusk] = [3, 9, 14, 18].map((hour) => circadianActivity(hour));
  const ok = night < 0.4 && dawn > 0.9 && siesta > 0.3 && siesta < 0.7 && dusk > 0.9;
  return [ok, `3h ${fixed(night)}, 9h ${fixed(dawn)}, 14h ${fixed(siesta)}, 18h ${fixed(dusk)}`];
});

// Both halves of the frame-rate fix: before it, a first-order lag was 27% off
// at the 50 ms frame cap, and the heading's random walk spread by √2 more at
// 60 Hz than at 120 Hz.
bodyCheck('body update independent of the frame rate', () => {
  // At the rate the constants were tuned for, lag() equals the old k·dt.
  const exactAtTuned = [0.05, 0.9, 3, 4, 6, 8, 9, 10]
    .every((k) => Math.abs(lag(k, 1 / TUNED_HZ) - k / TUNED_HZ) < 1e-12);
  // The same 100 ms of lag in eight slices or in one.
  let sliced = 0;
  for (let i = 0; i < 8; i++) sliced += (1 - sliced) * lag(10, 0.1 / 8);
  const whole = lag(10, 0.1);
  // Standard deviation of the heading after 2 s of wandering at frame dt.
  const wanderSpread = (frameDt) => {
    let squares = 0;
    for (let run = 0; run < 4000; run++) {
      let heading = 0;
      for (let t = 0; t < 2; t += frameDt) heading += rnd(-1, 1) * WANDER_JITTER * Math.sqrt(frameDt);
      squares += heading * heading;
    }
    return Math.sqrt(squares / 4000);
  };
  const at60 = wanderSpread(1 / 60), at120 = wanderSpread(1 / 120);
  const ok = exactAtTuned && Math.abs(sliced - whole) < 1e-6 && Math.abs(at60 - at120) / at60 < 0.1;
  return [ok, `60Hz exact=${exactAtTuned ? 'yes' : 'NO'}, lag 8x12.5ms ${sliced.toFixed(6)} `
    + `vs 1x100ms ${whole.toFixed(6)}, wander sd ${at60.toFixed(3)} @60Hz vs ${at120.toFixed(3)} @120Hz`];
});

console.log(failures === 0 ? 'behaviortest: all checks pass' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
