// world.js — the terrarium the fly actually lives in: a leaf-litter floor,
// low hills, a pond with a sandy shore, a glass tank with a metal rim, a
// dense scatter (rocks, pebbles, mushrooms, logs, stumps, bushes, twigs,
// fallen branches, flowers, berries, ferns, leaves, grass, moss, puddles,
// a sapling, a pinecone, cattails, a shell) and two wandering fireflies,
// dimmer by day than by night on the real system clock (see
// World.fireflyActivity — honest crepuscular/nocturnal firefly behavior,
// not tied to the fly's own neurons). Extra ground cover in the landscape
// group is observer-only: it does not add collision or visual stimuli. The
// slim outer frame also sits on DISPLAY_LAYER so the fly's own eye never
// sees that furniture. Objects can be dragged; the fly can be
// grabbed and flicked away.
//
// There is no connectome pathway for "food" or "light attraction" in the
// real FlyWire circuit sim.js loads — it is an escape/steering circuit
// (LC4/LPLC2 -> DNp01 giant fiber, DNa01/02 steering, MDN backward walking).
// So encounters here stay purely reactive: proximity and a moving light feed
// the same loomL/loomR visual-looming inputs the cursor already drives (see
// computeLoom in app.js). Only contact estimated at the modelled antennae
// may drive the JO deflection population; body contact remains observer data.
// Nothing here invents a new neuron population —
// it only decides *when* the real circuit gets stimulated.

import * as THREE from '../node_modules/three/build/three.module.js';
import { clampf, fmod, random } from './util.js';
import { mat, SHADOWS_ENABLED, FLY_SCALE, ANTENNA_LOCAL } from './flymodel.js';

// All of the terrarium's randomness goes through R. Placement draws from
// util's random(): inside the simulation that is the loop's seeded stream
// (ClosedLoop's withRandom), so a session is reproducible from its seed; the
// renderer installs no stream and gets the platform RNG. Each object's own
// dressing — rotations, petal colours, clump offsets — comes from a
// per-object seed, so a second process (the renderer, while the simulation
// runs in a worker) can rebuild exactly the same-looking object from its
// layout record.
let R = () => random();
// Time constant (s) with which a firefly steers onto a new course (modelled).
const FIREFLY_TURN_S = 0.35;
// Looming from the world model (not the rendered eye), modelled: the angular
// expansion rate (rad/s) that counts as a full-strength looming stimulus, and
// the ceiling of the small peripheral cue a nearby, unmoving object gives.
// The cue stays well below the escape pathway's threshold (~0.14; experiment
// 'escape-threshold'): at its former 0.16 a fly standing beside a pebble was
// driven past threshold and took off with nothing moving.
const LOOM_FULL_EXPANSION = 6;
const STATIC_CUE_MAX = 0.06;
const staticCue = (near) => clampf((35 - near) / 35, 0, 1) ** 2 * STATIC_CUE_MAX;
const rnd = (lo, hi) => lo + R() * (hi - lo);
function seededRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const saved = R;
  R = seededRandom(seed);
  try { return fn(); } finally { R = saved; }
}

// Roughly half the ~30 px body length flymodel.js documents at FLY_SCALE —
// how close an object's edge has to get to the fly's centre to count as
// touching it.
export const FLY_TOUCH_RADIUS = 15;

// Real firefly bioluminescent signaling is a brief, distinct pulse every
// few seconds, not a continuous glow — see World.prototype.update.
const FLASH_DURATION = 0.35;

// Observer-only furniture (cabinet, outer frame). The fly's eye camera
// stays on layer 0; the user's camera enables this layer. Lights must
// enable it too or the cabinet would render unlit.
export const DISPLAY_LAYER = 2;
// The floor as the observer sees it (World.setDisplayLook); her eye keeps makeGround's tone.
const DISPLAY_GROUND_COLOR = new THREE.Color(0xd6c6a8);

function markDisplayOnly(root) {
  root.traverse((o) => {
    o.layers.set(DISPLAY_LAYER);
    // Shadow maps are shared between observer and eye passes. Decorative
    // furniture must not cast a shadow that the eye could read as a stimulus.
    if (o.isMesh) o.castShadow = false;
  });
  return root;
}

function disposeTree(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m);
      if (m.map) textures.add(m.map);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) t.dispose();
}

function displaceSphere(geo, squashZ, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = 1 + rnd(-amount, amount);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s * squashZ);
  }
  geo.computeVertexNormals();
  return geo;
}

function renderedTop(mesh, fallback) {
  mesh.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(mesh).max.z;
  return Number.isFinite(top) ? Math.max(0, top) : fallback;
}

// ---- ground, walls, landscape dressing ----

function makeGroundTexture() {
  if (typeof document === 'undefined') return null;   // headless test runs
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2c2116';
  ctx.fillRect(0, 0, size, size);
  // Broad soil and moss beds. Only fillRect / ellipse / arc: the layout-seed
  // regression mock in worldtest implements those canvas calls and no others.
  for (let i = 0; i < 420; i++) {
    const x = R() * size, y = R() * size;
    const r = 10 + R() * 28;
    const moss = R() < 0.42;
    ctx.fillStyle = moss
      ? `rgba(${38 + rnd(0, 28) | 0}, ${72 + rnd(0, 50) | 0}, ${24 + rnd(0, 22) | 0}, 0.38)`
      : `rgba(${52 + rnd(0, 36) | 0}, ${36 + rnd(0, 22) | 0}, ${18 + rnd(0, 14) | 0}, 0.55)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rnd(0.45, 0.85), rnd(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 900; i++) {
    const x = R() * size, y = R() * size;
    const r = 2 + R() * 8;
    const grassy = R() < 0.58;
    ctx.fillStyle = grassy
      ? `rgba(${60 + rnd(0, 40) | 0}, ${92 + rnd(0, 50) | 0}, ${30 + rnd(0, 25) | 0}, 0.48)`
      : `rgba(${46 + rnd(0, 30) | 0}, ${33 + rnd(0, 20) | 0}, ${18 + rnd(0, 15) | 0}, 0.58)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, rnd(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  // Damp hollows and pale sand fans.
  for (let i = 0; i < 70; i++) {
    const x = R() * size, y = R() * size;
    const r = 6 + R() * 16;
    const wet = R() < 0.55;
    ctx.fillStyle = wet
      ? `rgba(${28 + rnd(0, 14) | 0}, ${36 + rnd(0, 18) | 0}, ${22 + rnd(0, 12) | 0}, 0.32)`
      : `rgba(${140 + rnd(0, 40) | 0}, ${118 + rnd(0, 28) | 0}, ${72 + rnd(0, 22) | 0}, 0.22)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rnd(0.4, 0.75), rnd(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  // Leaf-litter flakes and grit at close camera range.
  for (let i = 0; i < 280; i++) {
    const x = R() * size, y = R() * size;
    ctx.fillStyle = `rgba(${90 + rnd(0, 70) | 0}, ${62 + rnd(0, 40) | 0}, ${28 + rnd(0, 22) | 0}, 0.4)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.4 + R() * 3.2, 0.6 + R() * 1.4, rnd(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 700; i++) {
    const x = R() * size, y = R() * size;
    const r = 0.5 + R() * 1.7;
    ctx.fillStyle = `rgba(${90 + rnd(0, 50) | 0}, ${80 + rnd(0, 45) | 0}, ${60 + rnd(0, 35) | 0}, 0.35)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeGround(bounds, landscapeSeed) {
  const w = bounds.width + 500, h = bounds.height + 500;
  // MeshPhong multiplies map RGB by material RGB. Using the same dark soil
  // tone for both crushed the floor nearly to black even in daylight.
  const material = mat(0xa89b84, 0.06, 0.05);
  // The ground can enter the fly's rendered eye. Rebuild exactly the same
  // pattern from the layout seed, independently of the simulation RNG and
  // of how often the renderer resizes the world.
  const tex = withSeed(landscapeSeed ^ 0x47a2d1c3, () => makeGroundTexture());
  if (tex) {
    tex.repeat.set(w / 180, h / 180);
    material.map = tex;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.z = -0.55;
  mesh.receiveShadow = SHADOWS_ENABLED;
  return mesh;
}

function makeWalls(bounds) {
  const group = new THREE.Group();
  const h = 52, th = 5;
  const wallMat = new THREE.MeshPhongMaterial({
    color: 0xb7e8dc, transparent: true, opacity: 0.11,
    specular: new THREE.Color(0.55, 0.62, 0.6), shininess: 90,
  });
  const rimMat = mat(0x1c2422, 0.28, 0.22);
  const hw = bounds.width / 2, hh = bounds.height / 2;
  const specs = [
    [bounds.width + th, th, 0, hh],
    [bounds.width + th, th, 0, -hh],
    [th, bounds.height + th, hw, 0],
    [th, bounds.height + th, -hw, 0],
  ];
  for (const [w, d, x, y] of specs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), wallMat);
    wall.position.set(x, y, h / 2 - 1);
    group.add(wall);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 4, d + 3, 3.2), rimMat);
    rail.position.set(x, y, h - 0.4);
    rail.castShadow = SHADOWS_ENABLED;
    group.add(rail);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 4, d + 3, 4.5), rimMat);
    base.position.set(x, y, 1.4);
    group.add(base);
  }
  const post = (x, y) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(7, 7, h + 6), rimMat);
    p.position.set(x, y, (h + 6) / 2 - 1);
    p.castShadow = SHADOWS_ENABLED;
    group.add(p);
  };
  post(hw, hh); post(hw, -hh); post(-hw, hh); post(-hw, -hh);
  return group;
}

// The observer's bench: oiled oak planks, drawn once on a canvas from a
// fixed local seed (never the simulation's stream: the cabinet is built in
// the worker too, where there is no document and no texture).
function makeBenchTexture() {
  if (typeof document === 'undefined') return null;
  const rand = seededRandom(0x0a4b3e11);
  const w = 1024, h = 512, planks = 6;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  for (let p = 0; p < planks; p++) {
    const y0 = (p * h) / planks, ph = h / planks;
    const tone = 0.82 + rand() * 0.3;
    ctx.fillStyle = `rgb(${(118 * tone) | 0}, ${(82 * tone) | 0}, ${(52 * tone) | 0})`;
    ctx.fillRect(0, y0, w, ph);
    // grain: long, slightly wavy darker and lighter fibres
    for (let i = 0; i < 70; i++) {
      const y = y0 + rand() * ph, amp = 1 + rand() * 3, freq = 0.004 + rand() * 0.01, phase = rand() * 6.3;
      const dark = rand() < 0.65;
      ctx.strokeStyle = dark ? `rgba(52, 32, 18, ${0.1 + rand() * 0.18})` : `rgba(196, 150, 104, ${0.06 + rand() * 0.1})`;
      ctx.lineWidth = 0.6 + rand() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) {
        const yy = y + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // a knot now and then
    if (rand() < 0.6) {
      const kx = rand() * w, ky = y0 + ph * (0.3 + rand() * 0.4), kr = 5 + rand() * 9;
      for (let k = 4; k >= 1; k--) {
        ctx.fillStyle = `rgba(${60 + k * 12}, ${36 + k * 8}, ${20 + k * 5}, 0.35)`;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * k * 0.55 * 2.2, kr * k * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the seam between planks
    ctx.fillStyle = 'rgba(28, 18, 10, 0.75)';
    ctx.fillRect(0, y0, w, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A soft dark halo around the tank, so it sits on the bench: a blurred dark
// rectangle the size of the tank's footprint, drawn once.
function makeContactShadowTexture() {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'blur(26px)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A flat frame in the ground plane: the outer rectangle minus the tank's
// footprint, with UVs in world units (ShapeGeometry uses x/y as UV).
function frameGeometry(outerW, outerD, innerW, innerD) {
  const outer = new THREE.Shape();
  outer.moveTo(-outerW / 2, -outerD / 2); outer.lineTo(outerW / 2, -outerD / 2);
  outer.lineTo(outerW / 2, outerD / 2); outer.lineTo(-outerW / 2, outerD / 2); outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-innerW / 2, -innerD / 2); hole.lineTo(-innerW / 2, innerD / 2);
  hole.lineTo(innerW / 2, innerD / 2); hole.lineTo(innerW / 2, -innerD / 2); hole.closePath();
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer);
}

// Observer-only furniture: the bench the tank stands on, its contact shadow,
// the dark frame and its green edge. Hides the ground outside the simulated
// tank from the observer; that ground stays visible to the fly's eye behind
// the glass (this group is on DISPLAY_LAYER).
const BENCH_MARGIN = 700;
const BENCH_GRAIN_UNITS = 420;
const BENCH_THICKNESS = 34;
function makeCabinet(bounds) {
  const group = new THREE.Group();
  const frame = mat(0x17211e, 0.18, 0.16);
  const edge = mat(0x176b37, 0.14, 0.22);
  const bench = mat(0x111a18, 0.04, 0.02);
  const benchSide = mat(0x2a1a10, 0.05, 0.04);
  const benchMap = makeBenchTexture();
  if (benchMap) {
    bench.color.setHex(0xa8968a);   // darkened so the habitat, not the bench, catches the eye
    bench.map = benchMap;
    benchMap.repeat.set(1 / BENCH_GRAIN_UNITS, 1 / BENCH_GRAIN_UNITS);
    bench.shininess = 18;
    bench.specular.setRGB(0.12, 0.1, 0.08);
  }
  const w = bounds.width, d = bounds.height, rim = 22;
  const outerW = w + 2 * BENCH_MARGIN, outerD = d + 2 * BENCH_MARGIN;
  const top = new THREE.Mesh(frameGeometry(outerW, outerD, w, d), bench);
  top.position.z = 0.7;
  top.receiveShadow = false;
  group.add(top);
  for (const side of [-1, 1]) {
    const front = new THREE.Mesh(new THREE.BoxGeometry(outerW, 4, BENCH_THICKNESS), benchSide);
    front.position.set(0, side * (outerD / 2 - 2), 0.7 - BENCH_THICKNESS / 2);
    const end = new THREE.Mesh(new THREE.BoxGeometry(4, outerD, BENCH_THICKNESS), benchSide);
    end.position.set(side * (outerW / 2 - 2), 0, 0.7 - BENCH_THICKNESS / 2);
    group.add(front, end);
  }
  const shadowMap = makeContactShadowTexture();
  if (shadowMap) {
    const halo = 300;
    // the texture's dark core (its middle 60 %) covers the footprint plus 20 units
    shadowMap.repeat.set(0.6 / (w + 40), 0.6 / (d + 40));
    shadowMap.offset.set(0.5, 0.5);
    const shadow = new THREE.Mesh(frameGeometry(w + 2 * halo, d + 2 * halo, w, d),
      new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, fog: false }));
    shadow.position.z = 0.9;
    shadow.renderOrder = 1;
    group.add(shadow);
  }
  for (const side of [-1, 1]) {
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(w + rim * 2, rim, 8), frame);
    horizontal.position.set(0, side * (d / 2 + rim / 2), -2.5);
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(rim, d, 8), frame);
    vertical.position.set(side * (w / 2 + rim / 2), 0, -2.5);
    const glint = new THREE.Mesh(new THREE.BoxGeometry(w + rim * 2, 1.2, 1.2), edge);
    glint.position.set(0, side * (d / 2 + 4), 1.9);
    group.add(horizontal, vertical, glint);
  }
  return markDisplayOnly(group);
}

// A shallow polar cap of a sphere makes a gentle hill; thetaLength controls
// how much of the dome shows, i.e. how tall the hill reads. rotation.x
// re-points the geometry's default +Y pole to world-up +Z (see the mushroom
// cap below — same trick, same sign).
function buildMound(radius, thetaLength, color) {
  const geo = new THREE.SphereGeometry(radius, 28, 12, 0, Math.PI * 2, 0, thetaLength);
  displaceSphere(geo, 1, 0.07);
  const mesh = new THREE.Mesh(geo, mat(color, 0.05, 0.04));
  mesh.rotation.x = Math.PI / 2;
  mesh.receiveShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildPond(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 36),
    new THREE.MeshPhongMaterial({
      color: 0x245864, specular: new THREE.Color(0.78, 0.86, 0.84), shininess: 120,
      transparent: true, opacity: 0.9,
    }));
  mesh.position.z = 0.05;
  return mesh;
}

function makeLandscape(bounds) {
  const group = new THREE.Group();
  const hw = bounds.width / 2, hh = bounds.height / 2;
  const hill1 = buildMound(rnd(128, 168), rnd(0.44, 0.56), 0x3a5624);
  hill1.position.set(-hw * 0.62, hh * 0.55, 0);
  const hill2 = buildMound(rnd(90, 122), rnd(0.36, 0.5), 0x48682c);
  hill2.position.set(hw * 0.66, -hh * 0.58, 0);
  const hill3 = buildMound(rnd(58, 82), rnd(0.32, 0.42), 0x314c22);
  hill3.position.set(-hw * 0.7, -hh * 0.62, 0);
  const hill4 = buildMound(rnd(42, 58), rnd(0.26, 0.36), 0x3d5c28);
  hill4.position.set(hw * 0.18, hh * 0.08, 0);
  const pondR = rnd(58, 82);
  const pondX = hw * 0.6, pondY = hh * 0.48;
  const shore = new THREE.Mesh(
    new THREE.CircleGeometry(pondR * 1.22, 32),
    mat(0xc4a56a, 0.08, 0.06));
  shore.position.set(pondX, pondY, 0.02);
  const pond = buildPond(pondR);
  pond.position.set(pondX, pondY, 0);
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(pondR * 0.55, 24),
    new THREE.MeshPhongMaterial({
      color: 0x1a3e48, specular: new THREE.Color(0.55, 0.6, 0.62), shininess: 110,
      transparent: true, opacity: 0.72,
    }));
  inner.position.set(pondX, pondY, 0.07);
  group.add(hill1, hill2, hill3, hill4, shore, pond, inner);
  // These details add visual scale for the observer, but have no contact or
  // sensory model. Keep them off the eye layer (including their shadows).
  const ornaments = new THREE.Group();
  group.add(ornaments);

  const pebbleMat = mat(0x8a8378, 0.18, 0.12);
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, Math.PI * 2);
    const d = pondR * rnd(0.92, 1.18);
    const r = rnd(3.5, 7);
    const geo = displaceSphere(new THREE.DodecahedronGeometry(r, 0), rnd(0.35, 0.55), 0.16);
    const p = new THREE.Mesh(geo, pebbleMat);
    p.position.set(pondX + Math.cos(a) * d, pondY + Math.sin(a) * d, r * 0.22);
    p.castShadow = SHADOWS_ENABLED;
    ornaments.add(p);
  }

  const reedMat = mat(0x4a6b2e, 0.05, 0.05);
  for (let i = 0; i < 9; i++) {
    const a = rnd(-0.4, 1.2);
    const d = pondR * rnd(0.85, 1.05);
    const h = rnd(22, 38);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, h, 5), reedMat);
    stem.rotation.x = Math.PI / 2;
    stem.position.set(pondX + Math.cos(a) * d, pondY + Math.sin(a) * d, h / 2);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 7, 6), mat(0x5a3a22, 0.08, 0.08));
    head.rotation.x = Math.PI / 2;
    head.position.set(stem.position.x, stem.position.y, h + 2);
    stem.castShadow = SHADOWS_ENABLED;
    ornaments.add(stem, head);
  }

  const bladeMat = mat(0x56823c, 0.04, 0.04);
  for (let i = 0; i < 90; i++) {
    const x = rnd(-hw * 0.88, hw * 0.88), y = rnd(-hh * 0.88, hh * 0.88);
    if (Math.hypot(x - pondX, y - pondY) < pondR * 0.95) continue;
    const h = rnd(7, 16);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(rnd(0.7, 1.4), h, 4), bladeMat);
    blade.position.set(x, y, h / 2);
    blade.rotation.x = Math.PI / 2 + rnd(-0.35, 0.35);
    blade.rotation.y = rnd(-0.3, 0.3);
    blade.castShadow = SHADOWS_ENABLED;
    ornaments.add(blade);
  }

  const litterMat = mat(0x5a7a34, 0.08, 0.06);
  for (let i = 0; i < 22; i++) {
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(rnd(6, 11), 7), litterMat);
    leaf.position.set(rnd(-hw * 0.8, hw * 0.8), rnd(-hh * 0.8, hh * 0.8), 0.28);
    leaf.rotation.z = rnd(0, Math.PI * 2);
    leaf.scale.y = rnd(0.45, 0.75);
    ornaments.add(leaf);
  }
  markDisplayOnly(ornaments);
  // Light playing on the pond, for the observer only: a moving pattern on
  // the eye layer would be a visual stimulus. Drawn from its own fixed seed
  // after the landscape's last seeded draw, so the layout is unchanged.
  const caustics = makeCausticTexture();
  if (caustics) {
    const shimmer = new THREE.Mesh(new THREE.CircleGeometry(pondR * 0.97, 36), new THREE.MeshBasicMaterial({
      map: caustics, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    shimmer.position.set(pondX, pondY, 0.12);
    caustics.repeat.set(1 / 70, 1 / 70);
    group.add(markDisplayOnly(shimmer));
    group.userData.shimmer = caustics;
  }
  return group;
}

// A loose net of pale rings, tiled: caustics on the pond's floor.
function makeCausticTexture() {
  if (typeof document === 'undefined') return null;
  const rand = seededRandom(0x7c0a5717);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = rand() * size, y = rand() * size, r = 8 + rand() * 22;
    const squash = 0.55 + rand() * 0.4, turn = rand() * Math.PI;
    ctx.strokeStyle = `rgba(214, 240, 255, ${0.25 + rand() * 0.4})`;
    ctx.lineWidth = 1 + rand() * 2.2;
    for (const dx of [-size, 0, size]) {   // drawn into the neighbouring tiles too: seamless
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, r, r * squash, turn, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- object kinds ----

function buildRock(radius) {
  const group = new THREE.Group();
  const color = [0x6b665f, 0x5c5850, 0x7a7368, 0x4e4a44][Math.floor(rnd(0, 4))];
  const main = new THREE.Mesh(
    displaceSphere(new THREE.IcosahedronGeometry(radius, 1), rnd(0.5, 0.78), 0.2),
    mat(color, 0.16, 0.11));
  main.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI));
  main.position.z = radius * 0.32;
  group.add(main);
  if (R() < 0.7) {
    const chip = new THREE.Mesh(
      displaceSphere(new THREE.TetrahedronGeometry(radius * rnd(0.28, 0.45), 0), 0.7, 0.12),
      mat(color, 0.16, 0.11));
    chip.position.set(radius * rnd(-0.35, 0.35), radius * rnd(-0.35, 0.35), radius * 0.18);
    group.add(chip);
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = SHADOWS_ENABLED; o.receiveShadow = SHADOWS_ENABLED; } });
  return group;
}

function buildPebble(radius) {
  const mesh = new THREE.Mesh(
    displaceSphere(new THREE.DodecahedronGeometry(radius, 0), rnd(0.45, 0.7), 0.14),
    mat([0x9a9488, 0xb0a898, 0x7e786e][Math.floor(rnd(0, 3))], 0.22, 0.16));
  mesh.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI));
  mesh.position.z = radius * 0.35;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildMushroom(radius) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.18, radius * 0.28, radius * 1.15, 12),
    mat(0xe8ddc0, 0.2, 0.15));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = radius * 0.55;
  const capColor = [0xb5432f, 0xc98a2c, 0x8a3a24, 0xd4c4a0][Math.floor(rnd(0, 4))];
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.05),
    mat(capColor, 0.28, 0.22));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = radius * 1.08;
  group.add(stem, cap);
  if (R() < 0.65) {
    const spotMat = mat(0xf2e6c8, 0.15, 0.12);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd(-0.2, 0.2);
      const spot = new THREE.Mesh(new THREE.SphereGeometry(radius * rnd(0.08, 0.14), 6, 5), spotMat);
      spot.position.set(Math.cos(a) * radius * 0.45, Math.sin(a) * radius * 0.45, radius * 1.28);
      group.add(spot);
    }
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildTwig(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius * 0.16, radius * 1.7, 3, 6),
    mat(0x5a4326, 0.1, 0.1));
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = radius * 0.16;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildLog(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius * 0.4, radius * 2.2, 4, 8),
    mat(0x4a3722, 0.08, 0.08));
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = radius * 0.4;
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildFlower(radius) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.045, radius * 0.07, radius * 1.75, 6),
    mat(0x3f6b2a, 0.05, 0.05));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = radius * 0.88;
  group.add(stem);
  const petalColor = [0xdd6b9c, 0xe0b23a, 0xd94f4f, 0xc9d6ff, 0xf2d0a0][Math.floor(rnd(0, 5))];
  const petalMat = mat(petalColor, 0.22, 0.16);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.34, 8, 6), petalMat);
    petal.position.set(Math.cos(a) * radius * 0.4, Math.sin(a) * radius * 0.4, radius * 1.68);
    petal.scale.set(1, 0.55, 0.32);
    petal.lookAt(0, 0, radius * 2.2);
    group.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.2, 8, 6), mat(0xe8c93a, 0.28, 0.22));
  center.position.z = radius * 1.7;
  group.add(center);
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildLeaf(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 10),
    mat([0x4c7a34, 0x6a8a38, 0x8a6a28][Math.floor(rnd(0, 3))], 0.1, 0.08));
  mesh.position.z = 0.32;
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.rotation.x = rnd(-0.15, 0.2);
  mesh.scale.y = rnd(0.5, 0.78);
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildGrassTuft(radius) {
  const group = new THREE.Group();
  const bladeMat = mat([0x5c8a3a, 0x4a7a32, 0x6b9440][Math.floor(rnd(0, 3))], 0.05, 0.05);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const h = radius * rnd(1.4, 2.3);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.09, h, 4), bladeMat);
    blade.position.set(rnd(-radius * 0.45, radius * 0.45), rnd(-radius * 0.45, radius * 0.45), h / 2);
    blade.rotation.x = Math.PI / 2 + rnd(-0.32, 0.32);
    blade.rotation.y = rnd(-0.28, 0.28);
    group.add(blade);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildBush(radius) {
  const group = new THREE.Group();
  const leafMat = mat(0x3d6a2a, 0.08, 0.06);
  const clumps = 7;
  for (let i = 0; i < clumps; i++) {
    const r = radius * rnd(0.4, 0.68);
    const clump = new THREE.Mesh(displaceSphere(new THREE.IcosahedronGeometry(r, 0), 1, 0.12), leafMat);
    const a = (i / clumps) * Math.PI * 2 + rnd(-0.3, 0.3);
    const d = i === 0 ? 0 : radius * rnd(0.32, 0.55);
    clump.position.set(Math.cos(a) * d, Math.sin(a) * d, r * 0.85 + rnd(0, 5));
    clump.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), rnd(0, Math.PI));
    group.add(clump);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildStump(radius) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.9, radius, radius * 0.82, 16),
    mat(0x6b4a2c, 0.12, 0.1));
  body.rotation.x = Math.PI / 2;
  body.position.z = radius * 0.41;
  group.add(body);
  const topZ = radius * 0.82 + 0.05;
  const ringMat = mat(0x8a6438, 0.15, 0.12);
  for (let i = 1; i <= 3; i++) {
    const r = radius * 0.9 * (i / 4);
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, r - 1.1), r, 22), ringMat);
    ring.position.z = topZ;
    group.add(ring);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildBerryCluster(radius) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.06, radius * 0.08, radius * 1.2, 6),
    mat(0x4a6b2a, 0.06, 0.05));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = radius * 0.6;
  group.add(stem);
  const berryColor = rnd(0, 1) < 0.5 ? 0x8a1f3a : 0x2a3a8a;
  const berryMat = mat(berryColor, 0.35, 0.3);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
    const d = radius * rnd(0.15, 0.4);
    const berry = new THREE.Mesh(new THREE.SphereGeometry(radius * rnd(0.14, 0.19), 8, 6), berryMat);
    berry.position.set(Math.cos(a) * d, Math.sin(a) * d, radius * (1.1 + rnd(0, 0.25)));
    group.add(berry);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildFern(radius) {
  const group = new THREE.Group();
  const frondMat = mat(0x3f7a3a, 0.08, 0.06);
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rnd(-0.12, 0.12);
    const len = radius * rnd(1.15, 1.7);
    const droop = rnd(0.18, 0.5);
    const inner = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.05, len * 0.55, 2, 5), frondMat);
    inner.position.set(0, 0, len * 0.275);
    inner.rotation.x = Math.PI / 2 - droop * 0.3;
    const outer = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.04, len * 0.5, 2, 5), frondMat);
    outer.position.set(0, len * 0.5 * Math.cos(droop * 0.3), len * (0.55 + 0.25 * Math.cos(droop)));
    outer.rotation.x = Math.PI / 2 - droop * 1.4;
    const frondGroup = new THREE.Group();
    frondGroup.add(inner, outer);
    frondGroup.rotation.z = a;
    group.add(frondGroup);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildMossPatch(radius) {
  const mesh = new THREE.Mesh(
    displaceSphere(new THREE.IcosahedronGeometry(radius, 1), 0.18, 0.1),
    mat(0x3f6b34, 0.06, 0.04));
  mesh.position.z = radius * 0.05;
  mesh.rotation.z = rnd(0, Math.PI * 2);
  return mesh;
}

function buildFallenBranch(radius) {
  const group = new THREE.Group();
  const woodMat = mat(0x5a4d3a, 0.1, 0.08);
  const a = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.14, radius * 1.1, 3, 6), woodMat);
  a.rotation.x = Math.PI / 2;
  a.rotation.z = rnd(-0.2, 0.2);
  a.position.z = radius * 0.14;
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.1, radius * 0.7, 3, 6), woodMat);
  b.rotation.x = Math.PI / 2;
  b.rotation.z = rnd(0.35, 0.6) * (rnd(0, 1) < 0.5 ? 1 : -1);
  b.position.set(radius * 0.55, radius * 0.35, radius * 0.11);
  group.add(a, b);
  group.rotation.z = rnd(0, Math.PI * 2);
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildPuddle(radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshPhongMaterial({
      color: 0x2c5c66, specular: new THREE.Color(0.7, 0.7, 0.7), shininess: 90,
      transparent: true, opacity: 0.8,
    }));
  mesh.position.z = 0.04;
  mesh.scale.y = rnd(0.7, 0.9);
  mesh.rotation.z = rnd(0, Math.PI * 2);
  return mesh;
}

function buildSapling(radius) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.1, radius * 0.16, radius * 2.1, 8),
    mat(0x5a3c22, 0.1, 0.08));
  trunk.rotation.x = Math.PI / 2;
  trunk.position.z = radius * 1.05;
  group.add(trunk);
  const leafMat = mat(0x2f6a28, 0.08, 0.06);
  for (let i = 0; i < 5; i++) {
    const canopy = new THREE.Mesh(displaceSphere(new THREE.IcosahedronGeometry(radius * rnd(0.4, 0.62), 0), 0.85, 0.1), leafMat);
    const a = (i / 5) * Math.PI * 2;
    canopy.position.set(Math.cos(a) * radius * 0.22, Math.sin(a) * radius * 0.22, radius * (1.7 + (i === 0 ? 0.45 : 0.15)));
    group.add(canopy);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildPinecone(radius) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 10, 8),
    mat(0x6b4a28, 0.12, 0.1));
  body.scale.set(0.72, 0.72, 1.15);
  body.position.z = radius * 0.7;
  group.add(body);
  const scaleMat = mat(0x8a6234, 0.1, 0.08);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const scale = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.18, radius * 0.32, 5), scaleMat);
    scale.position.set(Math.cos(a) * radius * 0.42, Math.sin(a) * radius * 0.42, radius * 0.55);
    scale.rotation.x = Math.PI / 2 + 0.6;
    scale.rotation.z = a;
    group.add(scale);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildCattail(radius) {
  const group = new THREE.Group();
  const h = radius * 2.4;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.06, radius * 0.08, h, 6), mat(0x4a6b2e, 0.05, 0.05));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = h / 2;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.16, radius * 0.18, radius * 0.7, 8), mat(0x5a3820, 0.1, 0.08));
  head.rotation.x = Math.PI / 2;
  head.position.z = h + radius * 0.1;
  group.add(stem, head);
  group.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS_ENABLED; });
  return group;
}

function buildShell(radius) {
  const mesh = new THREE.Mesh(
    displaceSphere(new THREE.SphereGeometry(radius, 12, 10), 0.45, 0.12),
    mat(0xd8c4a8, 0.35, 0.28));
  mesh.position.z = radius * 0.22;
  mesh.rotation.z = rnd(0, Math.PI * 2);
  mesh.castShadow = SHADOWS_ENABLED;
  return mesh;
}

function buildFirefly(radius) {
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8ff8a, transparent: true, opacity: 1 }));
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.85, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xc6ff6a, transparent: true, opacity: 0.18, depthWrite: false }));
  const light = new THREE.PointLight(0xd8ff8a, 0.8, 240, 2);
  group.add(glow, halo, light);
  group.position.z = 26;
  return { node: group, light, glow, halo };
}

// Rendering only: the parts of one object that share a material (petals,
// grass blades, fern fronds, berries, bush clumps) become a single mesh with
// the same triangles, so the object costs one draw call per material instead
// of one per part. The object still moves as a whole; its own transform stays
// on the root. Only opaque parts are merged: transparent ones are sorted per
// mesh when drawn, and merging them would change that order.
export function mergeByMaterial(root) {
  if (!root.isGroup) return root;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.material.transparent) return;
    // Layers are part of the scientific observer/eye boundary. Never merge
    // observer-only decoration back onto the default eye-visible layer.
    const key = `${o.material.id}:${o.layers.mask}`;
    if (!byMaterial.has(key)) byMaterial.set(key, []);
    byMaterial.get(key).push(o);
  });
  for (const meshes of byMaterial.values()) {
    if (meshes.length < 2) continue;
    const material = meshes[0].material;
    const parts = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
    });
    const names = Object.keys(parts[0].attributes);
    if (!parts.every((g) => Object.keys(g.attributes).join() === names.join())) continue;
    const merged = new THREE.BufferGeometry();
    for (const name of names) {
      const itemSize = parts[0].attributes[name].itemSize;
      const out = new Float32Array(parts.reduce((s, g) => s + g.attributes[name].array.length, 0));
      let at = 0;
      for (const g of parts) { out.set(g.attributes[name].array, at); at += g.attributes[name].array.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.layers.mask = meshes[0].layers.mask;
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    for (const m of meshes) { m.parent.remove(m); m.geometry.dispose(); }
    for (const g of parts) g.dispose();
    root.add(mesh);
  }
  // groups left without meshes (a fern's frond groups) are dropped
  const empty = [];
  root.traverse((o) => { if (o !== root && o.isGroup && !o.children.length) empty.push(o); });
  for (const g of empty) g.parent.remove(g);
  return root;
}

// solid: blocks movement and can startle on contact. draggable: any solid
// object can be picked up in app.js's pointer handlers (non-solid ones too,
// see app.js — solidity is a collision property, not a grabbability one).
// More varied than the original scatter for a richer terrarium, but solid
// obstacle density stays bounded so the fly can navigate without constant
// collision. A body bump is observer telemetry; only an estimated contact
// at the modelled antennae can enter the JO deflection pathway. Non-solid
// decoration stays dense and has softer contact telemetry (0.35x).
const OBSTACLE_SPECS = [
  { kind: 'rock', radius: () => rnd(16, 24), build: buildRock, solid: true },
  { kind: 'rock', radius: () => rnd(14, 20), build: buildRock, solid: true },
  { kind: 'rock', radius: () => rnd(18, 26), build: buildRock, solid: true },
  { kind: 'pebble', radius: () => rnd(8, 12), build: buildPebble, solid: true },
  { kind: 'pebble', radius: () => rnd(8, 12), build: buildPebble, solid: true },
  { kind: 'pebble', radius: () => rnd(7, 10), build: buildPebble, solid: true },
  { kind: 'pebble', radius: () => rnd(7, 10), build: buildPebble, solid: true },
  { kind: 'mushroom', radius: () => rnd(14, 19), build: buildMushroom, solid: true },
  { kind: 'mushroom', radius: () => rnd(12, 16), build: buildMushroom, solid: true },
  { kind: 'mushroom', radius: () => rnd(15, 20), build: buildMushroom, solid: true },
  { kind: 'log', radius: () => rnd(24, 32), build: buildLog, solid: true },
  { kind: 'stump', radius: () => rnd(20, 27), build: buildStump, solid: true },
  { kind: 'bush', radius: () => rnd(20, 28), build: buildBush, solid: true },
  { kind: 'bush', radius: () => rnd(16, 22), build: buildBush, solid: true },
  { kind: 'twig', radius: () => rnd(16, 20), build: buildTwig, solid: true },
  { kind: 'twig', radius: () => rnd(14, 18), build: buildTwig, solid: true },
  { kind: 'branch', radius: () => rnd(18, 26), build: buildFallenBranch, solid: true },
  { kind: 'branch', radius: () => rnd(14, 19), build: buildFallenBranch, solid: true },
  { kind: 'flower', radius: () => rnd(10, 14), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(10, 14), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(9, 12), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(9, 13), build: buildFlower, solid: false },
  { kind: 'flower', radius: () => rnd(8, 11), build: buildFlower, solid: false },
  { kind: 'berry', radius: () => rnd(9, 13), build: buildBerryCluster, solid: false },
  { kind: 'berry', radius: () => rnd(8, 12), build: buildBerryCluster, solid: false },
  { kind: 'berry', radius: () => rnd(9, 12), build: buildBerryCluster, solid: false },
  { kind: 'fern', radius: () => rnd(13, 18), build: buildFern, solid: false },
  { kind: 'fern', radius: () => rnd(11, 16), build: buildFern, solid: false },
  { kind: 'fern', radius: () => rnd(12, 17), build: buildFern, solid: false },
  { kind: 'fern', radius: () => rnd(10, 14), build: buildFern, solid: false },
  { kind: 'leaf', radius: () => rnd(10, 15), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(10, 15), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(9, 13), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(9, 13), build: buildLeaf, solid: false },
  { kind: 'leaf', radius: () => rnd(8, 12), build: buildLeaf, solid: false },
  { kind: 'grass', radius: () => rnd(11, 16), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(11, 16), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(11, 16), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(9, 14), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(9, 14), build: buildGrassTuft, solid: false },
  { kind: 'grass', radius: () => rnd(9, 14), build: buildGrassTuft, solid: false },
  { kind: 'moss', radius: () => rnd(14, 22), build: buildMossPatch, solid: false },
  { kind: 'moss', radius: () => rnd(12, 18), build: buildMossPatch, solid: false },
  { kind: 'moss', radius: () => rnd(10, 15), build: buildMossPatch, solid: false },
  { kind: 'puddle', radius: () => rnd(16, 24), build: buildPuddle, solid: false },
  { kind: 'puddle', radius: () => rnd(12, 18), build: buildPuddle, solid: false },
  { kind: 'sapling', radius: () => rnd(18, 26), build: buildSapling, solid: true },
  { kind: 'pinecone', radius: () => rnd(8, 12), build: buildPinecone, solid: true },
  { kind: 'cattail', radius: () => rnd(10, 14), build: buildCattail, solid: false },
  { kind: 'cattail', radius: () => rnd(9, 13), build: buildCattail, solid: false },
  { kind: 'shell', radius: () => rnd(7, 11), build: buildShell, solid: false },
];

// Relative scent strength per kind (0 = odourless). The extracted circuit
// has no olfactory receptor populations. Scent is therefore an environment
// measurement for the observer, never an input to the JO neurons or any
// other simulated neuron.
const SCENT_BY_KIND = {
  flower: 1.0, berry: 0.85, mushroom: 0.75, log: 0.45, stump: 0.4, bush: 0.3,
  branch: 0.2, fern: 0.15, grass: 0.15, leaf: 0.2, moss: 0.1, twig: 0.1,
  rock: 0, pebble: 0, puddle: 0.05, firefly: 0, sapling: 0.25, pinecone: 0.12,
  cattail: 0.08, shell: 0,
};

export class World {
  // options.layout: rebuild the objects of another World exactly (see
  //   layout()); options.empty: a bare arena with no objects, for controlled
  //   experiments; options.dressing: false skips ground, walls and landscape,
  //   which carry no behaviour (a simulation-only world).
  //   options.merge: draw each object with one mesh per material
  //   (mergeByMaterial; for the renderer's copy).
  constructor(bounds, { layout = null, empty = false, dressing = true, merge = false } = {}) {
    this.node = new THREE.Group();
    this.dressing = dressing;
    this.merge = merge;   // renderer copies merge each object's parts per material
    this.landscapeSeed = layout?.landscapeSeed ?? Math.floor(R() * 0x100000000);
    if (dressing) this._buildDressing(bounds);
    this.objects = [];
    this.rev = layout?.rev ?? 0;          // counts additions and removals (renderer copies follow it)
    this.t = layout?.t ?? 0;
    if (layout) this._placeFromLayout(layout.objects || []);
    else if (!empty) {
      this._placeObstacles(bounds);
      this._placeFirefly(bounds);
    }
  }

  _buildDressing(bounds) {
    this._ground = makeGround(bounds, this.landscapeSeed);
    this._walls = makeWalls(bounds);
    this._landscape = withSeed(this.landscapeSeed, () => makeLandscape(bounds));
    this._cabinet = makeCabinet(bounds);
    if (this.merge) {
      mergeByMaterial(this._landscape);
    }
    this.node.add(this._ground, this._walls, this._landscape, this._cabinet);
  }

  // Everything another process needs to rebuild these objects exactly.
  layout() {
    return {
      landscapeSeed: this.landscapeSeed,
      t: this.t,
      rev: this.rev,
      objects: this.objects.map((o) => ({
        kind: o.kind, spec: o.spec, radius: o.radius, x: o.pos.x, y: o.pos.y, seed: o.seed,
        scent: o.scent, solid: o.solid, flashPeriod: o.flashPeriod, flickerPhase: o.flickerPhase, tag: o.tag ?? null,
      })),
    };
  }

  _placeFromLayout(records) {
    for (const r of records) {
      if (r.kind === 'firefly') {
        const { node, light, glow, halo } = buildFirefly(r.radius);
        node.position.set(r.x, r.y, 26);
        this.node.add(node);
        this.objects.push({ kind: 'firefly', spec: -1, seed: r.seed, pos: { x: r.x, y: r.y }, radius: r.radius,
          solid: false, mesh: node, light, glow, halo, vx: 0, vy: 0, wanderT: 1, glowLevel: 0, dimLevel: 1, z: 26,
          flickerPhase: r.flickerPhase, flashPeriod: r.flashPeriod, scent: 0 });
        continue;
      }
      this._addBuilt(r);
    }
  }

  _addBuilt(r) {
    const spec = OBSTACLE_SPECS[r.spec];
    if (!spec) return null;
    const mesh = withSeed(r.seed, () => spec.build(r.radius));
    const topZ = renderedTop(mesh, r.radius * 1.1);
    if (this.merge) mergeByMaterial(mesh);
    mesh.position.x = r.x; mesh.position.y = r.y;
    this.node.add(mesh);
    const o = { kind: r.kind, spec: r.spec, seed: r.seed, pos: { x: r.x, y: r.y }, radius: r.radius,
      solid: spec.solid, mesh, topZ, scent: r.scent, tag: r.tag ?? null };
    this.objects.push(o);
    return o;
  }

  // Objects placed later (the Habitat game's garden): one of the world's own
  // kinds, built from its seed, so another copy builds the same object. The
  // tag identifies it for removal. Returns the object, or null.
  addObject({ kind, x, y, seed, radius, tag }) {
    const spec = OBSTACLE_SPECS.findIndex((s) => s.kind === kind);
    if (spec < 0) return null;
    const o = this._addBuilt({ kind, spec, seed: seed >>> 0, x, y, radius, tag,
      scent: SCENT_BY_KIND[kind] ?? 0 });
    if (o) { this.rev++; this.batchDirty = true; }
    return o;
  }

  removeObject(tag) {
    const k = this.objects.findIndex((o) => o.tag === tag);
    if (k < 0) return false;
    const [o] = this.objects.splice(k, 1);
    this.node.remove(o.mesh);
    disposeTree(o.mesh);
    this.rev++;
    this.batchDirty = true;
    return true;
  }

  // Renderer copy: rebuild every object from the simulation's layout after it
  // added or removed some (positions by index would otherwise mismatch).
  replaceObjects(layout) {
    for (const o of this.objects) { this.node.remove(o.mesh); disposeTree(o.mesh); }
    for (const part of this.batchedParts || []) part.visible = true;
    this.batchedParts = [];
    this.objects = [];
    this._placeFromLayout(layout.objects || []);
    this.rev = layout.rev ?? this.rev;
    this.batchDirty = true;
    this.syncBatch(true);
  }

  // The renderer's copy follows the simulation's: positions, firefly height,
  // flash and daylight dimming, packed as [x, y, z, glow, dim] per object.
  applyState(packed) {
    let moved = false;
    for (let k = 0; k < this.objects.length; k++) {
      const o = this.objects[k];
      const b = 5 * k;
      if (b + 4 >= packed.length) break;
      o.pos.x = packed[b]; o.pos.y = packed[b + 1];
      o.mesh.position.x = o.pos.x; o.mesh.position.y = o.pos.y;
      if (o.batchedAt && !o.loose && Math.abs(o.pos.x - o.batchedAt.x) + Math.abs(o.pos.y - o.batchedAt.y) > 0.01) { o.loose = true; moved = true; }
      if (o.kind === 'firefly') {
        o.z = packed[b + 2];
        o.mesh.position.z = o.z;
        o.glowLevel = packed[b + 3];
        o.dimLevel = packed[b + 4];
        this._paintFirefly(o);
      }
    }
    this.syncBatch(moved);
  }

  // Renderer copy only (merge): the opaque parts of every object that stands
  // still are merged per look (material type, colours, shading, shadows) across
  // objects, so the scenery costs a few draw calls in each of the shadow, view
  // and eye passes instead of one per part. The parts stay in their objects,
  // hidden; the same triangles are drawn. An object that moves (dragged) leaves
  // the batch and is drawn on its own again.
  _batchStatic() {
    if (this.batch) { this.node.remove(this.batch); this.batch.traverse((m) => m.geometry?.dispose()); }
    for (const part of this.batchedParts || []) part.visible = true;
    this.batch = new THREE.Group();
    this.batchedParts = [];
    this.node.updateMatrixWorld(true);
    const toNode = new THREE.Matrix4().copy(this.node.matrixWorld).invert();
    const looks = new Map();
    for (const o of this.objects) {
      if (o.kind === 'firefly' || o.loose) continue;
      o.batchedAt = { x: o.pos.x, y: o.pos.y };
      o.mesh.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        const t = m.material;
        if (Array.isArray(t) || t.transparent || t.map || t.vertexColors) return;
        const key = [t.type, t.color?.getHexString(), t.specular?.getHexString(), t.shininess, t.emissive?.getHexString(),
          t.emissiveIntensity, t.roughness, t.metalness, t.side, t.flatShading, t.fog, m.castShadow, m.receiveShadow].join('|');
        if (!looks.has(key)) looks.set(key, []);
        looks.get(key).push(m);
      });
    }
    for (const meshes of looks.values()) {
      const use = meshes.filter((m) => m.geometry.attributes.position && m.geometry.attributes.normal);
      if (use.length < 2) continue;
      const parts = use.map((m) => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toNode, m.matrixWorld));
      });
      const merged = new THREE.BufferGeometry();
      for (const name of ['position', 'normal']) {
        const out = new Float32Array(parts.reduce((n, g) => n + g.attributes[name].count * 3, 0));
        let at = 0;
        for (const g of parts) { out.set(g.attributes[name].array, at); at += g.attributes[name].count * 3; }
        merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, use[0].material);
      mesh.castShadow = use[0].castShadow;
      mesh.receiveShadow = use[0].receiveShadow;
      this.batch.add(mesh);
      for (const m of use) { m.visible = false; this.batchedParts.push(m); }
      for (const g of parts) g.dispose();
    }
    this.node.add(this.batch);
  }

  // After positions changed (first sync, a drag, a resize): rebuild the batch.
  syncBatch(moved) {
    if (!this.merge || !(moved || !this.batch || this.batchDirty)) return;
    this.batchDirty = false;
    this._batchStatic();
  }

  packState(out = new Float32Array(this.objects.length * 5)) {
    for (let k = 0; k < this.objects.length; k++) {
      const o = this.objects[k];
      out[5 * k] = o.pos.x; out[5 * k + 1] = o.pos.y;
      out[5 * k + 2] = o.kind === 'firefly' ? o.z : 0;
      out[5 * k + 3] = o.kind === 'firefly' ? o.glowLevel : 0;
      out[5 * k + 4] = o.kind === 'firefly' ? o.dimLevel : 1;
    }
    return out;
  }

  // The light and the glow sphere are two renderings of the same flash.
  _paintFirefly(o) {
    const dim = o.dimLevel ?? 1;
    if (o.light) o.light.intensity = (0.35 * dim) + o.glowLevel * 0.9;
    if (o.glow) o.glow.material.opacity = (0.3 * dim) + o.glowLevel * 0.7;
    if (o.halo) o.halo.material.opacity = (0.08 * dim) + o.glowLevel * 0.28;
  }

  // Rejection-samples a spot inside the window that keeps clear of the fly's
  // spawn point at the origin and of every object already placed. If 40
  // tries never find a fully clear spot (a busy terrarium), falls back to
  // whichever tried candidate had the least overlap rather than a fresh,
  // completely unchecked random point — for object placement that's a
  // cosmetic nicety, but the same function now also places a freshly
  // spawned fly (see app.js's addFly()), where landing inside an object
  // means real, immediate, maxed-out contact distress for no visible reason.
  _safeSpot(bounds, radius, margin = 55) {
    const hw = bounds.width / 2 - 90, hh = bounds.height / 2 - 90;
    let best = null, bestClearance = -Infinity;
    for (let k = 0; k < 80; k++) {
      const p = { x: rnd(-hw, hw), y: rnd(-hh, hh) };
      if (Math.hypot(p.x, p.y) < 90) continue;
      const clearance = this.objects.length
        ? Math.min(...this.objects.map((o) => Math.hypot(o.pos.x - p.x, o.pos.y - p.y) - o.radius - radius))
        : Infinity;
      if (clearance > margin) return p;
      if (clearance > bestClearance) { bestClearance = clearance; best = p; }
    }
    return best || { x: rnd(-hw, hw), y: rnd(-hh, hh) };
  }

  // Public: same rejection-sampling, for anything outside World that needs
  // to place something (a newly spawned fly, say) without risking it
  // landing inside a solid obstacle — see app.js's addFly().
  findClearSpot(bounds, radius, margin = 55) { return this._safeSpot(bounds, radius, margin); }

  _placeObstacles(bounds) {
    OBSTACLE_SPECS.forEach((spec, specIndex) => {
      const radius = spec.radius();
      const pos = this._safeSpot(bounds, radius);
      const seed = Math.floor(R() * 0x100000000);
      const mesh = withSeed(seed, () => spec.build(radius));
      const topZ = renderedTop(mesh, radius * 1.1);
      mesh.position.x = pos.x;
      mesh.position.y = pos.y;
      this.node.add(mesh);
      this.objects.push({
        kind: spec.kind, spec: specIndex, seed, pos, radius, topZ, solid: spec.solid, mesh,
        scent: (SCENT_BY_KIND[spec.kind] ?? 0) * rnd(0.8, 1.15),
      });
    });
  }

  // Real fireflies are crepuscular/nocturnal — two of them (was one) for a
  // livelier night scene, both genuinely dimming toward daylight hours
  // rather than glowing at a flat brightness around the clock.
  _placeFirefly(bounds) {
    for (let k = 0; k < 2; k++) {
      const radius = 9;
      const pos = this._safeSpot(bounds, radius, 40);
      const { node, light, glow, halo } = buildFirefly(radius);
      node.position.x = pos.x;
      node.position.y = pos.y;
      this.node.add(node);
      this.objects.push({
        kind: 'firefly', spec: -1, seed: 0, pos, radius, solid: false, mesh: node, light, glow, halo,
        vx: 0, vy: 0, wanderT: rnd(0.4, 1.6), flickerPhase: rnd(0, Math.PI * 2),
        flashPeriod: rnd(2.5, 5), glowLevel: 0, dimLevel: 1, z: 26, scent: 0,
      });
    }
  }

  resize(bounds) {
    if (this.merge) { for (const o of this.objects) o.loose = false; this.batchDirty = true; }
    if (this.dressing) {
      this.node.remove(this._ground, this._walls, this._landscape, this._cabinet);
      for (const part of [this._ground, this._walls, this._landscape, this._cabinet]) disposeTree(part);
      this._buildDressing(bounds);
    }
    const hw = bounds.width / 2 - 60, hh = bounds.height / 2 - 60;
    for (const o of this.objects) {
      o.pos.x = clampf(o.pos.x, -hw, hw);
      o.pos.y = clampf(o.pos.y, -hh, hh);
      o.mesh.position.x = o.pos.x;
      o.mesh.position.y = o.pos.y;
    }
  }

  // Real fireflies are most active at dusk/night, quiet in full daylight —
  // a simple, honest piecewise curve over the real clock (same style as
  // environment.js's circadianActivity), not tied to the fly's own neurons.
  static fireflyActivity(hour) {
    const pts = [[0, 1], [5, 1], [8, 0.12], [17, 0.12], [20, 1], [24, 1]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [h0, v0] = pts[i], [h1, v1] = pts[i + 1];
      if (hour >= h0 && hour <= h1) return v0 + (v1 - v0) * (hour - h0) / Math.max(0.001, h1 - h0);
    }
    return 1;
  }

  // The observer's look of the floor (renderer copy, display render only; a
  // colour uniform, so no shader changes): the soil is lifted for the person
  // watching and restored before the fly's eye renders.
  setDisplayLook(on) {
    const ground = this._ground?.material;
    if (!ground) return;
    ground.userData.eyeColor ??= ground.color.clone();
    ground.color.copy(on ? DISPLAY_GROUND_COLOR : ground.userData.eyeColor);
  }

  // Observer-only motion (renderer copy): the light on the pond drifts.
  animateDisplay(t) {
    const caustics = this._landscape?.userData.shimmer;
    if (caustics) caustics.offset.set(t * 0.011, Math.sin(t * 0.37) * 0.035);
  }

  update(dt, bounds, hour = null) {
    this.t += dt;
    const hw = bounds.width / 2 - 60, hh = bounds.height / 2 - 60;
    let clockHour = hour;
    if (clockHour === null) { const now = new Date(); clockHour = now.getHours() + now.getMinutes() / 60; }
    const activity = World.fireflyActivity(clockHour);
    for (const o of this.objects) {
      if (o.kind !== 'firefly') continue;
      o.wanderT -= dt;
      if (o.wanderT <= 0) {
        o.wanderT = rnd(1.2, 3.2);
        const speed = rnd(14, 34);
        const ang = rnd(0, Math.PI * 2);
        o.tvx = Math.cos(ang) * speed;
        o.tvy = Math.sin(ang) * speed;
      }
      // A flying insect turns and speeds up over a fraction of a second, not
      // within one step. The instant course change made a firefly's closing
      // speed, and with it the looming input of sense(), jump from nothing
      // to full strength in a single 8 ms step: the escapes right after
      // start at night (VALIDATION.md, 25 September 2026).
      const steer = 1 - Math.exp(-dt / FIREFLY_TURN_S);
      o.vx += ((o.tvx ?? o.vx) - o.vx) * steer;
      o.vy += ((o.tvy ?? o.vy) - o.vy) * steer;
      o.pos.x += o.vx * dt;
      o.pos.y += o.vy * dt;
      if (o.pos.x < -hw || o.pos.x > hw) { o.vx *= -1; o.tvx = -(o.tvx ?? 0); o.pos.x = clampf(o.pos.x, -hw, hw); }
      if (o.pos.y < -hh || o.pos.y > hh) { o.vy *= -1; o.tvy = -(o.tvy ?? 0); o.pos.y = clampf(o.pos.y, -hh, hh); }
      o.mesh.position.x = o.pos.x;
      o.mesh.position.y = o.pos.y;
      o.z = 26 + 5 * Math.sin(this.t * 1.7 + o.pos.x * 0.02);
      o.mesh.position.z = o.z;
      // Real fireflies (Photinus etc.) signal with a brief, distinct flash
      // every few seconds, not a continuous smooth twinkle. The old
      // always-on sin-wave "flicker" had a real side effect beyond looking
      // wrong: it drove this firefly's actual point light every single
      // frame, repainting the ground/grass around it, which the rendered-
      // vision looming pathway (real frame-to-frame luminance change, see
      // updateVision in app.js) read as a nonstop nearby visual event —
      // enough to keep the giant fiber pinned near its firing ceiling all
      // night, not just during a real flash. flashPeriod is fixed per
      // firefly (its own steady signaling rhythm), so most of the cycle now
      // holds a constant glow — no frame-to-frame delta, nothing for vision
      // to see — with one genuine brief bright pulse per cycle.
      const cyclePos = fmod(this.t + (o.flickerPhase || 0), o.flashPeriod || 3.5);
      const flash = cyclePos < FLASH_DURATION ? Math.sin((Math.PI * cyclePos) / FLASH_DURATION) : 0;
      const dim = 0.15 + 0.85 * activity;
      o.dimLevel = dim;
      o.glowLevel = flash * dim;
      this._paintFirefly(o);
    }
  }

  // World cues for the brain-carrying fly: static proximity is only a small
  // peripheral visual term; a fast-closing firefly contributes looming.
  // Body contact and scent are observer data, while estimated contact at
  // the antennae is a separate modelled JO input. Split visual drive by
  // bearing to the fly's heading, like the cursor looming channel.
  sense(fly) {
    let loomL = 0, loomR = 0, tap = 0, antennaTap = 0, scent = 0;
    const f = { x: Math.cos(fly.heading), y: Math.sin(fly.heading) };
    const scale = fly.node?.scale?.x ?? FLY_SCALE;
    const antennaForward = ANTENNA_LOCAL.forward * scale;
    const antennaSide = ANTENNA_LOCAL.side * scale;
    const antennaZ = (fly.node?.position?.z ?? 0) + ANTENNA_LOCAL.height * scale;
    // A real fly in the air isn't in contact with, or looming-close over,
    // objects sitting on the ground below it — a fly cruising at altitude
    // over a mushroom is not touching the mushroom. Use the modelled mesh's
    // geometry-derived top extent rather than a radius proxy: a sapling rises much higher
    // than a pebble with the same ground footprint. Scent is deliberately
    // exempt — real odor plumes rise and reach a flying insect for real.
    const flyZ = fly.node?.position?.z || 0;
    for (const o of this.objects) {
      const dx = o.pos.x - fly.pos.x, dy = o.pos.y - fly.pos.y;
      const dist2d = Math.max(1, Math.hypot(dx, dy));
      // A ground object is only "below" a fly flying over it; a firefly hovers
      // at its own height, so its real vertical separation counts both ways.
      const objTopZ = o.kind === 'firefly' ? 26 : (o.topZ ?? o.radius * 1.1);
      const dz = o.kind === 'firefly' ? Math.abs(flyZ - (o.z ?? objTopZ)) : Math.max(0, flyZ - objTopZ);
      const dist = Math.max(1, Math.hypot(dx, dy, dz));
      const crossZ = (f.x * dy - f.y * dx) / dist2d;
      const lw = clampf(0.5 + 0.5 * crossZ, 0.12, 1);
      const rw = clampf(0.5 - 0.5 * crossZ, 0.12, 1);

      let strength;
      if (o.kind === 'firefly') {
        // Approach is what LC4/LPLC2 respond to. A firefly merely hovering
        // near her head is seen by her rendered eye already; the former
        // proximity bonus (up to 0.35 on top of the approach term, 1.35 in
        // all) held the giant fiber near 250 Hz whenever she landed beside
        // one. Proximity now adds no more than a static object does.
        // What they measure is the expansion of a silhouette: an object of
        // radius r closing at v from distance d grows at dθ/dt = 2rv/(d²+r²).
        // The former term (closing speed over distance, whatever the size)
        // made a small firefly drifting towards her a full-strength threat,
        // and with the proximity bonus below threshold-crossing, so the live
        // fly took off every few seconds with nothing looming.
        const closing = -(dx * o.vx + dy * o.vy) / dist;
        const expansion = 2 * o.radius * Math.max(0, closing) / (dist * dist + o.radius * o.radius);
        strength = clampf(expansion / LOOM_FULL_EXPANSION, 0, 1);
        strength = clampf(strength + staticCue(dist - o.radius), 0, 1);
      } else {
        // Reality check, corrected: LC4/LPLC2 are tuned to an EXPANDING
        // silhouette (something actually approaching), not mere proximity —
        // a rock sitting still nearby is not a real visual threat to a fly,
        // however close it is. An earlier pass made static proximity alone
        // ramp up to a strong looming signal, which — combined with a dense,
        // ~50-object terrarium — meant the fly was reading a near-constant
        // "predator" signal just from standing near ordinary scenery. Real
        // near-contact can still be a strong physical event, but only an
        // antenna-localised deflection below reaches the available JO cells.
        // So a static object now only contributes a small, short-range
        // peripheral-vision cue here; actual approach (the rendered vision
        // system's real motion energy, the cursor, a closing firefly, fire)
        // remains the real driver of the escape pathway.
        strength = staticCue(dist - o.radius);
      }
      loomL = Math.max(loomL, strength * lw);
      loomR = Math.max(loomR, strength * rw);

      // Any object actually touching the fly's body is a real mechanosensory
      // event, not just the solid ones — a petal or a blade of grass resting
      // against her is a genuine, if gentle, contact stimulus. Solid objects
      // (which also physically block and push her, see collide()) still read
      // as the firmer bump; non-solid contact is real but deliberately soft.
      // Real (3D) distance, so this stays silent while the fly is airborne.
      const touchDist = o.radius + FLY_TOUCH_RADIUS;
      if (dist < touchDist) {
        const contactStrength = clampf(1 - dist / touchDist, 0, 1) * (o.solid ? 1 : 0.35);
        tap = Math.max(tap, contactStrength);
      }

      // Johnston's organ senses displacement of the antennal receiver, not
      // arbitrary body or leg contact. Contact geometry is a model estimate
      // using the same antenna anchors drawn in flymodel.js (Matsuo et al.,
      // 2014, doi:10.3389/fphys.2014.00179). The body-only `tap` above is
      // still available as observer telemetry, but does not excite JO.
      if (o.kind !== 'firefly') {
        const vertical = Math.max(0, antennaZ - objTopZ);
        const reach = o.radius + ANTENNA_LOCAL.length * scale / 2;
        for (const side of [-1, 1]) {
          const ax = fly.pos.x + f.x * antennaForward + f.y * side * antennaSide;
          const ay = fly.pos.y + f.y * antennaForward - f.x * side * antennaSide;
          const gap = Math.hypot(o.pos.x - ax, o.pos.y - ay, vertical);
          if (gap < reach) antennaTap = Math.max(antennaTap, clampf(1 - gap / reach, 0, 1));
        }
      }

      if (o.scent > 0) {
        const plumeRadius = o.radius + 140;
        scent += o.scent * clampf(1 - dist2d / plumeRadius, 0, 1);
      }
    }
    return { loomL, loomR, tap, antennaTap, scent: clampf(scent, 0, 1) };
  }

  // Soft collision: pushes the fly's centre back outside any solid object
  // it has walked into, so it visibly steps around rocks and logs instead
  // of clipping through them. Runs for every fly, not just the one wired to
  // the brain. Skipped once airborne clears an object's real height — a
  // flying fly shouldn't get shoved sideways by a rock it's cruising over.
  collide(fly) {
    const flyZ = fly.node?.position?.z || 0;
    for (const o of this.objects) {
      if (!o.solid) continue;
      if (flyZ > (o.topZ ?? o.radius * 1.1)) continue;
      const touchDist = o.radius + FLY_TOUCH_RADIUS;
      const dx = fly.pos.x - o.pos.x, dy = fly.pos.y - o.pos.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      if (dist >= touchDist) continue;
      const push = touchDist - dist;
      fly.pos.x += (dx / dist) * push;
      fly.pos.y += (dy / dist) * push;
    }
  }
}
