// util.js — numeric helpers for the body, the world and the behaviour rules.

// ---- randomness ------------------------------------------------------------------------------
// All behavioural and world randomness is drawn here. Inside ClosedLoop a seeded
// generator is installed for every step, command and trial reset (withRandom),
// which makes a run a function of its seed; with none installed the platform
// generator answers (renderer-only decoration).
let installed = null;
export const random = () => (installed === null ? Math.random() : installed());
export const rnd = (lo, hi) => lo + random() * (hi - lo);
export function withRandom(generator, work) {
  const outer = installed;
  installed = generator;
  try { return work(); } finally { installed = outer; }
}

// A 32-bit counter-based generator (the "mulberry32" mixing function): one add,
// three xor-shift-multiply rounds, uniform in [0, 1).
export function seededRandom(seed) {
  let counter = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let z = counter;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
// The body/world stream is keyed on the neural seed but must not repeat it.
export const bodySeed = (seed) => ((Number(seed) >>> 0) ^ 0x85ebca6b) >>> 0;

// ---- rate-independent smoothing ---------------------------------------------------------------
// The behaviour constants are rates k whose per-step weight was calibrated as
// k/60 at a 60 Hz step. lag(k, dt) keeps exactly that weight at dt = 1/60 and,
// at any other step, compounds it: after one second the weight left over is
// the same whatever the step size, so behaviour does not depend on the frame
// or simulation rate. (1 - exp(-k dt) would be step-independent too, but it is
// a different curve and would shift the calibrated 60 Hz behaviour.)
export const TUNED_HZ = 60;
export function lag(k, dt) {
  const weight = Math.min(1, k / TUNED_HZ);
  return weight >= 1 ? 1 : 1 - Math.pow(1 - weight, TUNED_HZ * dt);
}

// ---- small geometry -------------------------------------------------------------------------------
export function clampf(v, lo, hi) {
  const atLeast = Math.max(lo, v);
  return atLeast > hi ? hi : atLeast;
}

// Signed shortest turn from angle `from` to angle `to`, in (-pi, pi].
export function angleDiff(from, to) {
  const turn = 2 * Math.PI;
  const d = (to - from) % turn;
  return d > Math.PI ? d - turn : d < -Math.PI ? d + turn : d;
}

// Hermite ease 3x^2 - 2x^3 on [0, 1], clamped outside.
export function smoothstep(t) {
  const u = clampf(t, 0, 1);
  return u * u * (3 - 2 * u); // 3u² − 2u³
}

export const hypot = (x, y) => Math.hypot(x, y);

// Remainder that keeps the sign of the dividend, as JavaScript's % does.
export const fmod = (a, b) => a % b;
