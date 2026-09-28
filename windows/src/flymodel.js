// flymodel.js — the fly's body and her behaviour. FlyWire has no body data:
// the connectome drives the behaviour, and the body is a procedural model.
// The body's own frame has +Y forward and +Z up, with the ground at z = 0.

// A relative path, so that Node (tests) and the renderer resolve the same
// module without an import map.
import * as THREE from '../node_modules/three/build/three.module.js';
import { rnd, random, clampf, angleDiff, smoothstep, lag, TUNED_HZ } from './util.js';
import { makeSignals } from './sim.js';
import { LegDynamics, SixLegDynamics } from './legdynamics.js';

export const SHADOWS_ENABLED = true;
export const FLY_SCALE = 1.15; // body units → scene units
// The model's antennal receiver location in body coordinates (+Y forward).
// World sensing uses the same geometry when estimating contact with it.
export const ANTENNA_LOCAL = Object.freeze({ side: 0.9, forward: 11.6, height: 6.3, length: 2.2 });
// Screen-edge distances for walking (px). The body is about 30 px tall at
// FLY_SCALE; the clamp keeps all of it on the desktop, not just its centre.
export const EDGE_MARGIN = 50;
export const EDGE_CLAMP = 45;
// Mouse distances for flies without a brain (the older rule-based behaviour).
export const SCARE_RADIUS = 110;
export const NERVOUS_RADIUS = 240;
// Walking drive (DNp09 rate / 10 Hz) at which walking can break off grooming,
// and how long it must be held. Unstimulated, DNp09 crosses 10 Hz only in
// flickers (live terrarium, 3 x 90 s: 59 times, median 0.025 s, never
// 0.25 s); activating it holds the rate at 140-230 Hz.
export const WALK_OVERRIDES_GROOMING = 1.0;
export const WALK_OVERRIDE_HOLD_S = 0.25;

// Random-walk amplitudes of the heading, rad/√s. A random walk's variance
// grows with dt (not dt²), so the jitter per update scales with √dt; these
// values give the spread that was tuned at TUNED_HZ, at any frame rate.
export const WANDER_JITTER = 1.6 / Math.sqrt(TUNED_HZ);   // wandering
export const LEDGE_JITTER = 0.2 / Math.sqrt(TUNED_HZ);    // along a window edge

// ---- measured walking kinematics ------------------------------------------------
// Walking flies hold their course and turn in brief body saccades, with slow
// drift in between: Geurten, Jähde, Rosner & Egelhaaf (2014, Front Behav
// Neurosci 8:365, doi 10.3389/fnbeh.2014.00365) counted 1,140 saccades and
// 3,348 slow turns in Canton-S filmed at 500 fps.
// Saccade amplitude (rad), its sign drawn separately: the range 5°–25°
// averages to the measured ~15°.
export const SACCADE_MIN = 0.09; // ≈ 5°
export const SACCADE_MAX = 0.44; // ≈ 25°
// Saccade duration (s): measured 40–120 ms, median 90 ms. A 15° turn over
// 90 ms peaks near 170°/s, below the 200°/s the same study uses to detect a
// saccade.
export const SACCADE_DUR = 0.09; // s
// Swing duration (s): the time a foot is in the air stays nearly the same at
// every walking speed; stance is what shortens as speed rises (Mendes, Bartos,
// Akay, Márka & Mann 2013, eLife 2:e00231, doi 10.7554/eLife.00231, Table 2).
export const SWING_DUR = 0.035; // s

// ---- the body --------------------------------------------------------------------

const sRGB = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const darker = (color, amount) => color.clone().multiplyScalar(1 - amount);
const lighter = (color, amount) => color.clone().lerp(new THREE.Color(1, 1, 1), amount);
// Scratch transforms are shared only within synchronous feedback sampling.
// They never escape into snapshots or another fly's stored state.
const feedbackToe = new THREE.Vector3();
const feedbackInverse = new THREE.Matrix4();
const RESTING_LEG_COMMANDS = Object.freeze(Array.from({ length: 6 }, () => Object.freeze({
  protract: 0, retract: 0, lift: 0, depress: 0, flex: 0, extend: 0,
})));

// The leg mechanics' clock relative to the body's: the thermal tempo, kept
// within 0.5–2 (1 when it is not a number).
const motorTempoOf = (tempo) => (Number.isFinite(tempo) ? clampf(tempo, 0.5, 2) : 1);
// How long a change of leg pose takes to blend in (s).
const LEG_BLEND_S = 0.18;

// A Phong material with a grey highlight of strength `specular`; `gloss`
// (0..1) sets the highlight's tightness (shininess 0..100).
export function mat(color, specular = 0.25, gloss = 0.25) {
  const highlight = new THREE.Color(specular, specular, specular);
  return new THREE.MeshPhongMaterial({ color, specular: highlight, shininess: gloss * 100 });
}

// Places a node: position, Euler rotation (XYZ) and scale, each optional.
function place(node, { at, turn, scale } = {}) {
  if (at) node.position.set(...at);
  if (turn) node.rotation.set(...turn);
  if (scale) node.scale.set(...scale);
  return node;
}

// The abdomen's banding, a 64 × 128 canvas: a tan ground and four dark
// bands, given as [distance from the bottom, height] in px — the widest one
// at the tip. Without a canvas (headless runs) there is no texture.
const ABDOMEN_BANDS = [[0, 26], [38, 10], [60, 10], [82, 9]];
export function abdomenTexture() {
  if (typeof document === 'undefined') return null;
  const width = 64, height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const paint = canvas.getContext('2d');
  paint.fillStyle = 'rgb(184, 140, 82)';
  paint.fillRect(0, 0, width, height);
  paint.fillStyle = 'rgb(56, 38, 23)';
  for (const [fromBottom, band] of ABDOMEN_BANDS) paint.fillRect(0, height - fromBottom - band, width, band);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// One leg as drawn: the hip node (swing about the body axis, then elevation),
// the knee and the ankle, with its geometry for the mechanics and the pose
// last applied.
export class Leg {
  constructor(root, knee, ankle, geometry, baseYaw, swingSign, phase, isFront) {
    Object.assign(this, { root, knee, ankle, geometry, baseYaw, swingSign, phase, isFront });
    this.angle = 0;        // hip swing (rad)
    this.lift = 0;         // elevation (rad)
    this.kneeAngle = 0.75; // (rad)
  }

  // Poses the joints — from the mechanics' feedback when it is given. Every
  // controller works in these same joint coordinates.
  apply(feedback = null) {
    if (feedback) {
      ({ hipAngle: this.angle, elevationAngle: this.lift, kneeAngle: this.kneeAngle } = feedback);
    }
    const swing = this.baseYaw + this.swingSign * this.angle;
    this.root.rotation.set(0, -this.lift, swing, 'ZYX');
    this.knee.rotation.set(0, this.kneeAngle, 0);
    this.ankle.rotation.set(0, LegDynamics.ankleAngle, 0);
  }
}

const LEG_COLOR = [0.33, 0.24, 0.14];
// Each segment is a capsule along +X from its joint: its radius, radial
// segments, and how much darker than the leg colour it is drawn.
const LEG_SEGMENTS = { femur: [0.48, 10, 0], tibia: [0.38, 10, 0], tarsus: [0.24, 8, 0.25] };

function legSegment(name, length) {
  const [radius, radial, shade] = LEG_SEGMENTS[name];
  const color = sRGB(...LEG_COLOR);
  const capsule = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - 2 * radius), 4, radial);
  const segment = new THREE.Mesh(capsule, mat(shade ? darker(color, shade) : color));
  return place(segment, { at: [length / 2, 0, 0], turn: [0, 0, -Math.PI / 2] });
}

// A leg attached at `attach` (body frame), pointing along `baseYaw` at rest;
// `side` is +1 on the right, −1 on the left.
function buildLeg(attach, baseYaw, side, phase, isFront, femur, tibia, tarsus) {
  const hip = place(new THREE.Object3D(), { at: attach });
  hip.add(legSegment('femur', femur));
  const knee = place(new THREE.Object3D(), { at: [femur, 0, 0], turn: [0, 0.75, -0.30 * side] });
  hip.add(knee);
  knee.add(legSegment('tibia', tibia));
  const ankle = place(new THREE.Object3D(), { at: [tibia, 0, 0], turn: [0, 0.35, -0.15 * side] });
  knee.add(ankle);
  ankle.add(legSegment('tarsus', tarsus));
  const [attachX, attachY, attachZ] = attach;
  const geometry = { attachX, attachY, attachZ, baseYaw, side, femur, tibia, tarsus };
  const leg = new Leg(hip, knee, ankle, geometry, baseYaw, side, phase, isFront);
  leg.apply();
  return leg;
}

// The six legs, front to hind and right before left (RF LF RM LM RH LH):
// side, attachment point, rest yaw away from straight ahead (mirrored on the
// left), the phase of the older gait, front leg or not, and the femur, tibia
// and tarsus lengths.
const HIP_HEIGHT = 4.5;
const LEGS = [
  [1, [3.1, 5.3], 0.95, 0.0, true, 4.2, 4.8, 3.2],
  [-1, [-3.1, 5.3], 0.95, 0.5, true, 4.2, 4.8, 3.2],
  [1, [3.7, 2.0], -0.10, 0.5, false, 4.8, 5.6, 3.8],
  [-1, [-3.7, 2.0], -0.10, 0.0, false, 4.8, 5.6, 3.8],
  [1, [3.3, -1.2], -0.95, 0.0, false, 5.8, 7.0, 4.6],
  [-1, [-3.3, -1.2], -0.95, 0.5, false, 5.8, 7.0, 4.6],
];

// A folded wing: a thin, translucent elliptical plate 5.2 wide and 16.5 long
// that reaches back from its base, centred on z.
function wingMesh() {
  const outline = new THREE.Shape();
  outline.absellipse(0, -8.25, 2.6, 8.25, 0, 2 * Math.PI, false, 0);
  const plate = new THREE.ExtrudeGeometry(outline, { depth: 0.12, bevelEnabled: false, curveSegments: 24 });
  plate.translate(0, 0, -0.06);
  return new THREE.Mesh(plate, new THREE.MeshPhongMaterial({
    color: sRGB(0.92, 0.92, 0.92), specular: new THREE.Color(0.9, 0.9, 0.9), shininess: 90,
    transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
  }));
}

// The blur of a beating wing, shown in flight instead of the folded wings.
function wingBlur(side) {
  const haze = new THREE.MeshBasicMaterial({
    color: sRGB(0.85, 0.85, 0.85), transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false,
  });
  const blur = place(new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12), haze),
    { at: [side * 8.4, -2.8, 10.65], turn: [0, 0, side * -0.45], scale: [5.5, 2.4, 0.3] });
  blur.visible = false;
  return blur;
}

export function buildFlyModel() {
  const root = place(new THREE.Object3D(), { scale: [FLY_SCALE, FLY_SCALE, FLY_SCALE] });
  const brown = sRGB(0.50, 0.38, 0.22);

  root.add(place(new THREE.Mesh(new THREE.SphereGeometry(4.6, 28, 20), mat(brown, 0.35, 0.4)),
    { at: [0, 2.5, 6.2], scale: [0.95, 1.15, 0.85] })); // thorax

  // The abdomen carries the banding texture; headless, a flat colour.
  const banding = abdomenTexture();
  const abdomenLook = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: new THREE.Color(0.3, 0.3, 0.3), shininess: 35 });
  if (banding) abdomenLook.map = banding;
  else abdomenLook.color = sRGB(0.60, 0.44, 0.24);
  const abdomen = place(new THREE.Mesh(new THREE.SphereGeometry(5.0, 28, 20), abdomenLook),
    { at: [0, -6.5, 5.6], scale: [0.9, 1.5, 0.75] });
  root.add(abdomen);

  root.add(place(new THREE.Mesh(new THREE.SphereGeometry(3.0, 24, 16), mat(lighter(brown, 0.15))),
    { at: [0, 9.0, 6.0], scale: [1.0, 0.85, 0.9] })); // head

  // Eyes and antennae, one geometry and material per pair.
  const eyeShape = new THREE.SphereGeometry(2.0, 22, 16);
  const eyeLook = mat(sRGB(0.62, 0.10, 0.07), 0.9, 0.9);
  for (const side of [-1, 1]) {
    root.add(place(new THREE.Mesh(eyeShape, eyeLook), { at: [side * 2.1, 9.7, 6.4], scale: [0.8, 1.0, 1.15] }));
  }
  const antennaShape = new THREE.CapsuleGeometry(0.16, ANTENNA_LOCAL.length - 2 * 0.16, 4, 8);
  const antennaLook = mat(sRGB(0.3, 0.22, 0.13));
  for (const side of [-1, 1]) {
    root.add(place(new THREE.Mesh(antennaShape, antennaLook), {
      at: [side * ANTENNA_LOCAL.side, ANTENNA_LOCAL.forward, ANTENNA_LOCAL.height], turn: [-1.15, 0, side * 0.35],
    }));
  }

  // The proboscis hangs from a pivot under the head, so the drive of the
  // proboscis motor neurons can swing it forward and down, and back.
  const proboscisPivot = place(new THREE.Object3D(), { at: [0, 10.1, 5.4] });
  const proboscis = place(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.22, 2.4, 16), mat(sRGB(0.35, 0.26, 0.16))),
    { at: [0, 0.3, -1.2], turn: [-0.5, 0, 0] });
  proboscis.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), mat(sRGB(0.42, 0.31, 0.19))),
    { at: [0, -1.05, 0], scale: [1.1, 0.7, 1.1] })); // labellum
  proboscisPivot.add(proboscis);
  root.add(proboscisPivot);

  const legs = LEGS.map(([side, [x, y], yawAway, phase, isFront, femur, tibia, tarsus]) => {
    const baseYaw = side > 0 ? yawAway : Math.PI - yawAway;
    const leg = buildLeg([x, y, HIP_HEIGHT], baseYaw, side, phase, isFront, femur, tibia, tarsus);
    root.add(leg.root);
    return leg;
  });

  const foldedWings = new THREE.Object3D();
  for (const side of [-1, 1]) {
    foldedWings.add(place(wingMesh(), { at: [side * 1.6, 0.5, side > 0 ? 10.4 : 10.25], turn: [0, 0, side * 0.13] }));
  }
  root.add(foldedWings);
  const blurWingL = wingBlur(-1), blurWingR = wingBlur(1);
  root.add(blurWingL, blurWingR);

  // Every mesh casts a shadow except the translucent wing blurs.
  if (SHADOWS_ENABLED) {
    root.traverse((node) => { node.castShadow = node.isMesh === true && node !== blurWingL && node !== blurWingR; });
  }

  return { root, legs, foldedWings, blurWingL, blurWingR, abdomen, proboscisPivot, wingFlightSpread: 1.1 };
}

// ---- behaviour -------------------------------------------------------------------

export class Fly {
  // A fly standing at `start` (scene units), walking in a random direction.
  // The order of the fields is part of the recorded state; the random draws
  // (heading, state timer, gait phase, clock) happen in this order.
  constructor(start) {
    this.model = buildFlyModel();
    // The legs' mechanics, and the drawn legs posed as they stand.
    this.legDynamics = new SixLegDynamics(this.model.legs.map((leg) => leg.geometry));
    const stance = this.legDynamics.feedback;
    this.model.legs.forEach((leg, i) => leg.apply(stance[i]));
    Object.assign(this, {
      // hand-over between the motor-driven legs and the drawn pose
      motorWalking: false, renderedLegState: null, renderedMotorControl: false,
      legBlendFrom: [], legBlendTime: 0,
      // turning towards a target, and the course along a window edge
      turnTarget: null, turnTargetTime: 0, turnVelocity: 0, ledgeHeading: null,
      wingFlightAmount: 0,
      sensedLegFeedback: [],
      // Gravity relative to normal, set from outside (the gravity slider): a
      // heavier body presses its feet harder into the ground, so the load the
      // cord's campaniform sensilla report (legFeedback) rises with it, not
      // only the flight altitude.
      gravityScale: 1,
    });

    Object.assign(this, {
      pos: { x: start.x, y: start.y },
      heading: rnd(0, 2 * Math.PI),
      speed: 30,
      state: 'walking',
      stateTimer: rnd(1.5, 4),
      gaitPhase: rnd(0, 1),
      time: rnd(0, 100),
      scareCooldown: 0, dartCooldown: 0, backwardTimer: 0,
      // a body saccade: the turn still to make (rad) and its rate
      saccade: 0, saccadeRate: 0,
      dartTimer: 0,
      stateAge: 0,
      walkCommandHeld: 0,   // s the walking drive has stayed >= WALK_OVERRIDES_GROOMING
      terrain: [],          // walkable window edges, set by the coordinator
      ledge: null,          // the window edge she walks on, if any
      // The displays as scene-space rectangles. The overlay spans the whole
      // virtual desktop, which with several monitors is not one rectangle;
      // these keep her out of the gaps between screens.
      screens: null,
    });

    Object.assign(this, {
      // the current flight: from, to, progress and duration
      flightFrom: { x: 0, y: 0 }, flightTo: { x: 0, y: 0 }, flightT: 0, flightDur: 1,
      flightEffort: 0.6,    // chosen at takeoff: 1 for an escape, from arousal otherwise
      effortCurrent: 0.6,   // in flight: that effort plus escape-DN activity and arousal
      alt: 0,               // altitude, 0 on the ground .. 1 highest
      pitch: 0,             // body pitch while climbing or descending
      flapPhase: 0,
      wingRaise: 0,         // wings raised on the ground under threat (escape DNs)
      brainLive: false, liveArousal: 0, liveWing: 0,
      // Grooming has two command routes (Guo, Zhang & Simpson 2022): DNg11
      // drives front-leg rubbing alone, DNg12 head sweeps alternating with
      // leg rubbing; groomMode says which one runs.
      groomMode: 'legs',
      // Proboscis extension 0..1 from the proboscis motor neurons; onFood is
      // set by the coordinator while she stands on a drop of food.
      proboscisExtension: 0,
      onFood: false,
    });

    this.syncNode();
  }

  get node() { return this.model.root; }
  // What the cord senses: the legs' feedback as last sampled, or the
  // mechanics' own before the first sample.
  get legFeedback() {
    const sensed = this.sensedLegFeedback;
    return sensed.length === this.model.legs.length ? sensed : this.legDynamics.feedback;
  }
  get gaitPhasePublic() { return this.gaitPhase; }
  // Signed ground speed; walking backwards counts as 22 units/s.
  get effectiveSpeed() { return this.backwardTimer > 0 ? -22 : this.speed; }
  // How hard she walks, 0..1 (60 units/s and faster is 1).
  get walkingIntensity() {
    if (this.state !== 'walking') return 0;
    return clampf(Math.abs(this.backwardTimer > 0 ? 22 : this.speed) / 60, 0, 1);
  }

  // Whether (x, y) lies on a display, `inset` inside its edges (always true
  // when the displays are unknown).
  onScreen(x, y, inset = 0) {
    if (!this.screens?.length) return true;
    return this.screens.some((s) => x > s.x0 + inset && x < s.x1 - inset && y > s.y0 + inset && y < s.y1 - inset);
  }

  // The centre of the display nearest to (x, y); the origin when unknown.
  nearestScreenCenter(x, y) {
    if (!this.screens?.length) return { x: 0, y: 0 };
    const centre = (s) => ({ x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 });
    let nearest = this.screens[0], nearestDistance = Infinity;
    for (const s of this.screens) {
      const c = centre(s);
      const distance = Math.hypot(c.x - x, c.y - y);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = s; }
    }
    return centre(nearest);
  }

  // Moves the drawn body to the fly's position, pitch and heading (the model
  // faces +Y; a heading of 0 faces +X).
  syncNode() {
    const { position, rotation } = this.node;
    position.set(this.pos.x, this.pos.y, position.z);
    rotation.set(this.pitch, 0, this.heading - Math.PI / 2);
  }

  // Takes off. The target is `forced` if given; a casual flight often heads
  // for a window edge (45%, when the edge is wide and far enough); otherwise
  // it is a random point on a display (see _randomFlightTarget). Effort: as
  // given, else 1 for an escape and 0.4–0.75 for a casual flight.
  startFlight(bounds, options = {}) {
    const { awayFrom = null, escape = false, effort = null, target: forced = null } = options;
    this.setState('flying');
    // Airborne, she leaves any window edge and pending turn behind.
    Object.assign(this, { ledge: null, ledgeHeading: null, turnTarget: null });
    this.flightEffort = clampf(effort ?? (escape ? 1.0 : rnd(0.4, 0.75)), 0.25, 1);
    this.effortCurrent = this.flightEffort;
    this.flightFrom = { x: this.pos.x, y: this.pos.y };
    const distanceTo = (p) => Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
    let target = null, settled = false;
    if (!escape && awayFrom === null && this.terrain.length && rnd(0, 1) < 0.45) {
      const edge = this.terrain[Math.floor(random() * this.terrain.length)];
      if (edge.x1 - edge.x0 > 90) {
        target = { x: rnd(edge.x0 + 25, edge.x1 - 25), y: edge.y };
        settled = distanceTo(target) > 180;
      }
    }
    if (forced) {
      target = { x: forced.x, y: forced.y };
      settled = true;
    }
    if (!settled) target = this._randomFlightTarget(bounds, escape, awayFrom);
    this.flightTo = target;
    const distance = distanceTo(target);
    this.flightDur = escape ? clampf(distance / 650, 0.45, 1.2) : clampf(distance / 420, 0.7, 2.0);
    this.flightT = 0;
    this.scareCooldown = escape ? 2 : 2.5; // no new scare right after takeoff
    // The wings keep beating visibly; the blur discs add the motion smear.
    for (const blur of [this.model.blurWingL, this.model.blurWingR]) blur.visible = true;
  }

  // Up to 16 random points inside the desktop's margins: prefer one on a
  // display, far enough away (350 units fleeing, 260 otherwise) and, when
  // fleeing, not on the threat's side. If rejection sampling runs out, use
  // an on-display point rather than landing in the gap between monitors.
  _randomFlightTarget(bounds, escape, awayFrom) {
    const halfWidth = bounds.width / 2 - EDGE_MARGIN, halfHeight = bounds.height / 2 - EDGE_MARGIN;
    const minDistance = escape ? 350 : 260;
    const distanceTo = (point) => Math.hypot(point.x - this.pos.x, point.y - this.pos.y);
    const away = (point) => !awayFrom || (point.x - this.pos.x) * (awayFrom.x - this.pos.x)
      + (point.y - this.pos.y) * (awayFrom.y - this.pos.y) <= 0;
    let best = null, bestRank = -Infinity;
    const consider = (point) => {
      const distance = distanceTo(point);
      const rank = (away(point) ? 1e6 : 0) + distance;
      if (rank > bestRank) { best = point; bestRank = rank; }
    };
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = { x: rnd(-halfWidth, halfWidth), y: rnd(-halfHeight, halfHeight) };
      if (!this.onScreen(candidate.x, candidate.y, EDGE_MARGIN)) continue;
      consider(candidate);
      if (distanceTo(candidate) > minDistance && away(candidate)) return candidate;
    }
    if (best) return best;

    // The random samples can all land in a multi-monitor gap. Search the
    // corners and centre of each valid display intersection without drawing
    // more random numbers: this preserves seeded replay of the normal path.
    const screens = this.screens?.length ? this.screens
      : [{ x0: -bounds.width / 2, x1: bounds.width / 2, y0: -bounds.height / 2, y1: bounds.height / 2 }];
    for (const inset of [EDGE_MARGIN, 0]) {
      for (const screen of screens) {
        const left = Math.max(-halfWidth, screen.x0 + inset) + 1;
        const right = Math.min(halfWidth, screen.x1 - inset) - 1;
        const bottom = Math.max(-halfHeight, screen.y0 + inset) + 1;
        const top = Math.min(halfHeight, screen.y1 - inset) - 1;
        if (left > right || bottom > top) continue;
        for (const x of [left, (left + right) / 2, right]) {
          for (const y of [bottom, (bottom + top) / 2, top]) {
            const point = { x, y };
            if (this.onScreen(x, y, inset)) consider(point);
          }
        }
      }
      if (best) return best;
    }
    // No display overlaps the given desktop bounds. Keep the target finite;
    // the caller's display geometry must be repaired to guarantee a landing.
    return { x: clampf(this.pos.x, -halfWidth, halfWidth), y: clampf(this.pos.y, -halfHeight, halfHeight) };
  }

  // Touchdown, at the end of the landing flare: a short idle, the body back
  // at ground scale and height. Wings and legs settle from their flight poses.
  land() {
    this.setState('idle');
    this.stateTimer = rnd(0.3, 0.8); // a short pause after touchdown
    Object.assign(this, { speed: 0, alt: 0, pitch: 0 });
    this.node.scale.setScalar(FLY_SCALE);
    this.node.position.z = 0;
  }

  // Queues a small spontaneous body saccade, left or right. Larger changes of
  // direction go through turnToward, so a fast reaction never rotates the
  // whole animal within one tick.
  startSaccade() {
    const direction = rnd(0, 1) < 0.5 ? -1 : 1;
    const turn = direction * rnd(SACCADE_MIN, SACCADE_MAX);
    this.saccade = turn;
    this.saccadeRate = turn / SACCADE_DUR;
  }

  // Spends the queued saccade at its rate; the last step ends exactly on it.
  stepSaccade(dt) {
    const left = this.saccade;
    if (left === 0) return;
    const step = this.saccadeRate * dt;
    const finishing = Math.abs(step) >= Math.abs(left);
    this.heading += finishing ? left : step;
    this.saccade = finishing ? 0 : left - step;
  }

  // Turns towards the heading `target` like a damped servo: a turn-rate
  // demand of 16 × the error, at most 8 rad/s, reached with at most
  // 60 rad/s² of angular acceleration. A step that would reach the target
  // ends exactly on it.
  turnToward(target, dt) {
    const error = angleDiff(this.heading, target);
    const demand = clampf(error * 16, -8, 8);
    const maxChange = 60 * dt;
    this.turnVelocity += clampf(demand - this.turnVelocity, -maxChange, maxChange);
    const step = this.turnVelocity * dt;
    const reaches = step * error >= 0 && Math.abs(step) >= Math.abs(error);
    if (reaches) {
      this.heading += error;
      this.turnVelocity = 0;
    } else {
      this.heading += step;
    }
  }

  // Hands the legs to the motor-driven mechanics, which start from the pose
  // now shown (its velocities converted to motor time at this tempo).
  prepareMotorControl(tempo) {
    if (this.motorWalking) return;
    this.legDynamics.adoptPose(this.legFeedback, true, 1 / tempo);
    this.motorWalking = true;
  }

  // The rule-based state cycle of a fly without a brain, run when her state
  // timer ends: a walk turns into a pause (30%), a dash with a saccade (25%)
  // or another walk; a pause into grooming (35%) or a walk with a saccade;
  // grooming into a pause. The state is set directly, so the dwell clock
  // (stateAge) keeps running.
  pickNextState() {
    const walkOn = () => {
      this.stateTimer = rnd(1.5, 5);
      this.speed = rnd(18, 45);
    };
    if (this.state === 'walking') {
      const draw = rnd(0, 1);
      if (draw < 0.30) {
        this.state = 'idle';
        this.stateTimer = rnd(0.8, 3);
        this.speed = 0;
      } else if (draw < 0.55) {
        this.stateTimer = rnd(0.3, 0.8);
        this.speed = rnd(95, 150);
        this.startSaccade();
      } else {
        walkOn();
      }
    } else if (this.state === 'idle') {
      if (rnd(0, 1) < 0.35) {
        this.state = 'grooming';
        this.stateTimer = rnd(1.0, 2.5);
      } else {
        this.state = 'walking';
        walkOn();
        this.startSaccade();
      }
    } else if (this.state === 'grooming') {
      this.state = 'idle';
      this.stateTimer = rnd(0.3, 1.0);
    }
  }

  // One body update (dt in s, on the simulation clock): timers and the
  // brain's live drives, then flight, brain-driven or rule-based behaviour,
  // who moves the legs, and the drawn body.
  update(dt, bounds, mouse, signals) {
    this.time += dt;
    // The proboscis follows its motor neurons with a short mechanical lag
    // (retracted in flight and without a brain).
    const proboscisGoal = signals && this.state !== 'flying' ? clampf(signals.proboscis ?? 0, 0, 1) : 0;
    this.proboscisExtension += (proboscisGoal - this.proboscisExtension) * lag(14, dt);
    const countDown = (seconds) => Math.max(0, seconds - dt);
    this.scareCooldown = countDown(this.scareCooldown);
    this.dartCooldown = countDown(this.dartCooldown);
    this.backwardTimer = countDown(this.backwardTimer);
    this.stateAge += dt;
    this.dartTimer = countDown(this.dartTimer);
    this.turnTargetTime = countDown(this.turnTargetTime);
    if (this.turnTargetTime === 0) this.turnTarget = null;

    // The brain's live drives reach the wings even in flight.
    Object.assign(this, {
      brainLive: !!signals, liveArousal: signals ? signals.arousal : 0, liveWing: signals ? signals.wingDrive : 0,
    });
    const walkCommand = signals?.walkDrive ?? 0;
    this.walkCommandHeld = walkCommand >= WALK_OVERRIDES_GROOMING ? this.walkCommandHeld + dt : 0;
    // Temperature runs the leg mechanics' clock faster or slower (0.5–2×).
    const motorTempo = motorTempoOf(signals?.tempo ?? 1);
    const motorDT = dt * motorTempo;
    const commands = signals?.legCommands;
    const cordDrivesLegs = commands?.length === this.model.legs.length;

    if (this.state === 'flying') {
      this.saccade = 0; // in the air the heading follows the course, not walking saccades
      this.updateFlight(dt);
    } else if (signals) {
      if (!commands) this.stepSaccade(dt);
      this.brainBehavior(signals, dt, bounds, mouse);
      if (this.state === 'walking' && cordDrivesLegs) {
        // The cord's motor commands move the legs; the body goes where the
        // planted feet push it.
        this.prepareMotorControl(motorTempo);
        this.saccade = 0;
        const motion = this.legDynamics.advance(commands, motorDT, true, this.gravityScale);
        this.speed = Math.abs(motion.forward) / Math.max(0.001, dt);
        this.updateWalk(dt, bounds, motion);
      } else if (this.state === 'walking') {
        this.motorWalking = false; // the drawn gait walks her
        this.updateWalk(dt, bounds, null);
      }
    } else {
      this._behaveWithoutBrain(dt, bounds, mouse);
    }

    // The cord keeps the legs while she walks or stands (resting commands
    // when idle, asleep or feeding); otherwise the drawn gait takes over and
    // the mechanics' ground contact is reset.
    const standing = this.state === 'idle' || this.state === 'sleeping' || this.state === 'feeding';
    if (!cordDrivesLegs || !(this.state === 'walking' || standing)) this.motorWalking = false;
    if (cordDrivesLegs && standing) {
      this.prepareMotorControl(motorTempo);
      this.legDynamics.advance(RESTING_LEG_COMMANDS, motorDT, true, this.gravityScale);
      this.motorWalking = true;
    } else if (!this.motorWalking) {
      this.legDynamics.resetContact(this.state !== 'flying');
    }
    this.updateLegs(dt);
    this.updateProboscis();
    this.sampleLegFeedback(dt);
    this.updateWings(dt);
    // Breathing, slower and deeper asleep.
    const breath = this.state === 'sleeping' ? 1 + 0.05 * Math.sin(this.time * 1.1) : 1 + 0.03 * Math.sin(this.time * 3.0);
    this.model.abdomen.scale.set(0.9, 1.5, 0.75 * breath);
    this.syncNode();
  }

  // A fly without a brain (the extra flies of the older behaviour): a mouse
  // closing in makes her fly off (within SCARE_RADIUS) or dash away (within
  // NERVOUS_RADIUS); otherwise she runs the rule-based state cycle, a walk
  // ending in a takeoff one time in ten.
  _behaveWithoutBrain(dt, bounds, mouse) {
    if (this.scareCooldown === 0 && mouse) {
      const distance = Math.hypot(mouse.x - this.pos.x, mouse.y - this.pos.y);
      if (distance < SCARE_RADIUS) {
        this.startFlight(bounds, { awayFrom: mouse });
      } else if (distance < NERVOUS_RADIUS && this.state !== 'walking') {
        this.setState('walking');
        this._faceAwayFrom(mouse);
        this.speed = rnd(110, 150);
        this.stateTimer = this.turnTargetTime = rnd(0.4, 0.9);
        this.scareCooldown = 1;
      }
    }
    if (this.state === 'flying') return;
    this.stepSaccade(dt);
    this.stateTimer -= dt;
    const timeUp = this.stateTimer <= 0;
    if (timeUp && this.state === 'walking' && rnd(0, 1) < 0.10) this.startFlight(bounds);
    else if (timeUp) this.pickNextState();
    if (this.state === 'walking') this.updateWalk(dt, bounds, null);
  }

  // Enters another state and restarts its dwell clock; only walking keeps a
  // turn target.
  setState(next) {
    if (next === this.state) return;
    this.state = next;
    this.stateAge = 0;
    if (next !== 'walking') this.turnTarget = null;
  }

  updateProboscis() {
    const e = this.proboscisExtension;
    const pivot = this.model.proboscisPivot;
    if (!pivot) return;
    // retracted: folded back under the head; extended: swung forward and down
    pivot.rotation.set(-0.35 + 1.25 * e, 0, 0);
    pivot.scale.set(1, 1 + 0.9 * e, 1);
  }

  // Behaviour from the brain's population signals. The thresholds, dwell
  // times, circadian sleep and body rules below are modelling choices; the
  // anatomy does not measure them. Checked in order: escape, sleep, a
  // nervous dart, feeding, grooming against walking, the walking command,
  // backward walking, walking speed and steering, spontaneous takeoff.
  brainBehavior(s, dt, bounds, mouse) {
    // A giant-fiber spike is an escape takeoff, even out of sleep.
    if (s.escape && this.scareCooldown === 0) return this.startFlight(bounds, { awayFrom: mouse, escape: true });
    // Circadian sleep holds everything else; she wakes into grooming.
    if (s.sleep) {
      if (this.state !== 'sleeping') this._settleInto('sleeping');
      return;
    }
    if (this.state === 'sleeping') {
      this.setState('grooming');
      return;
    }
    // Looming detectors active but the giant fiber quiet: a nervous dash,
    // away from the mouse when there is one.
    if (s.nervous > 0.40 && this.dartCooldown === 0) this._dart(mouse);
    // Feeding: the proboscis motor neurons have put the proboscis on food.
    // Staying put while it is there is a body rule of this model; the
    // extension, and when it ends, come from the motor neurons.
    const proboscisOut = (s.proboscis ?? 0) > 0.5;
    if (this.state === 'feeding') {
      const released = !this.onFood || (s.proboscis ?? 0) < 0.25;
      if (!released) {
        this.speed = 0;
        return;
      }
      this.setState('idle');
      this.stateTimer = rnd(0.3, 0.8);
    } else if (this.onFood && proboscisOut && this.stateAge > 0.3 && s.nervous < 0.3) {
      this._settleInto('feeding');
      return;
    }
    this._groomOrWalk(s);
    this._followWalkCommand(s.walkDrive);
    if (s.backward && this.backwardTimer === 0 && this.dartTimer === 0) this._walkBackwards();
    // Without the cord, speed follows the walking command (scaled by the
    // thermal tempo) and DNa01/DNa02 steer directly.
    if (this.state === 'walking' && !s.legCommands) {
      if (this.dartTimer === 0 && this.backwardTimer === 0) {
        const cruise = (14 + s.walkDrive * 55) * s.tempo;
        this.speed += (cruise - this.speed) * lag(3, dt);
      }
      if (!this.ledge) this.heading += s.turnBias * dt;
    }
    // Spontaneous takeoff, gated by central arousal, which also sets the
    // flight's effort. A body rule like the feeding hold: no casual takeoff
    // with the proboscis out (strong sugar drives the central taste relays
    // enough to open the gate). Giant-fiber escapes are unaffected.
    const takeoffRate = s.arousal > 0.5 ? 0.6 : 0.005;
    if (this.state === 'walking' && rnd(0, 1) < lag(takeoffRate, dt) && !proboscisOut) {
      this.startFlight(bounds, { effort: 0.35 + s.arousal * 0.6 });
    }
  }

  // A nervous dash: off the window edge, walking fast for 0.4–0.9 s, turned
  // away from the mouse (or by a saccade without one).
  _dart(mouse) {
    this.setState('walking');
    this.ledge = null;
    if (mouse) this._faceAwayFrom(mouse);
    else this.startSaccade();
    this.speed = rnd(110, 155);
    this.dartTimer = this.turnTargetTime = rnd(0.4, 0.9);
    this.dartCooldown = 1.2;
  }

  // DNp09, the walking command, with hysteresis: she starts above 0.22 (after
  // 0.4 s at rest) and stops below 0.08 (after 0.5 s of walking, never mid-dash).
  _followWalkCommand(drive) {
    const starts = this.state === 'idle' && drive > 0.22 && this.stateAge > 0.4;
    const stops = !starts && this.state === 'walking' && this.dartTimer === 0 && drive < 0.08 && this.stateAge > 0.5;
    if (starts) {
      this.setState('walking');
      this.startSaccade();
    } else if (stops) {
      this.setState('idle');
      this.speed = 0;
    }
  }

  // An MDN burst: half a second of walking backwards, from any grounded state.
  _walkBackwards() {
    this.backwardTimer = 0.5;
    if (this.state === 'walking') return;
    this.setState('walking');
    this.speed = 0;
  }

  // Turns her away from a point, with ±0.4 rad of scatter (no saccade).
  _faceAwayFrom(point) {
    this.saccade = 0;
    this.turnTarget = Math.atan2(this.pos.y - point.y, this.pos.x - point.x) + rnd(-0.4, 0.4);
  }

  // Enters a state she stands still in: no speed, no dash, no walking backwards.
  _settleInto(state) {
    this.setState(state);
    Object.assign(this, { speed: 0, dartTimer: 0, backwardTimer: 0 });
  }

  // Grooming against walking (not during a dash). DNg12 (head sweeps with
  // leg rubbing) takes precedence over DNg11 (leg rubbing alone). Walking and
  // grooming are exclusive motor programs under different descending
  // commands; when both are up the stronger wins (winner-take-all, a model
  // assumption) — but the walking command only counts once it has held
  // DNp09 at ≥ 10 Hz (five times its resting rate) for WALK_OVERRIDE_HOLD_S,
  // so a spontaneous flicker never breaks off a grooming bout while
  // sustained DNp09 activation does, as in real flies.
  _groomOrWalk(s) {
    if (this.state === 'walking' && this.dartTimer !== 0) return;
    const headDrive = s.headGroomDrive ?? 0;
    const walkWins = this.walkCommandHeld >= WALK_OVERRIDE_HOLD_S && s.walkDrive > Math.max(headDrive, s.groomDrive);
    const wantsHead = headDrive > 0.5, wantsLegs = s.groomDrive > 0.5;
    if (this.state === 'grooming') {
      if (walkWins && this.stateAge > 0.4) {
        this.setState('walking');
        this.startSaccade();
        return;
      }
      if (wantsHead) this.groomMode = 'head';
      else if (this.groomMode === 'head' && headDrive < 0.25) this.groomMode = 'legs';
      if (headDrive < 0.25 && s.groomDrive < 0.3 && this.stateAge > 0.6) this.setState('idle');
    } else if ((wantsHead || wantsLegs) && !walkWins && s.nervous < 0.3 && this.stateAge > 0.4) {
      this.setState('grooming');
      this.groomMode = wantsHead ? 'head' : 'legs';
    }
  }

  // Walking, on the floor or along a window edge. With `motorMotion` (the
  // cord drives the legs) the body moves as the feet pushed it; otherwise at
  // `effectiveSpeed` with a random-walk heading. A window that moved or
  // closed under her makes her take off.
  updateWalk(dt, bounds, motorMotion = null) {
    if (this.ledge) {
      const now = this.terrain.find((edge) => edge.id === this.ledge.id);
      const stillUnderfoot = now && Math.abs(now.y - this.ledge.y) < 40
        && this.pos.x >= now.x0 - 6 && this.pos.x <= now.x1 + 6;
      if (!stillUnderfoot) {
        this.ledge = null;
        this.startFlight(bounds);
        return;
      }
      this.ledge = now;
    }
    if (this.ledge) this._walkAlongEdge(dt, motorMotion);
    else this._walkOnFloor(dt, bounds, motorMotion);
    // The kinematic gait bobs the body; the mechanics keep it level.
    this.node.position.z = motorMotion ? 0 : 0.35 * Math.abs(Math.sin(this.gaitPhase * Math.PI * 2));
  }

  // Along a window edge: turn round at either end, hold the edge's height,
  // and now and then wander off it.
  _walkAlongEdge(dt, motorMotion) {
    const edge = this.ledge;
    if (!motorMotion) this.heading += rnd(-1, 1) * LEDGE_JITTER * Math.sqrt(dt);
    if (this.ledgeHeading === null) this.ledgeHeading = Math.cos(this.heading) >= 0 ? 0 : Math.PI;
    if (this.pos.x <= edge.x0 + 6) this.ledgeHeading = 0;
    if (this.pos.x >= edge.x1 - 6) this.ledgeHeading = Math.PI;
    this.turnToward(this.ledgeHeading, dt);
    this.pos.x += Math.cos(this.heading) * (motorMotion ? motorMotion.forward : this.effectiveSpeed * dt);
    this.pos.y += (edge.y - this.pos.y) * lag(10, dt);
    this.pos.x = clampf(this.pos.x, edge.x0, edge.x1);
    if (rnd(0, 1) < lag(0.05, dt)) this.ledge = null;
  }

  // On the floor: a pending turn, the heading's random walk (or the yaw the
  // feet produced), steering back from the margins and from the gaps
  // between monitors, the move itself (clamped to the desktop), and latching
  // onto a window edge she walks into.
  _walkOnFloor(dt, bounds, motorMotion) {
    this.ledgeHeading = null;
    const goal = this.turnTarget;
    if (goal !== null) {
      this.turnToward(goal, dt);
      if (Math.abs(angleDiff(this.heading, goal)) < 0.001) this.turnTarget = null; // arrived
    }
    // The feet's push is in the frame she had before their yaw.
    const pushHeading = this.heading;
    if (motorMotion) this.heading += motorMotion.yaw;
    else this.heading += rnd(-1, 1) * WANDER_JITTER * Math.sqrt(dt);
    const halfWidth = bounds.width / 2, halfHeight = bounds.height / 2;
    if (Math.abs(this.pos.x) > halfWidth - EDGE_MARGIN || Math.abs(this.pos.y) > halfHeight - EDGE_MARGIN) {
      this.heading += angleDiff(this.heading, Math.atan2(-this.pos.y, -this.pos.x)) * lag(4, dt);
    }
    const along = motorMotion ? motorMotion.forward : this.effectiveSpeed * dt;
    const across = motorMotion ? motorMotion.lateral : 0;
    const course = motorMotion ? pushHeading : this.heading;
    this.pos.x += Math.cos(course) * along + Math.sin(course) * across;
    this.pos.y += Math.sin(course) * along - Math.cos(course) * across;
    this.pos.x = clampf(this.pos.x, -halfWidth + EDGE_CLAMP, halfWidth - EDGE_CLAMP);
    this.pos.y = clampf(this.pos.y, -halfHeight + EDGE_CLAMP, halfHeight - EDGE_CLAMP);
    if (!this.onScreen(this.pos.x, this.pos.y)) {
      const centre = this.nearestScreenCenter(this.pos.x, this.pos.y);
      this.heading += angleDiff(this.heading, Math.atan2(centre.y - this.pos.y, centre.x - this.pos.x)) * lag(5, dt);
    }
    for (const edge of this.terrain) {
      const onEdge = this.pos.x > edge.x0 - 8 && this.pos.x < edge.x1 + 8 && Math.abs(this.pos.y - edge.y) < 20;
      if (onEdge && rnd(0, 1) < lag(0.9, dt)) {
        this.ledge = edge;
        this.ledgeHeading = Math.cos(this.heading) >= 0 ? 0 : Math.PI;
        break;
      }
    }
  }

  // Altitude shows as a larger body (1.8 times at the top) raised by up to
  // 90 units.
  applyAltitude() {
    this.node.scale.setScalar(FLY_SCALE * (1 + 0.8 * this.alt));
    this.node.position.z = this.alt * 90;
  }

  // One step of a flight: along the straight line from start to target,
  // eased in and out, with a sideways buzz that is largest mid-flight; the
  // heading servoed onto the course with a little yaw wobble; the altitude
  // rising to a cruise set by the live effort and falling again. When the
  // flight time is up she hovers over the target and sinks (the landing flare).
  updateFlight(dt) {
    this.flightT = Math.min(1, this.flightT + dt / this.flightDur);
    if (this.flightT === 1) {
      this._landingFlare(dt);
      return;
    }
    const eased = smoothstep(this.flightT);
    const { x: x0, y: y0 } = this.flightFrom;
    const dx = this.flightTo.x - x0, dy = this.flightTo.y - y0;
    const length = Math.max(1, Math.hypot(dx, dy));
    const buzz = Math.sin(this.time * 32) * 4 * Math.sin(this.flightT * Math.PI);
    this.pos.x = x0 + dx * eased + (-dy / length) * buzz;
    this.pos.y = y0 + dy * eased + (dx / length) * buzz;
    this.turnToward(Math.atan2(dy, dx) + Math.sin(this.time * 18) * 0.12, dt);
    // The effort stays live: ongoing escape-DN (DNp02/04/11) activity and
    // arousal make her beat harder and climb higher mid-flight — never below
    // the effort she took off with.
    let effort = this.flightEffort;
    if (this.brainLive) {
      const live = this.flightEffort * 0.55 + this.liveArousal * 0.25 + this.liveWing * 0.6;
      effort = clampf(Math.max(this.flightEffort, live), 0.25, 1.3);
    }
    this.effortCurrent = effort;
    const climb = Math.min(this.flightT / 0.25, 1);
    const descent = Math.min((1 - this.flightT) / 0.3, 1);
    const cruise = this.effortCurrent * Math.min(climb, descent) * (0.85 + 0.15 * Math.sin(this.time * 7));
    this.pitch += (clampf((cruise - this.alt) * 2.5, -0.45, 0.45) - this.pitch) * lag(12, dt);
    this.alt += (cruise - this.alt) * lag(6, dt);
    this.applyAltitude(); // higher looks bigger, and the shadow slides away
  }

  // The flight time is over: she hovers over the target, the hover wobble
  // fading as she sinks, and lands once she is down.
  _landingFlare(dt) {
    const hover = Math.min(1, this.alt / 0.2);
    this.pos.x = this.flightTo.x + Math.sin(this.time * 26) * 1.2 * hover;
    this.pos.y = this.flightTo.y + Math.cos(this.time * 22) * hover;
    const pitchGoal = clampf(this.alt * 0.4, 0, 0.35);
    this.pitch += (pitchGoal - this.pitch) * lag(12, dt);
    this.alt -= this.alt * lag(9, dt);
    this.applyAltitude();
    if (this.alt < 0.003) {
      this.pos = { x: this.flightTo.x, y: this.flightTo.y };
      this.land();
    }
  }

  // Poses the drawn legs. While the cord drives them they show the
  // mechanics' pose. Otherwise a kinematic gait whose step amplitude and
  // frequency grow with speed (the swing time stays fixed, so stance
  // shortens as she speeds up), reversed when walking backwards; the front
  // legs' grooming movements; legs tucked in flight. Every change of state
  // blends over 0.18 s from the pose last shown, and no grounded foot goes
  // below the floor.
  updateLegs(dt) {
    if (this.motorWalking) return this._showMechanicsPose();
    // A new state, or the end of motor control, blends from the pose shown
    // now (even halfway through an earlier blend).
    const restart = this.renderedLegState !== this.state || this.renderedMotorControl;
    if (restart) {
      this.legBlendFrom = this.model.legs.map((leg) => ({
        hipAngle: leg.angle, elevationAngle: leg.lift, kneeAngle: leg.kneeAngle }));
    }
    this.renderedLegState = this.state;
    this.renderedMotorControl = false;
    this.legBlendTime = Math.min(LEG_BLEND_S, (restart ? 0 : this.legBlendTime) + dt);
    const blend = smoothstep(this.legBlendTime / LEG_BLEND_S);
    const pace = Math.abs(this.effectiveSpeed);
    const stepping = this.state === 'walking' && pace > 1;
    const amplitude = clampf(0.20 + pace * 0.0022, 0.20, 0.50);
    const frequency = clampf(pace / Math.max(5, 2 * amplitude * 13), 3, 11);
    if (stepping) this.gaitPhase = (this.gaitPhase + frequency * dt) % 1;
    const stance = clampf(1 - SWING_DUR * frequency, 0.35, 0.9);
    const grounded = this.state !== 'flying';
    this.model.legs.forEach((leg, i) => {
      let [angle, lift, knee] = stepping ? this._stepPose(leg, amplitude, stance) : this._stillPose(leg);
      angle = clampf(angle, -LegDynamics.hipLimit, LegDynamics.hipLimit);
      lift = clampf(lift, ...LegDynamics.elevationRange);
      if (grounded) lift = Math.max(lift, LegDynamics.groundElevation(leg.geometry, knee));
      const start = this.legBlendFrom[i];
      const towards = (from, to) => from + (to - from) * blend;
      leg.angle = towards(start.hipAngle, angle);
      leg.kneeAngle = towards(start.kneeAngle, knee);
      leg.lift = towards(start.elevationAngle, lift);
      // Clearance from the blended knee, so a later hand-over to the motor
      // mechanics needs no correction of the toe shown.
      if (grounded) leg.lift = Math.max(leg.lift, LegDynamics.groundElevation(leg.geometry, leg.kneeAngle));
      leg.apply();
    });
  }

  // The legs as the motor mechanics hold them.
  _showMechanicsPose() {
    const pose = this.legDynamics.feedback;
    this.model.legs.forEach((leg, i) => leg.apply(pose[i]));
    this.renderedMotorControl = true;
    this.renderedLegState = this.state;
  }

  // [hip swing, elevation, knee] of a stepping leg at its point in the
  // cycle: stance sweeps it back evenly, swing lifts it and brings it
  // forward along a smooth curve.
  _stepPose(leg, amplitude, stance) {
    const cycle = (this.gaitPhase + leg.phase) % 1;
    let angle, lift = 0;
    if (cycle < stance) {
      angle = amplitude * (1 - 2 * cycle / stance);
    } else {
      const swing = (cycle - stance) / (1 - stance);
      angle = -amplitude + 2 * amplitude * smoothstep(swing);
      lift = Math.sin(swing * Math.PI) * 0.55;
    }
    return [this.backwardTimer > 0 ? -angle : angle, lift, 0.75];
  }

  // [hip swing, elevation, knee] when not stepping. Grooming moves the
  // front legs: head grooming alternates sweeps over the head (legs raised)
  // with leg rubbing, about 0.6 s each (Guo et al. 2022). In flight the legs
  // are tucked; standing, they rest.
  _stillPose(leg) {
    if (this.state === 'grooming') {
      if (!leg.isFront) return [0, 0, 0.75];
      const t = this.time, side = leg.swingSign;
      const sweeping = this.groomMode === 'head' && Math.sin(t * Math.PI / 0.6) > 0;
      if (sweeping) {
        return [0.62 + 0.03 * Math.sin(t * 18 + side * 0.8), 1.05 + 0.25 * Math.sin(t * 16 + side * 1.1),
          1.25 + 0.35 * Math.sin(t * 16 + side * 1.1)];
      }
      return [0.45 + 0.25 * Math.sin(t * 20 + side * 1.3), 0.55 + 0.15 * Math.sin(t * 22), 0.75];
    }
    if (this.state === 'flying') return [-0.35, 0.5, 0.75];
    return [0, 0, 0.95];
  }

  // What the legs' sense organs report, read off the drawn legs: joint
  // angles and their rates since the last sample, the toe in the body frame,
  // contact (not flying, toe at floor level) and load — from the mechanics
  // while they drive the legs, otherwise shared evenly by the planted feet.
  sampleLegFeedback(dt) {
    const before = this.legFeedback;
    const rate = (now, then) => (now - then) / Math.max(0.001, dt);
    // Refresh ancestors and this subtree once. localToWorld/worldToLocal per
    // foot otherwise walk the same ancestor chain twelve additional times.
    this.node.updateWorldMatrix(true, true);
    feedbackInverse.copy(this.node.matrixWorld).invert();
    const grounded = this.state !== 'flying';
    this.sensedLegFeedback = this.model.legs.map((leg, i) => {
      const toe = feedbackToe.set(leg.geometry.tarsus, 0, 0)
        .applyMatrix4(leg.ankle.matrixWorld).applyMatrix4(feedbackInverse);
      const hipAngle = leg.angle, kneeAngle = leg.knee.rotation.y, elevationAngle = leg.lift;
      const footHeight = toe.z + this.node.position.z;
      return {
        hipAngle, kneeAngle, elevationAngle,
        hipVelocity: rate(hipAngle, before[i].hipAngle),
        kneeVelocity: rate(kneeAngle, before[i].kneeAngle),
        elevationVelocity: rate(elevationAngle, before[i].elevationAngle),
        footX: toe.x, footY: toe.y, footHeight,
        contact: grounded && footHeight <= 0.015, load: 0,
      };
    });
    const planted = Math.max(1, this.sensedLegFeedback.filter((leg) => leg.contact).length);
    const mechanics = this.legDynamics.feedback;
    this.sensedLegFeedback.forEach((leg, i) => {
      if (leg.contact) leg.load = this.motorWalking ? mechanics[i].load : 1 / planted;
      else leg.load = 0;
    });
  }

  // Wing posture: folded on the ground (raised under threat, except asleep
  // or feeding), spread and beating in flight, with the blur discs for the
  // motion smear. The flight amount eases in and out, so the wings spread
  // before the first downstroke and flatten before they fold.
  updateWings(dt) {
    const flying = this.state === 'flying';
    const spreadGoal = flying ? 1 : 0;
    this.wingFlightAmount += (spreadGoal - this.wingFlightAmount) * lag(18, dt);
    if (!flying && this.wingFlightAmount < 0.0001) this.wingFlightAmount = 0; // folded: settle exactly
    const threatened = this.liveWing > 0.7 || (this.brainLive && this.dartTimer > 0);
    const raise = !flying && this.state !== 'sleeping' && this.state !== 'feeding' && threatened ? 1 : 0;
    this.wingRaise += (raise - this.wingRaise) * lag(8, dt);
    const beatHz = 22 + 10 * this.effortCurrent;
    if (flying || this.wingFlightAmount > 0) this.flapPhase += dt * beatHz;
    const stroke = Math.sin(this.flapPhase * 2 * Math.PI);
    const beat = smoothstep((this.wingFlightAmount - 0.8) / 0.2);
    const amount = this.wingFlightAmount;
    const restingSpread = 0.13 + 0.3 * this.wingRaise;
    const spread = restingSpread + (this.model.wingFlightSpread - restingSpread) * amount;
    const pitch = -0.5 * this.wingRaise * (1 - amount) + stroke * 0.35 * beat;
    const sweep = 0.175 * stroke * beat;
    this.model.foldedWings.children.forEach((wing, i) => {
      const side = i === 0 ? -1 : 1;
      wing.rotation.set(pitch, 0, side * (spread + sweep));
    });
    const flicker = (0.10 + 0.14 * Math.abs(stroke)) * amount;
    const { blurWingL, blurWingR } = this.model;
    for (const blur of [blurWingL, blurWingR]) {
      blur.material.opacity = flicker;
      blur.visible = amount !== 0;
    }
    blurWingL.rotation.set(0, 0, 0.45 + stroke * 0.2);
    blurWingR.rotation.set(0, 0, -0.45 - stroke * 0.2);
  }
}

export { makeSignals };
