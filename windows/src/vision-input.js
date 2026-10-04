// Validate asynchronous retinal input at the worker boundary. A GPU read
// can finish after a new animal/network starts, before the page has even
// received that run's first snapshot. Its old image must not stimulate it.
export function visionForRun(input, run) {
  if (!input || !Number.isSafeInteger(input.neuralRun) || !Number.isSafeInteger(input.individual)
    || input.neuralRun !== run.neuralRun || input.individual !== run.individual
    || !Number.isFinite(input.L) || !Number.isFinite(input.R)) return null;
  return { L: Math.max(0, Math.min(1, input.L)), R: Math.max(0, Math.min(1, input.R)) };
}
