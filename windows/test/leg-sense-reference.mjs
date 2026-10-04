// Independent reference for the pre-optimisation transduction expressions.
// Kept in tests only; output equality must hold, not merely tolerance.
import { LegDynamics } from '../src/legdynamics.js';
export function referenceSenseLegs() {
  for (const i of this.sensory) this.sensoryDrive[i] = 0;
  if (!this.feedbackEnabled || this.feedback.length !== 6) return;
  for (const i of this.sensory) {
    const f = this.feedback[this.sensoryLeg[i]];
    let level;
    switch (this.sensoryKindCode[i]) {
      case 0: level = f.contact ? Math.min(1, f.load * 6) : 0; break;
      case 1: level = Math.min(1, Math.abs(f.hipAngle) / LegDynamics.hipLimit + Math.abs(f.elevationVelocity) / 20); break;
      default: level = Math.min(1, Math.abs(f.kneeVelocity) / 20 + Math.abs(f.hipVelocity) / 16 + Math.abs(f.kneeAngle - LegDynamics.restKnee) * 0.35);
    }
    this.sensoryDrive[i] = level * 0.10;
  }
}
