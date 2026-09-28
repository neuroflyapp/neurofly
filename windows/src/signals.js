// signals.js — from population rates to the body's command signals.
// One mapping, used by the live loop and by the tests alike.

import { clampf, lag } from './util.js';
import { makeSignals } from './sim.js';

// Rate-coded commands: signal = clamp(rate / full-scale rate, lo, hi).
// DNg12 and the proboscis motor neurons exist only with the sensory extension;
// without it their rates read 0. DNg12 spans ~5-35 Hz over the dust range
// (head grooming from ~10 Hz), the proboscis motor neurons 25-150 Hz on sugar.
const RATE_SIGNALS = [
  ['nervous', (sim) => sim.rateLoom, 80, 0, 1],
  ['walkDrive', (sim) => sim.rateFwd, 10, 0, 1.3],
  ['headGroomDrive', (sim) => sim.rateDNg12 ?? 0, 20, 0, 1.5],
  ['proboscis', (sim) => sim.rateProboscis ?? 0, 90, 0, 1],
  ['wingDrive', (sim) => sim.rateEscW, 10, 0, 1.3],
  // Arousal reads the central neurons, not the whole brain: real stepping
  // raises the ascending (afferent) input by itself and, through the
  // whole-brain rate, would open the takeoff gate far more often.
  ['arousal', (sim) => sim.rateCentral ?? sim.ratePop, 20, 0, 1],
];

export class SignalBuilder {
  constructor() { this.dnaBaseline = 0; }

  // A new fly is a new individual: her predecessor's adapted steering offset
  // must not carry over.
  reset() { this.dnaBaseline = 0; }

  make(sim, dt) {
    const out = makeSignals();
    // Steering: the left-right DNa difference minus its own slow average
    // (tau ~8 s). The wiring's fixed asymmetry is adapted away, so only
    // transient differences (vision, stimulation) turn her.
    const lr = sim.rateDNaL - sim.rateDNaR;
    this.dnaBaseline += (lr - this.dnaBaseline) * lag(1 / 8, dt);
    out.turnBias = clampf((lr - this.dnaBaseline) * 0.04, -1.0, 1.0);
    out.escape = sim.consumeGF();
    out.backward = sim.rateMDN > 8;
    out.groomDrive = sim.rateGroom / 8;
    for (const [name, rate, full, lo, hi] of RATE_SIGNALS) out[name] = clampf(rate(sim) / full, lo, hi);
    out.legCommands = sim.locomotor ? sim.locomotor.commands : null;
    return out;
  }
}
