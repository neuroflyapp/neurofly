// legdynamics.js — a reduced mechanical model of the six legs.
//
// Modelling assumptions, not measured fly physics: each leg is a planar chain
// (femur, tibia, tarsus at a fixed ankle angle) swung about the body by a hip
// yaw joint, raised by an elevation joint and bent at the knee. Each joint is
// a driven, damped spring; the motor commands name real muscle actions, but
// the gains, damping, stiffness, joint ranges and the rigid, non-slipping
// ground are choices of this model.

// Clamp to [lo, hi]; anything that is not a finite number becomes `lo`.
const within = (value, lo, hi) => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : lo);

// One command per leg: six muscle actions in [0, 1].
export const makeLegMotorCommand = () => ({ protract: 0, retract: 0, lift: 0, depress: 0, flex: 0, extend: 0 });

// What a leg reports back: joint angles and rates (sensed by the leg's
// proprioceptors), ground contact, a load proxy, and the foot in body space.
export function makeLegFeedback() {
  return {
    hipAngle: 0, hipVelocity: 0, kneeAngle: 0.95, kneeVelocity: 0,
    contact: false, load: 0, footHeight: 0, elevationAngle: 0,
    elevationVelocity: 0, footX: 0, footY: 0,
  };
}

// The three joints as one driven, damped spring each:
//   acceleration = gain·(agonist − antagonist) − damping·velocity
//                  − (stiffness + coContraction·min(agonist, antagonist))·(angle − rest) − bias
// The hip rests at 0 and the knee at LegDynamics.restKnee; the elevation joint
// rests where the foot touches the ground and, on the ground, carries a
// constant downward bias (the body's weight on the leg). Hip gain: 600 per
// unit activity — the cord's coxa pools rarely exceed ~0.3 net activity, and
// at 300 a planted leg could not retract fast enough to carry the body.
const JOINTS = [
  { angle: 'hipAngle', velocity: 'hipVelocity', agonist: 'protract', antagonist: 'retract',
    gain: 600, damping: 26, stiffness: 18, coContraction: 12, rest: () => 0, groundBias: 0, range: 'hip' },
  { angle: 'elevationAngle', velocity: 'elevationVelocity', agonist: 'lift', antagonist: 'depress',
    gain: 800, damping: 45, stiffness: 800, coContraction: 120, rest: (leg) => leg.restElevation, groundBias: 80, range: 'elevation' },
  { angle: 'kneeAngle', velocity: 'kneeVelocity', agonist: 'flex', antagonist: 'extend',
    gain: 1140, damping: 36, stiffness: 240, coContraction: 80, rest: () => LegDynamics.restKnee, groundBias: 0, range: 'knee' },
];

export class LegDynamics {
  // Joint limits and fixed angles (rad).
  static hipLimit = 0.65;                 // hip swing, either way
  static kneeRange = [0.15, 1.8];
  static elevationRange = [-0.25, 1.35];
  static restKnee = 0.95;                 // knee angle at rest
  static ankleAngle = 0.35;               // tarsus against tibia, fixed

  static range(name) {
    if (name === 'hip') return [-LegDynamics.hipLimit, LegDynamics.hipLimit];
    return name === 'knee' ? LegDynamics.kneeRange : LegDynamics.elevationRange;
  }

  // The elevation at which a leg with this knee angle just touches the ground
  // (the chain's reach from the attachment point, tilted down to floor level).
  static groundElevation(geometry, knee) {
    const ankle = knee + LegDynamics.ankleAngle;
    const along = geometry.femur + geometry.tibia * Math.cos(knee) + geometry.tarsus * Math.cos(ankle);
    const across = geometry.tibia * Math.sin(knee) + geometry.tarsus * Math.sin(ankle);
    const drop = within(geometry.attachZ / Math.max(0.001, Math.hypot(along, across)), -1, 1);
    return Math.atan2(across, along) - Math.asin(drop);
  }

  constructor(geometry) {
    this.geometry = geometry;
    // At rest the foot just touches the ground, the knee at restKnee.
    const rest = LegDynamics.groundElevation(geometry, LegDynamics.restKnee);
    this.restElevation = rest;
    this.feedback = { ...makeLegFeedback(), elevationAngle: rest };
    this.updateFoot(true);
  }

  // Forward kinematics: foot position in body space, and ground contact.
  updateFoot(grounded) {
    const g = this.geometry, fb = this.feedback;
    const femurPitch = fb.elevationAngle;
    const tibiaPitch = femurPitch - fb.kneeAngle;
    const tarsusPitch = tibiaPitch - LegDynamics.ankleAngle;
    const reach = g.femur * Math.cos(femurPitch) + g.tibia * Math.cos(tibiaPitch) + g.tarsus * Math.cos(tarsusPitch);
    const heading = g.baseYaw + g.side * fb.hipAngle;
    fb.footX = g.attachX + Math.cos(heading) * reach;
    fb.footY = g.attachY + Math.sin(heading) * reach;
    fb.footHeight = g.attachZ + g.femur * Math.sin(femurPitch) + g.tibia * Math.sin(tibiaPitch) + g.tarsus * Math.sin(tarsusPitch);
    fb.contact = grounded && fb.footHeight <= 0.015;
    fb.load = fb.contact ? 1 : 0;
  }

  resetContact(grounded) { this.updateFoot(grounded); }

  // Take over the pose that was actually shown, so motor control continues
  // from it; the observed velocities are rescaled from wall time to the
  // motor clock and bounded.
  adoptPose(pose, grounded, velocityScale = 1) {
    if (!(Number.isFinite(pose.hipAngle) && Number.isFinite(pose.elevationAngle) && Number.isFinite(pose.kneeAngle))) return;
    const scale = Number.isFinite(velocityScale) && velocityScale > 0 ? velocityScale : 1;
    const rate = (v, bound) => (Number.isFinite(v * scale) ? within(v * scale, -bound, bound) : 0);
    const fb = this.feedback;
    fb.hipAngle = within(pose.hipAngle, -LegDynamics.hipLimit, LegDynamics.hipLimit);
    fb.elevationAngle = within(pose.elevationAngle, LegDynamics.elevationRange[0], LegDynamics.elevationRange[1]);
    fb.kneeAngle = within(pose.kneeAngle, LegDynamics.kneeRange[0], LegDynamics.kneeRange[1]);
    fb.hipVelocity = rate(pose.hipVelocity, 20);
    fb.elevationVelocity = rate(pose.elevationVelocity, 20);
    fb.kneeVelocity = rate(pose.kneeVelocity, 40);
    this.updateFoot(grounded);
    fb.load = 0;
  }

  // One semi-implicit Euler step of the three joints, then the ground: a foot
  // that would sink is lifted back to floor level, and how hard it had to be
  // lifted is the load proxy (it scales with gravity, like a real weight).
  step(command, dt, grounded, gravityScale = 1) {
    const fb = this.feedback;
    const before = { ...fb };
    for (const j of JOINTS) {
      const on = within(command[j.agonist], 0, 1), off = within(command[j.antagonist], 0, 1);
      const push = j.gain * (on - off) - j.damping * before[j.velocity]
        - (j.stiffness + j.coContraction * Math.min(on, off)) * (before[j.angle] - j.rest(this)) - (grounded ? j.groundBias : 0);
      fb[j.velocity] += push * dt;
      const [lo, hi] = LegDynamics.range(j.range);
      fb[j.angle] = within(before[j.angle] + fb[j.velocity] * dt, lo, hi);
    }
    this.updateFoot(grounded);
    const unconstrained = fb.elevationAngle;
    let pressed = 0;
    if (grounded && fb.footHeight < 0) {
      fb.elevationAngle = Math.max(fb.elevationAngle, LegDynamics.groundElevation(this.geometry, fb.kneeAngle));
      pressed = Math.max(0, fb.elevationAngle - unconstrained) / (dt * dt);
      this.updateFoot(grounded);
    }
    fb.load = fb.contact ? pressed * gravityScale : 0;
    for (const j of JOINTS) fb[j.velocity] = (fb[j.angle] - before[j.angle]) / dt;
  }
}

// The six legs together, stepped on a fixed 600 Hz clock, and what their
// planted feet do to the body: the load-weighted mean slip of the supporting
// feet is the body's translation, their weighted twist about the support
// centre its rotation.
export class SixLegDynamics {
  static fixedDT = 1 / 600; // s: the mechanics step at 600 Hz

  constructor(geometries) {
    this.legs = geometries.map((legGeometry) => new LegDynamics(legGeometry));
    this.accumulator = 0; // time received but not yet stepped (s)
  }

  // Per-leg feedback with the load expressed as each planted leg's share.
  get feedback() {
    let total = 0;
    for (const leg of this.legs) total += leg.feedback.contact ? leg.feedback.load : 0;
    return this.legs.map((leg) => {
      const fb = leg.feedback;
      return { ...fb, load: fb.contact && total > 0 ? fb.load / total : 0 };
    });
  }

  resetContact(grounded) { for (const leg of this.legs) leg.resetContact(grounded); }

  adoptPose(poses, grounded, velocityScale = 1) {
    if (poses.length !== this.legs.length) return;
    for (const p of poses) if (!(Number.isFinite(p.hipAngle) && Number.isFinite(p.elevationAngle) && Number.isFinite(p.kneeAngle))) return;
    for (let i = 0; i < this.legs.length; i++) this.legs[i].adoptPose(poses[i], grounded, velocityScale);
    this.accumulator = 0;
  }

  advance(commands, dt, grounded = true, gravityScale = 1) {
    const moved = { forward: 0, lateral: 0, yaw: 0 };
    if (commands.length !== this.legs.length || !Number.isFinite(dt) || dt <= 0) return moved;
    const h = SixLegDynamics.fixedDT;
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator + 1e-10 >= h) {
      this.accumulator -= h;
      const before = this.feedback;
      for (let i = 0; i < this.legs.length; i++) this.legs[i].step(commands[i], h, grounded, gravityScale);
      const after = this.feedback;
      if (!grounded) continue;
      const stance = supportingFeet(before, after);
      if (stance.length < 2) continue;
      const shift = bodyShift(stance, before, after, h);
      moved.lateral += shift.lateral * Math.cos(moved.yaw) - shift.forward * Math.sin(moved.yaw);
      moved.forward += shift.lateral * Math.sin(moved.yaw) + shift.forward * Math.cos(moved.yaw);
      moved.yaw += shift.yaw;
    }
    return moved;
  }
}

// Legs planted with load both before and after the step, with their weights
// (geometric mean of the two load shares).
function supportingFeet(before, after) {
  const stance = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i];
    if (a.contact && b.contact && a.load > 1e-8 && b.load > 1e-8) stance.push({ i, w: Math.sqrt(a.load * b.load) });
  }
  let total = 0;
  for (const s of stance) total += s.w;
  for (const s of stance) s.share = s.w / total;
  return stance;
}

// A body move that undoes the feet's slip: weighted centre and mean foot
// displacement, the rotation about that centre, then translation and
// rotation, each bounded per step.
function bodyShift(stance, before, after, h) {
  let cx = 0, cy = 0, meanDx = 0, meanDy = 0;
  for (const { i, share } of stance) {
    const now = after[i];
    cx += now.footX * share; cy += now.footY * share;
    meanDx += (now.footX - before[i].footX) * share;
    meanDy += (now.footY - before[i].footY) * share;
  }
  let torque = 0, spread = 0;
  for (const { i, share } of stance) {
    const now = after[i];
    const rx = now.footX - cx, ry = now.footY - cy;
    torque += share * (rx * (now.footY - before[i].footY - meanDy) - ry * (now.footX - before[i].footX - meanDx));
    spread += share * (rx * rx + ry * ry);
  }
  const yaw = within(-torque / Math.max(1, spread), -5 * h, 5 * h);
  return {
    yaw,
    lateral: within(-meanDx + yaw * cy, -150 * h, 150 * h),
    forward: within(-meanDy - yaw * cx, -150 * h, 150 * h),
  };
}
