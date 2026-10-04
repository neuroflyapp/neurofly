// run-models.mjs — runs the behavioural suites again on each single-specimen
// fly (NEUROCAUSE_FLY_MODEL=male, then female), so every fly model stays
// guarded by the same invariants. Model-specific counts: test/fly-models.js.
//   node test/run-models.mjs [male|female ...]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['male', 'female'];
const suites = ['simtest', 'behaviortest', 'locomotortest', 'thermotest', 'sensorytest', 'pathwaytest'];
const failed = [];
for (const model of models) {
  for (const suite of suites) {
    const run = spawnSync(process.execPath, [path.join(here, `${suite}.js`)], {
      env: { ...process.env, NEUROCAUSE_FLY_MODEL: model }, encoding: 'utf8', maxBuffer: 1 << 26 });
    const fails = (run.stdout || '').split('\n').filter((line) => /^FAIL|\bFAILURES\b/.test(line));
    const ok = run.status === 0;
    // A blocked child launch has no stdout/stderr and status null. Report it
    // distinctly from a model assertion failure instead of printing a blank
    // FAIL line that suggests all animals failed their scientific checks.
    const detail = fails.slice(0, 3).join(' | ') || (run.stderr || '').trim().slice(-300)
      || (run.error ? `${run.error.code || 'launch error'}: ${run.error.message || String(run.error)}`
        : run.signal ? `terminated by signal ${run.signal}` : `exit status ${run.status}`);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${model} fly: ${suite}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failed.push(`${model}/${suite}`);
  }
}
console.log(failed.length ? `${failed.length} FLY-MODEL SUITES FAIL: ${failed.join(', ')}` : `ALL FLY-MODEL SUITES PASS (${models.join(', ')})`);
process.exit(failed.length ? 1 : 0);
