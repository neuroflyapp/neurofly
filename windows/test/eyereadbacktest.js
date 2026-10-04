// The eye's sampling (every 50 ms of simulated time) stays in
// TerrariumView.frame(). This focused test checks the readback behind it:
// up to three GPU reads are in flight, each into its own buffer; a fourth
// sample is not taken (no unused GPU pass); finished reads reach
// _processEye strictly in the order the images were taken, byte-identical,
// even when the GPU reports them out of order; display exposure is restored.
import assert from 'node:assert/strict';
import { TerrariumView } from '../renderer/view/terrarium.js';
import { visionForRun } from '../src/vision-input.js';

const W = 64, H = 24;
const view = Object.create(TerrariumView.prototype);
view.snap = { t: 1, neuralRun: 1, individual: 1, fly: { x: 12, y: -8, z: 3, heading: 0.42 } };
view.visionTarget = {};
view.visionPixels = new Uint8Array(W * H * 4);
view.eyeReads = [];
view.eyePool = [];
view.visionReadPending = false;
view.displayExposure = 1.7;
view.scene = {};
const cameraOps = [];
view.visionCamera = {
  position: { set(...args) { cameraOps.push(['position', ...args]); } },
  lookAt(...args) { cameraOps.push(['lookAt', ...args]); },
};
const gpuOps = [];
const pending = [];   // { pixels, resolve } per read, in submission order
view.renderer = {
  toneMappingExposure: 1.7,
  setRenderTarget(target) { gpuOps.push(['target', target]); },
  render(scene, camera) { gpuOps.push(['render', scene, camera]); },
  readRenderTargetPixelsAsync(target, x, y, w, h, pixels) {
    assert.equal(target, view.visionTarget);
    assert.deepEqual([x, y, w, h], [0, 0, W, H]);
    assert.equal(pixels.length, W * H * 4);
    assert.notEqual(pixels, view.visionPixels, 'each read fills its own buffer');
    gpuOps.push(['read']);
    return new Promise((resolve) => pending.push({ pixels, resolve }));
  },
};
const samples = [];
view._processEye = () => samples.push(Uint8Array.from(view.visionPixels));
const image = (k) => Uint8Array.from({ length: W * H * 4 }, (_, i) => (i * (17 + 6 * k) + 7 * k + 3) & 255);
const renders = () => gpuOps.filter((op) => op[0] === 'render').length;
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

// three samples go out while none has come back
for (let k = 0; k < 3; k++) assert.equal(view._renderEye(), true, `sample ${k} is taken`);
assert.equal(renders(), 3);
assert.equal(new Set(pending.map((p) => p.pixels)).size, 3, 'three distinct buffers');
assert.equal(view.visionReadPending, true);
assert.equal(view.renderer.toneMappingExposure, 1.7);

// a fourth while all slots are busy submits nothing
const before = [gpuOps.length, cameraOps.length];
assert.equal(view._renderEye(), false);
assert.deepEqual([gpuOps.length, cameraOps.length], before, 'a skipped sample must not submit an obsolete GPU eye pass');

// the GPU finishes the second and third first: nothing is processed before the first
pending[1].pixels.set(image(1)); pending[1].resolve();
pending[2].pixels.set(image(2)); pending[2].resolve();
await settle();
assert.equal(samples.length, 0, 'later images wait for the first');
pending[0].pixels.set(image(0)); pending[0].resolve();
await settle();
assert.equal(samples.length, 3);
for (let k = 0; k < 3; k++) assert.deepEqual(samples[k], image(k), `image ${k} arrives byte-identical and in order`);
assert.equal(view.visionReadPending, false);

// slots and buffers are reused
assert.equal(view._renderEye(), true);
pending[3].pixels.set(image(3)); pending[3].resolve();
await settle();
assert.deepEqual(samples[3], image(3));
assert.equal(view.renderer.toneMappingExposure, 1.7);
console.log('PASS eye readback: three reads in flight, none wasted, images processed in the order taken and byte-identical');

// An outstanding read belongs to the old run even if the new clock happens
// to have the same value. Switching neural run alone (same animal), or
// switching animal alone, must both invalidate old pixels and prime afresh.
for (const key of ['neuralRun', 'individual']) {
  view.eyePrimed = true;
  assert.equal(view._renderEye(), true);
  const old = pending.at(-1), before = samples.length;
  view.snap = { ...view.snap, [key]: view.snap[key] + 1 };
  view._syncEyeRun();
  assert.equal(view.eyePrimed, false);
  assert.equal(view._renderEye(), true);
  const fresh = pending.at(-1);
  fresh.pixels.set(image(6)); fresh.resolve();
  await settle();
  assert.equal(samples.length, before, 'new image waits until old buffer can be safely recycled');
  old.pixels.fill(255); old.resolve();
  await settle();
  assert.equal(samples.length, before + 1, 'only the fresh image is processed');
  assert.deepEqual(samples.at(-1), image(6));
  assert.equal(view.eyeReads.length, 0);
  assert.equal(view.eyePool.length, 3, 'every GPU-owned buffer is eventually recycled');
}
let sent;
view.onVision = input => { sent = input; };
view._sendVision(0.1, 0.2);
assert.deepEqual(visionForRun(sent, view.snap), { L: 0.1, R: 0.2 });
assert.equal(visionForRun(sent, { ...view.snap, neuralRun: view.snap.neuralRun + 1 }), null,
  'worker rejects an old result even before the renderer sees the new snapshot');
assert.equal(visionForRun(sent, { ...view.snap, individual: view.snap.individual + 1 }), null);
for (const bad of [null, {}, { L: 1, R: 1 }, { ...sent, L: NaN }, { ...sent, R: Infinity },
  { ...sent, neuralRun: String(sent.neuralRun) }]) assert.equal(visionForRun(bad, view.snap), null);
assert.deepEqual(visionForRun({ ...sent, L: -1, R: 3 }, view.snap), { L: 0, R: 1 });
console.log('PASS eye run boundaries: stale GPU frames are discarded, buffers recycled, worker validates identity and finite input');

// Exercise the real image processor too: a new run's first image primes the
// reference and emits zero, even when its pixels differ from the old animal.
const retina = Object.create(TerrariumView.prototype);
retina.visionPixels = image(1);
for (const name of ['visionPrevLum', 'visionMotion', 'visionResidual', 'visionSurround', 'visionScratch'])
  retina[name] = new Float32Array(W * H);
retina.snap = { t: 0, neuralRun: 9, individual: 4 };
retina.onVision = input => { sent = input; };
retina._syncEyeRun(); retina.eyeImageT = 0.05; retina._processEye();
assert.deepEqual(sent, { L: 0, R: 0, neuralRun: 9, individual: 4 });
retina.snap = { t: 0.05, neuralRun: 10, individual: 4 };
retina._syncEyeRun(); retina.visionPixels.fill(255); retina.eyeImageT = 0.1; retina._processEye();
assert.deepEqual(sent, { L: 0, R: 0, neuralRun: 10, individual: 4 });
console.log('PASS new retinal run primes its reference without manufacturing a visual threat');
