// performancetest.js -- telemetry must measure, never hide a slow frame.

import { AdaptiveRenderQuality, DisplayPacer, PerformanceMeter, classifyRunTiming } from '../src/performance.js';
import { buildOutgoingEdgeIndex, sampleVisibleEdges } from '../src/edge-index.js';
import { SimulationClock } from '../src/sim.js';
import { ClosedLoop } from '../src/closed-loop.js';
import { loadBrainData } from '../src/data.js';

let failures = 0;
const near = (actual, expected, tolerance = 1e-8) => Math.abs(actual - expected) < tolerance;
function check(name, fn) {
  const [ok, detail] = fn();
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

check('runtime meter reports exact throughput over its completed measurement window', () => {
  const meter = new PerformanceMeter(1);
  meter.noteSimulation({ simulatedSeconds: 0.75, computeSeconds: 0.25, spikes: 120, deliveries: 4800 });
  meter.noteSimulation({ droppedSeconds: 0.02 });
  for (let i = 0; i < 60; i++) meter.noteFrame(1 / 60);
  const p = meter.snapshot();
  const ok = near(p.fps, 60) && near(p.simulationRealtime, 0.75)
    && near(p.coreRealtime, 3) && near(p.neuralStepsPerSecond, 750)
    && near(p.spikesPerSecond, 120) && near(p.synapticDeliveriesPerSecond, 4800)
    && near(p.droppedSecondsPerSecond, 0.02);
  return [ok, `${p.fps.toFixed(1)} fps, ${p.simulationRealtime.toFixed(2)}x, ${p.neuralStepsPerSecond} ms/s`];
});

check('short incomplete windows retain the last committed measurement', () => {
  const meter = new PerformanceMeter(1);
  meter.noteFrame(1);
  const committed = meter.snapshot();
  meter.noteSimulation({ simulatedSeconds: 0.5 });
  meter.noteFrame(0.1);
  const held = meter.snapshot();
  return [held === committed && held.windowSeconds === 1,
    `held ${held.windowSeconds.toFixed(1)}s measurement until the next full window`];
});

check('simulation clock reports elapsed time it deliberately does not simulate', () => {
  const clock = new SimulationClock();
  let ticks = 0;
  clock.advance(0.25, () => { ticks++; });
  const dropped = clock.consumeDroppedSeconds();
  const cleared = clock.consumeDroppedSeconds();
  const ok = ticks === 12 && Math.abs(dropped - 0.15) < 1e-9 && cleared === 0;
  return [ok, `${ticks} fixed ticks, ${(dropped * 1000).toFixed(0)} ms reported as dropped`];
});

check('adaptive render quality protects real-time simulation before lowering display detail', () => {
  const quality = new AdaptiveRenderQuality({ minPixelRatio: 0.8, maxPixelRatio: 1.5 });
  const initial = quality.pixelRatio;
  const low = quality.observe({ fps: 30, simulationRealtime: 0.8, droppedSecondsPerSecond: 0.01 });
  const stable = new AdaptiveRenderQuality({ minPixelRatio: 0.8, maxPixelRatio: 1.5, startPixelRatio: 1.2 });
  for (let i = 0; i < 5; i++) stable.observe({ fps: 60, simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  const recovered = stable.observe({ fps: 60, simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  return [low < initial && Math.abs(recovered - 1.25) < 1e-10,
    `${initial.toFixed(2)} -> ${low.toFixed(2)} under load; ${recovered.toFixed(2)} after headroom`];
});

check('sustained load reaches minimum resolution with fewer reallocations and settling time', () => {
  const quality = new AdaptiveRenderQuality();
  const trace = Array.from({ length: 10 }, () => quality.observe({ fps: 30, simulationRealtime: 0.7 }));
  const changes = trace.filter((v, i) => v !== (i ? trace[i - 1] : 1.5));
  return [changes.join(',') === '1.25,1,0.75' && trace[1] === trace[0] && trace[2] === trace[0]
    && trace[6] === 0.75, `${changes.length} buffer resizes over 10 windows; ratios ${trace.join(',')}`];
});

check('brief headroom never repeatedly grows and shrinks the canvas', () => {
  const quality = new AdaptiveRenderQuality({ startPixelRatio: 0.75 });
  const trace = [];
  for (let i = 0; i < 40; i++) trace.push(quality.observe({
    fps: i % 4 === 3 ? 35 : 60, simulationRealtime: i % 4 === 3 ? 0.8 : 1,
  }));
  return [trace.every(v => v === 0.75), '40 alternating load/headroom windows: zero buffer reallocations'];
});

check('quality tiers preserve non-grid bounds and sustained recovery', () => {
  const quality = new AdaptiveRenderQuality({ minPixelRatio: 0.83, maxPixelRatio: 1.37 });
  for (let i = 0; i < 12; i++) quality.observe({ fps: 20, simulationRealtime: 0.5 });
  const floor = quality.pixelRatio;
  const trace = Array.from({ length: 40 }, () => quality.observe({ fps: 60, simulationRealtime: 1 }));
  return [floor === 0.83 && quality.pixelRatio === 1.37 && trace.every(v => v >= 0.83 && v <= 1.37),
    `floor ${floor}, recovered to ${quality.pixelRatio}; every step remains within requested bounds`];
});

check('display pacing yields frames to a lagging simulation and returns them only after sustained headroom', () => {
  const pacer = new DisplayPacer({ maxStride: 3, recoverWindows: 4 });
  const drawn = (frames) => { let d = 0; for (let i = 0; i < frames; i++) if (pacer.shouldDraw()) d++; return d; };
  const full = drawn(60);
  const s1 = pacer.observe({ simulationRealtime: 0.8, droppedSecondsPerSecond: 0.1 });
  const half = drawn(60);
  const s2 = pacer.observe({ simulationRealtime: 0.9, droppedSecondsPerSecond: 0 });
  const s3 = pacer.observe({ simulationRealtime: 0.5, droppedSecondsPerSecond: 0.2 });   // capped
  const third = drawn(60);
  const held = [1, 2, 3].map(() => pacer.observe({ simulationRealtime: 1, droppedSecondsPerSecond: 0 }));
  const stepped = pacer.observe({ simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  const relapse = pacer.observe({ simulationRealtime: 0.95, droppedSecondsPerSecond: 0 });
  const ok = full === 60 && s1 === 2 && half === 30 && s2 === 3 && s3 === 3 && third === 20
    && held.every((s) => s === 3) && stepped === 2 && relapse === 3;
  return [ok, `strides ${s1}/${s2}/${s3}, ${full}/${half}/${third} of 60 frames drawn; recovery after 4 healthy windows to ${stepped}, relapse to ${relapse}`];
});

check('other simulation work can hold the display at a minimum stride, released afterwards', () => {
  const pacer = new DisplayPacer({ maxStride: 3, recoverWindows: 4 });
  pacer.minStride = 3;
  const held = pacer.observe({ simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  let drawn = 0; for (let i = 0; i < 60; i++) if (pacer.shouldDraw()) drawn++;
  pacer.minStride = 1;
  const steps = []; for (let w = 0; w < 8; w++) steps.push(pacer.observe({ simulationRealtime: 1, droppedSecondsPerSecond: 0 }));
  const ok = held === 3 && drawn === 20 && steps[3] === 2 && steps[7] === 1;
  return [ok, `held at ${held} (${drawn}/60 drawn); after release ${steps.join(',')}`];
});

check('a paused or keeping-pace run draws every frame', () => {
  const pacer = new DisplayPacer();
  for (let i = 0; i < 10; i++) pacer.observe({ simulationRealtime: 1, droppedSecondsPerSecond: 0 });
  let d = 0; for (let i = 0; i < 60; i++) if (pacer.shouldDraw()) d++;
  return [pacer.stride === 1 && d === 60, `stride ${pacer.stride}, ${d} of 60 frames drawn`];
});

check('run timing separates pauses, measurement, slow execution and missing simulation time', () => {
  const perf = (simulationRealtime, totalDroppedSimulationSeconds = 0, windowSeconds = 1) =>
    ({ simulationRealtime, totalDroppedSimulationSeconds, windowSeconds });
  const states = [
    classifyRunTiming({ paused: true, speed: 1, perf: perf(0) }),
    classifyRunTiming({ speed: 1, perf: perf(0, 0, 0) }),
    classifyRunTiming({ speed: 2, perf: perf(1.4) }),
    classifyRunTiming({ speed: 2, perf: perf(2) }),
    classifyRunTiming({ speed: 2, perf: perf(2, 0.02) }),
    classifyRunTiming({ speed: 2, perf: { ...perf(2, 0.02), runDroppedSimulationSeconds: 0 } }),
  ];
  const expected = ['paused', 'measuring', 'behind', 'on-pace', 'gap', 'on-pace'];
  return [JSON.stringify(states) === JSON.stringify(expected), states.join(', ')];
});

check('a new fly starts with a clean run clock while session loss stays auditable', () => {
  const rig = new ClosedLoop({ data: loadBrainData(), seed: 472, hour: 12, empty: true, spikeBus: false });
  rig.advance(0.25);
  const before = rig.runDroppedSimulationSeconds;
  rig.respawn({ seed: 473 });
  const event = rig.journal.events.findLast((e) => e.kind === 'respawn');
  const p = rig.performanceSnapshot();
  const ok = Math.abs(before - 0.15) < 1e-8
    && rig.runDroppedSimulationSeconds === 0
    && Math.abs(rig.totalDroppedSimulationSeconds - before) < 1e-8
    && Math.abs(event.details.previousRunDroppedSimulationSeconds - before) < 1e-8
    && p.runDroppedSimulationSeconds === 0
    && Math.abs(p.totalDroppedSimulationSeconds - before) < 1e-8;
  return [ok, `prior run ${before.toFixed(3)} s, new run ${p.runDroppedSimulationSeconds.toFixed(3)} s, session ${p.totalDroppedSimulationSeconds.toFixed(3)} s`];
});

check('compact outgoing index preserves every measured edge and its original order', () => {
  const from = Int32Array.from([2, 0, 2, 1, 2, 0, 1]);
  const out = buildOutgoingEdgeIndex(from, 4);
  const actual = out.map(a => [...a]);
  const expected = [[1, 5], [3, 6], [0, 2, 4], []];
  return [JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual)];
});

check('allocation-bounded ambient selection matches the previous visible stride sample', () => {
  const from = Int32Array.from([0, 1, 2, 0, 3, 1, 2, 3, 0]);
  const to = Int32Array.from([1, 2, 3, 2, 0, 3, 0, 1, 3]);
  const groups = Int32Array.from([0, 1, 1, 2]);
  const visible = Uint8Array.from([1, 1, 0]);
  const filtered = from.map((_, k) => k).filter(k => visible[groups[from[k]]] && visible[groups[to[k]]]);
  const cap = 2, stride = Math.max(1, Math.ceil(filtered.length / cap));
  const expected = [...filtered.filter((_, i) => i % stride === 0)];
  const actual = [...sampleVisibleEdges(from, to, groups, visible, cap)];
  const empty = sampleVisibleEdges(from, to, groups, Uint8Array.from([0, 0, 0]), cap);
  return [JSON.stringify(actual) === JSON.stringify(expected) && empty.length === 0,
    `selected ${actual.join(',')} of ${filtered.length} eligible edges`];
});

console.log(failures === 0 ? 'ALL PERFORMANCE TESTS PASS' : `${failures} PERFORMANCE TESTS FAILED`);
process.exit(failures === 0 ? 0 : 1);
