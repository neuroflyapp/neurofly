// worldtest.js — the terrarium's own sensing/placement invariants.
//   node test/worldtest.js
//
// simtest/behaviortest/locomotortest cover the brain and body; nothing
// covered world.js itself, which is exactly where three real bugs were
// found and fixed: a freshly spawned fly could land inside a
// solid object, touch/looming ignored the fly's real altitude (a flying fly
// "touched" the ground below it), and a firefly's decorative twinkle drove
// its actual light every frame, which the vision-looming pathway read as a
// nonstop nearby event. This file pins down the World-side half of each fix
// so a future change can't silently reintroduce any of them.

import { resetRandom } from './random.js';
import { World } from '../src/world.js';
import { Fly } from '../src/flymodel.js';

const bounds = { width: 1512, height: 982 };
const dt = 1 / 120;
let failures = 0;
function check(name, fn) {
  const [ok, describe] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${describe}`);
}

// Ground texture is visual, but the fly's rendered eye may see it. A copied
// layout must therefore repaint the same pixels even in another process or
// after resize, regardless of the renderer's unrelated random draws.
{
  const previousDocument = globalThis.document;
  const previousRandom = Math.random;
  globalThis.document = {
    createElement(kind) {
      if (kind !== 'canvas') throw new Error(`unexpected element ${kind}`);
      const trace = [];
      const context = {
        fillStyle: '',
        fillRect(...args) { trace.push(['rect', ...args, this.fillStyle]); },
        beginPath() {},
        ellipse(...args) { trace.push(['ellipse', ...args, this.fillStyle]); },
        arc(...args) { trace.push(['arc', ...args, this.fillStyle]); },
        fill() {},
      };
      return { width: 0, height: 0, trace, getContext: () => context };
    },
  };
  try {
    const ground = (seed, platformDraw) => {
      Math.random = () => platformDraw;
      const world = new World(bounds, { layout: { landscapeSeed: seed, objects: [] }, empty: true });
      return JSON.stringify(world._ground.material.map.image.trace);
    };
    const a = ground(12345, 0.01);
    const b = ground(12345, 0.99);
    const c = ground(54321, 0.01);
    check('ground pixels follow the layout seed, not the renderer RNG', () =>
      [a === b && a !== c, `same seed equal=${a === b}, changed seed differs=${a !== c}`]);
  } finally {
    globalThis.document = previousDocument;
    Math.random = previousRandom;
  }
}

// ---- a freshly spawned fly should never land inside an existing object ----
resetRandom('worldtest-spawn');
{
  const world = new World(bounds);
  const trials = 500;
  let overlaps = 0;
  for (let i = 0; i < trials; i++) {
    const p = world.findClearSpot(bounds, 22, 20);
    const hit = world.objects.some((o) => Math.hypot(o.pos.x - p.x, o.pos.y - p.y) < o.radius + 22);
    if (hit) overlaps++;
  }
  check("findClearSpot never lands inside an existing object", () =>
    [overlaps === 0, `${overlaps}/${trials} overlapping spawns`]);
}

// ---- touch/looming must respect the fly's real rendered altitude ----
resetRandom('worldtest-altitude');
{
  const world = new World(bounds);
  const solid = world.objects.find((o) => o.solid);
  if (!solid) {
    failures++;
    console.log('FAIL  altitude setup: no solid object in a fresh terrarium');
  } else {
    const fly = new Fly({ x: solid.pos.x, y: solid.pos.y });
    fly.heading = 0;
    fly.node.position.z = 0;
    const ground = world.sense(fly);
    fly.node.position.z = 400; // well above any real object's approximated height
    const aloft = world.sense(fly);
    check("touch/loom go silent once the fly clears a solid object's real height", () =>
      [ground.tap > 0.5 && aloft.tap === 0 && aloft.loomL < 0.01 && aloft.loomR < 0.01,
        `ground tap=${ground.tap.toFixed(2)} loomL=${ground.loomL.toFixed(2)} -> `
        + `aloft tap=${aloft.tap.toFixed(2)} loomL=${aloft.loomL.toFixed(2)}`]);

    fly.node.position.z = 0;
    fly.pos.x = solid.pos.x + 1; fly.pos.y = solid.pos.y;
    world.collide(fly);
    const pushedDist = Math.hypot(fly.pos.x - solid.pos.x, fly.pos.y - solid.pos.y);
    fly.pos.x = solid.pos.x + 1; fly.pos.y = solid.pos.y;
    fly.node.position.z = 400;
    world.collide(fly);
    const aloftDist = Math.hypot(fly.pos.x - solid.pos.x, fly.pos.y - solid.pos.y);
    check('collide() only pushes an overlapping fly out at ground level, not mid-flight', () =>
      [pushedDist > solid.radius && aloftDist === 1,
        `ground push -> ${pushedDist.toFixed(1)}pt clear (radius ${solid.radius}), `
        + `aloft stayed at ${aloftDist.toFixed(1)}pt`]);
  }
}

// A body bump behind the fly cannot be reported as antennal displacement.
// Both events remain measurable, but only the antenna-localised one may
// enter the Johnston's-organ population in the closed loop.
resetRandom('worldtest-antenna-contact');
{
  const world = new World(bounds, { empty: true, dressing: false });
  const fly = new Fly({ x: 0, y: 0 });
  fly.heading = 0; // antennae point along +X
  const object = { kind: 'rock', pos: { x: -13, y: 0 }, radius: 8, solid: true, scent: 0 };
  world.objects.push(object);
  const behind = world.sense(fly);
  object.pos.x = 13;
  const ahead = world.sense(fly);
  check('body contact behind the fly stays out of antennal JO input', () =>
    [behind.tap > 0 && behind.antennaTap === 0 && ahead.tap > 0 && ahead.antennaTap > 0.5,
      `behind body=${behind.tap.toFixed(2)} antenna=${behind.antennaTap.toFixed(2)}; `
      + `ahead antenna=${ahead.antennaTap.toFixed(2)}`]);
}

// ---- a firefly's glow is a brief periodic flash, not a continuous twinkle
// (the fix for the vision-looming pathway reading it as a nonstop event) ----
resetRandom('worldtest-firefly-flash');
{
  const world = new World(bounds);
  const firefly = world.objects.find((o) => o.kind === 'firefly');
  const period = firefly.flashPeriod;
  const flashTicks = Math.round(0.35 / dt);
  const periodTicks = Math.round(period / dt);
  let prevOpacity = firefly.glow.material.opacity;
  let changingTicks = 0;
  for (let i = 0; i < periodTicks; i++) {
    world.update(dt, bounds);
    const o = firefly.glow.material.opacity;
    if (Math.abs(o - prevOpacity) > 1e-6) changingTicks++;
    prevOpacity = o;
  }
  check('firefly glow changes only during its brief flash, constant the rest of the cycle', () =>
    [changingTicks > flashTicks * 0.3 && changingTicks < flashTicks * 1.5,
      `${changingTicks} changing ticks over one ${period.toFixed(1)}s period `
      + `(flash window ~${flashTicks} ticks, full period ${periodTicks} ticks)`]);
}

console.log(failures === 0 ? 'ALL WORLD TESTS PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
