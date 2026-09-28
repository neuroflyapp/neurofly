// Deterministic Math.random for the test suites: the network and the
// spontaneous behaviour are stochastic on purpose, and tests need repeatable
// draws. A 32-bit linear congruential generator (the Numerical Recipes
// constants), started from the FNV-1a hash of a label. The app itself keeps
// the platform generator.
const FNV_OFFSET = 2166136261, FNV_PRIME = 16777619;
const LCG_MUL = 1664525, LCG_ADD = 1013904223;

export function resetRandom(label = 'neurofly-tests') {
  let x = FNV_OFFSET;
  for (let i = 0; i < label.length; i++) x = Math.imul(x ^ label.charCodeAt(i), FNV_PRIME) >>> 0;
  Math.random = () => {
    x = (Math.imul(x, LCG_MUL) + LCG_ADD) >>> 0;
    return x / 4294967296;
  };
}
resetRandom();
