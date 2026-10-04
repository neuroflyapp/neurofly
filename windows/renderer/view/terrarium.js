// terrarium.js — draws the fly's world, and renders what the fly herself sees.
//
// This module simulates nothing. The terrarium's objects, the fly's pose and
// every environmental state arrive in snapshots from the simulation thread
// and are only drawn here. Two things are produced here and sent back,
// because only a GPU can produce them: the motion energy of the fly's own
// rendered eye (her visual input), and the pointer's position on the ground.
//
// Observer/simulation boundary: view exposure, the camera and
// the spatial-map overlay are observer-side. The eye renders at a fixed
// exposure, and the overlay lives on a render layer the eye cannot see.

import * as THREE from '../../node_modules/three/build/three.module.js';
import { buildFlyModel, FLY_SCALE, SHADOWS_ENABLED } from '../../src/flymodel.js';
import { World, DISPLAY_LAYER } from '../../src/world.js';
import { applyPose, poseNodes } from '../../src/pose.js';
import { clampf } from '../../src/util.js';
import { circadianActivity } from '../../src/environment.js';
import { sceneLightLevel, autoExposureGain } from '../../src/display.js';
import { localMotionResidual } from '../../src/vision.js';

const VISION_W = 64, VISION_H = 24;
const VISION_EXPOSURE = 1;
// Her eye's sampling interval in simulated time (s), and the longest interval
// still read as motion; beyond it the eye re-primes (see frame()).
const EYE_SAMPLE_S = 0.05;
const EYE_GAP_S = 0.12;
// Eye readbacks in flight at once (see _renderEye).
const EYE_READS_IN_FLIGHT = 3;
const MAP_LAYER = 1;
const CAMERA_MODES = ['overview', 'follow', 'close', 'overhead'];
export function cameraModeLabel(mode) {
  if (mode === 'follow') return 'Follow cam';
  if (mode === 'close') return 'Close cam';
  if (mode === 'overhead') return 'Overhead';
  return 'Overview';
}
// Fit the actual tank corners rather than a fixed multiple of the pane size.
// The latter cropped the habitat badly on narrow panes and after rotation.
export function overviewDistance(bounds, fov, aspect, azimuth, elevation) {
  const v = Math.tan(fov * Math.PI / 360);
  const h = v * aspect;
  const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  let distance = 0;
  for (const x of [-bounds.width / 2 - 8, bounds.width / 2 + 8]) {
    for (const y of [-bounds.height / 2 - 8, bounds.height / 2 + 8]) {
      for (const z of [0, 58]) {
        const dz = z - 10;
        const toward = ce * sa * x - ce * ca * y + se * dz;
        const right = ca * x + sa * y;
        const up = -se * sa * x + se * ca * y + ce * dz;
        distance = Math.max(distance, toward + Math.abs(right) / h, toward + Math.abs(up) / v);
      }
    }
  }
  return Math.max(150, distance * 1.08);
}
// A conservative envelope for the rendered body and leg span, in scene
// units at its normal FLY_SCALE. Only the observer's camera uses this fit.
// The limiting field of view is horizontal on narrow panes and vertical on
// wide ones. A sphere fits at radius / sin(halfFov), not radius / tan(halfFov):
// its nearest surface is closer than its centre.
const FOLLOW_BODY_RADIUS = 26;
const FOLLOW_BODY_CENTER_Z = 7;
export function followFitDistance(fov, aspect, radius = FOLLOW_BODY_RADIUS) {
  const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, Math.max(0.05, aspect)));
  return radius / Math.sin(halfFov) * 1.08;
}
// Observer lighting (display render only; see _lookFor): share of the flat
// ambient fill kept, hemisphere and rim light relative to the scene's own
// ambient and key light, and the hemisphere's tints.
const DISPLAY_AMBIENT_SHARE = 0.45;
const DISPLAY_HEMI_GAIN = 1.0;
const DISPLAY_RIM_GAIN = 0.35;
const DISPLAY_SKY_TINT = new THREE.Color(0xdfeaff);
const DISPLAY_SOIL = new THREE.Color(0x5a4028);
// Follow/close camera (_unoccludedBoom): distance kept from the glass, the
// clearance around an object, the smallest height that can block the view,
// the shortest boom (share of the full one) and the lift over an obstacle.
const FOLLOW_WALL_MARGIN = 10;
const FOLLOW_CLEARANCE = 4;
const FOLLOW_MIN_OCCLUDER = 5;
const FOLLOW_MIN_BOOM = 0.25;
const FOLLOW_LIFT = 40;
// The arena in scene units for a pane of w x h CSS pixels. A phone's pane is
// small; there the arena keeps at least `minSide` units on its shorter side
// (same shape), so the habitat is not cramped. 0: the pane's own size, as on
// the desktop. The canvas always has the pane's size.
export function arenaBounds(w, h, minSide = 0) {
  const s = minSide > 0 ? Math.max(1, minSide / Math.max(1, Math.min(w, h))) : 1;
  return { width: Math.round(w * s), height: Math.round(h * s) };
}
// Haze in her eye (and the desktop view's default): from 700 to 3200 units.
const EYE_FOG_NEAR = 700, EYE_FOG_FAR = 3200;
const FLOOD_MAX_Z = 70;
const SCENT_RADIUS = 260;
const FLY_GRAB_RADIUS = 26;
const OBJECT_GRAB_MARGIN = 14;
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// Keyframes across a real 24 h clock: [hour, top, mid, bottom, fog, key colour,
// key intensity, ambient intensity], interpolated linearly.
const DAY_NIGHT_KEYFRAMES = [
  [0, '#03040a', '#080d1a', '#141d33', 0x080a12, 0x8fa8ff, 0.35, 0.30],
  [5, '#03040a', '#080d1a', '#141d33', 0x080a12, 0x8fa8ff, 0.35, 0.30],
  [7, '#2a2038', '#7a4a4a', '#e0925a', 0x3a2a28, 0xffb37a, 0.95, 0.55],
  [9, '#4a7bb5', '#bcd6ea', '#e8ecec', 0x8fa8bd, 0xfff3d8, 1.55, 0.85],
  [13, '#3f7fc9', '#bcdcf0', '#eef4f2', 0x9fb6c9, 0xffffff, 1.65, 0.85],
  [17, '#3f6fb0', '#bcd0e0', '#eef0ea', 0x8fa2b0, 0xfff0d0, 1.45, 0.78],
  [19, '#382050', '#8a4a5a', '#e0824a', 0x3a2530, 0xffa060, 0.85, 0.5],
  [21, '#0a0a20', '#141830', '#242c48', 0x0d0f1c, 0x9098ff, 0.45, 0.34],
  [24, '#03040a', '#080d1a', '#141d33', 0x080a12, 0x8fa8ff, 0.35, 0.30],
];
function dayNightAt(hour) {
  const pts = DAY_NIGHT_KEYFRAMES;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (hour >= a[0] && hour <= b[0]) {
      const t = (hour - a[0]) / Math.max(0.001, b[0] - a[0]);
      const lerp = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
      return { top: lerp(a[1], b[1]), mid: lerp(a[2], b[2]), bottom: lerp(a[3], b[3]), fog: lerp(a[4], b[4]),
        keyColor: lerp(a[5], b[5]), keyIntensity: a[6] + (b[6] - a[6]) * t, ambient: a[7] + (b[7] - a[7]) * t };
    }
  }
  const l = pts[pts.length - 1];
  return { top: new THREE.Color(l[1]), mid: new THREE.Color(l[2]), bottom: new THREE.Color(l[3]), fog: new THREE.Color(l[4]),
    keyColor: new THREE.Color(l[5]), keyIntensity: l[6], ambient: l[7] };
}
const DAY_REFERENCE_LIGHT = (() => {
  let peak = 0;
  for (let h = 0; h < 24; h += 0.25) {
    const sky = dayNightAt(h);
    const scale = 0.75 + 0.25 * circadianActivity(h);
    peak = Math.max(peak, sceneLightLevel(sky.ambient * scale, sky.keyIntensity * scale));
  }
  return peak;
})();

// A map value's colour: blue (low) -> amber -> red (high); alpha carries it.
export function mapColor(g, out, o) {
  out[o] = Math.round(40 + 215 * Math.min(1, g * 1.6));
  out[o + 1] = Math.round(90 + 120 * Math.max(0, 1 - Math.abs(g - 0.5) * 2));
  out[o + 2] = Math.round(200 * Math.max(0, 1 - g * 1.8));
  out[o + 3] = Math.round(60 + 150 * g);
}

export class TerrariumView {
  constructor(container, { layout, onPointer, onCommand, onVision, onTap, minArenaSide = 0 }) {
    this.container = container;
    this.onPointer = onPointer;
    this.onCommand = onCommand;
    this.onVision = onVision;
    this.onTap = onTap;
    this.minArenaSide = minArenaSide;
    this.pane = { width: Math.max(100, container.clientWidth), height: Math.max(100, container.clientHeight) };
    this.bounds = arenaBounds(this.pane.width, this.pane.height, minArenaSide);
    // A sheet covering the pane's bottom or right edge (setViewInset), eased.
    this.viewInset = { bottom: 0, right: 0 }; this.viewInsetShown = { bottom: 0, right: 0 };
    this.displayHidden = false;                     // the brain view covers the terrarium (phone layout)
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.snap = null;
    this.cameraMode = 'overview';
    this.orbit = { azimuth: 0.42, elevation: 0.68, zoom: 1, panX: 0, panY: 0 };
    this.orbitShown = { azimuth: 0.42, elevation: 0.68, zoom: 1, panX: 0, panY: 0 };
    this.viewBrightness = 1;
    this.autoNightLift = true;
    this.autoLiftGain = 1;
    this.displayExposure = 1;
    this.dayNightT = 999;
    this.visionReadPending = false;
    this.visionPreview = null;          // { rawCtx, motionCtx } when the panel shows it
    this.visionEnabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, this.bounds.width / this.bounds.height, 8, 6000);
    this.camera.up.set(0, 0, 1);
    this.camera.layers.enable(MAP_LAYER);
    this.camera.layers.enable(DISPLAY_LAYER);
    this.followLookAt = new THREE.Vector3();
    this.groundRay = new THREE.Raycaster();

    this._buildLights();
    this._buildRenderer();
    this.world = new World(this.bounds, { layout, merge: true });
    this.scene.add(this.world.node);
    this._buildWeather();
    this._buildMapOverlay();
    this._buildVision();
    this.flyViews = [];
    this.foodViews = new Map();
    this.placeCamera();
    this.fitShadowCamera();
    this.updateDayNight();
    this._bindPointer();
  }

  // ---- construction ----------------------------------------------------------
  _buildLights() {
    this.key = new THREE.DirectionalLight(0xffffff, 1.5);
    this.key.position.set(0.2955 * 900, 0.3276 * 900, 0.8974 * 900);
    this.key.target.position.set(0, 0, 0);
    this.scene.add(this.key.target);
    this.key.layers.enable(DISPLAY_LAYER);
    if (SHADOWS_ENABLED) {
      this.key.castShadow = true;
      // her own body is on the display layer only (applySnapshot) and still casts her shadow
      this.key.shadow.camera.layers.enable(DISPLAY_LAYER);
      this.key.shadow.mapSize.set(1024, 1024);
      this.key.shadow.radius = 2.6;
      this.key.shadow.bias = -0.0006;
    }
    this.scene.add(this.key);
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.82);
    this.ambientLight.layers.enable(DISPLAY_LAYER);
    this.scene.add(this.ambientLight);
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 8; skyCanvas.height = 256;
    this.skyCtx = skyCanvas.getContext('2d');
    this.skyTex = new THREE.CanvasTexture(skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16),
      new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false }));
    this.scene.add(this.skyMesh);
    this.scene.fog = new THREE.Fog(0x0b0d14, EYE_FOG_NEAR, EYE_FOG_FAR);
    // Observer lighting: a sky/soil hemisphere and a cool rim light model the
    // terrarium for the person watching. They light only the display render:
    // _lookFor('eye') sets them to zero before her eye renders (adding zero
    // light leaves every eye pixel unchanged), and the flat ambient fill they
    // replace is lowered for the display render only. They stay in the scene
    // for both passes because a different light count per pass would switch
    // every material's shader program twice a frame.
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a3520, 0);
    this.rim = new THREE.DirectionalLight(0xd6e8ff, 0);
    this.rim.position.set(-0.55 * 900, 0.62 * 900, 0.42 * 900);
    this.rim.target.position.set(0, 0, 0);
    this.scene.add(this.hemi, this.rim, this.rim.target);
    this.lightBase = { key: this.key.intensity, ambient: this.ambientLight.intensity };
    this.look = 'eye';
  }

  // The display look and her eye's look differ only in the observer lights
  // above; positions, shadows and every material are shared.
  _lookFor(pass) {
    if (this.look === pass || !this.hemi) return;   // no observer rig built: nothing to switch
    this.look = pass;
    const b = this.lightBase;
    if (pass === 'display') {
      this.ambientLight.intensity = b.ambient * DISPLAY_AMBIENT_SHARE;
      this.hemi.intensity = b.ambient * DISPLAY_HEMI_GAIN;
      this.rim.intensity = b.key * DISPLAY_RIM_GAIN;
    } else {
      this.ambientLight.intensity = b.ambient;
      this.hemi.intensity = 0;
      this.rim.intensity = 0;
      this.scene.fog.near = EYE_FOG_NEAR;
      this.scene.fog.far = EYE_FOG_FAR;
    }
    this.world?.setDisplayLook(pass === 'display');
  }

  // The observer's haze and sky follow the camera's distance, so a large
  // arena seen from far away (a phone held upright) is not lost in fog or
  // outside the sky dome. Her eye keeps EYE_FOG_*; the dome lies beyond her
  // eye's far plane wherever it is.
  _displayAtmosphere() {
    const d = this.camera.position.length();
    this.scene.fog.near = Math.max(EYE_FOG_NEAR, d * 0.9);
    this.scene.fog.far = Math.max(EYE_FOG_FAR, d * 2.6);
    this.skyMesh.position.copy(this.camera.position);
  }

  _buildRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(this.maxPixelRatio);
    r.setSize(this.pane.width, this.pane.height);
    r.setClearColor(0x0b0d14, 1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Linear exposure: a straight gain like a camera's ISO, identical to no
    // tone mapping at 1.0, so the displayed world is scaled, never re-graded.
    r.toneMapping = THREE.LinearToneMapping;
    r.toneMappingExposure = 1;
    if (SHADOWS_ENABLED) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      // refreshed once per displayed frame and reused by the eye pass
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
    }
    this.renderer = r;
    this.container.appendChild(r.domElement);
    r.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
  }

  _buildWeather() {
    const b = this.bounds;
    // rain
    this.RAIN_COUNT = 720;
    this.rainPos = new Float32Array(this.RAIN_COUNT * 3);
    this.rainVel = new Float32Array(this.RAIN_COUNT);
    for (let i = 0; i < this.RAIN_COUNT; i++) this._resetDrop(i);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainPoints = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 2.4, transparent: true, opacity: 0.62 }));
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
    // fire
    this.fireGroup = new THREE.Group();
    const emberGeo = new THREE.SphereGeometry(2.6, 6, 5);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(emberGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(rnd(0.02, 0.08), 1, rnd(0.5, 0.7)) }));
      m.userData = { baseZ: rnd(2, 30), speed: rnd(30, 70), wobble: rnd(0, Math.PI * 2) };
      m.position.set(rnd(-10, 10), rnd(-10, 10), m.userData.baseZ);
      this.fireGroup.add(m);
    }
    this.fireGlow = new THREE.PointLight(0xff7a1a, 0, 320, 2);
    this.fireGlow.position.z = 20;
    this.fireGroup.add(this.fireGlow);
    this.fireGroup.visible = false;
    this.scene.add(this.fireGroup);
    // drifting particles
    const drift = (count, color, size, opacity) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[3 * i] = rnd(-b.width / 2, b.width / 2); pos[3 * i + 1] = rnd(-b.height / 2, b.height / 2); pos[3 * i + 2] = rnd(4, 140);
        vel[3 * i] = rnd(-6, 6); vel[3 * i + 1] = rnd(-6, 6); vel[3 * i + 2] = rnd(4, 12);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false }));
      points.visible = false;
      points.userData.vel = vel;
      this.scene.add(points);
      return points;
    };
    this.smokePoints = drift(220, 0x777a80, 9, 0.22);
    this.dustPoints = drift(260, 0xb89a6a, 3.5, 0.35);
    this.pollenPoints = drift(70, 0xd8e8a0, 2.0, 0.25);   // decorative only
    this.pollenPoints.visible = true;
    // flood
    this.floodMesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshPhongMaterial({ color: 0x1c5a72, transparent: true, opacity: 0.55, specular: new THREE.Color(0.6, 0.6, 0.6), shininess: 80 }));
    this.floodMesh.visible = false;
    this.scene.add(this.floodMesh);
    // scent source (odour is modelled in the world; this circuit has no olfactory neurons)
    this.scentGroup = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.SphereGeometry(10, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd7a8ff, transparent: true, opacity: 0.55 }));
    glow.position.z = 16;
    const ring = new THREE.Mesh(new THREE.RingGeometry(SCENT_RADIUS * 0.85, SCENT_RADIUS, 40),
      new THREE.MeshBasicMaterial({ color: 0xd7a8ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide }));
    ring.position.z = 0.4;
    this.scentGroup.add(glow, ring);
    this.scene.add(this.scentGroup);
  }

  _resetDrop(i) {
    const b = this.bounds;
    this.rainPos[3 * i] = rnd(-b.width / 2 - 100, b.width / 2 + 100);
    this.rainPos[3 * i + 1] = rnd(-b.height / 2 - 100, b.height / 2 + 100);
    this.rainPos[3 * i + 2] = rnd(200, 900);
    this.rainVel[i] = rnd(700, 1000);
  }

  _buildMapOverlay() {
    this.mapCols = 24; this.mapRows = 16;
    this.mapTexData = new Uint8Array(this.mapCols * this.mapRows * 4);
    this.mapTexture = new THREE.DataTexture(this.mapTexData, this.mapCols, this.mapRows, THREE.RGBAFormat);
    this.mapTexture.magFilter = THREE.NearestFilter;
    this.mapTexture.minFilter = THREE.NearestFilter;
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.needsUpdate = true;
    this.mapOverlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.mapTexture, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mapOverlay.position.z = 1.2;
    this.mapOverlay.layers.set(MAP_LAYER);
    this.mapOverlay.visible = false;
    this.mapOverlay.renderOrder = 2;
    this.scene.add(this.mapOverlay);
    this.fitMapOverlay();
  }

  fitMapOverlay() { this.mapOverlay.scale.set(this.bounds.width, this.bounds.height, 1); }

  setMapVisible(on) { this.mapOverlay.visible = on; }

  paintMap(map) {
    if (!map) return;
    if (map.cols !== this.mapCols || map.rows !== this.mapRows) return;
    for (let i = 0; i < map.values.length; i++) {
      const o = i * 4;
      if (!map.coverage[i]) { this.mapTexData[o + 3] = 0; continue; }
      mapColor(clampf(map.values[i], 0, 1), this.mapTexData, o);
    }
    this.mapTexture.needsUpdate = true;
  }

  _buildVision() {
    // near = 1 so an object pressed against her face does not vanish past the
    // clip plane at the moment its looming should be strongest
    this.visionCamera = new THREE.PerspectiveCamera(150, VISION_W / VISION_H, 1, 900);
    this.visionCamera.up.set(0, 0, 1);
    this.visionTarget = new THREE.WebGLRenderTarget(VISION_W, VISION_H, { depthBuffer: true });
    this.visionPixels = new Uint8Array(VISION_W * VISION_H * 4);
    this.eyeReads = [];   // reads in flight, oldest first (see _renderEye)
    this.eyePool = [];    // their spare pixel buffers
    this.visionPrevLum = new Float32Array(VISION_W * VISION_H);
    this.visionMotion = new Float32Array(VISION_W * VISION_H);
    this.visionResidual = new Float32Array(VISION_W * VISION_H);
    this.visionSurround = new Float32Array(VISION_W * VISION_H);
    this.visionScratch = new Float32Array(VISION_W * VISION_H);
    this.visionMotionL = 0; this.visionMotionR = 0;
  }

  // ---- start-up -------------------------------------------------------------------
  // Compiles every shader the display and her eye will need (with a stand-in
  // fly, in case no snapshot has built hers yet) and renders each pass once,
  // behind the boot screen while the simulation is still paused. Without it
  // the first frames froze the page for ~4 s right after start, while the
  // brain was already running and her eye took no samples.
  async warmUp() {
    const r = this.renderer;
    const standIn = buildFlyModel();   // never disposed: its programs stay cached for her
    this.scene.add(standIn.root);
    try {
      this._lookFor('display');
      await r.compileAsync(this.scene, this.camera);
      this._lookFor('eye');
      r.setRenderTarget(this.visionTarget);
      await r.compileAsync(this.scene, this.visionCamera);
      r.render(this.scene, this.visionCamera);   // also builds the shadow map's programs and uploads
      r.setRenderTarget(null);
      this._lookFor('display');
      r.render(this.scene, this.camera);
    } finally {
      r.setRenderTarget(null);
      this.scene.remove(standIn.root);
      if (SHADOWS_ENABLED) r.shadowMap.needsUpdate = true;
    }
  }

  // ---- camera ------------------------------------------------------------------
  _easeOrbit(dt) {
    const k = Math.min(1, dt * 7.5);
    const s = this.orbitShown, o = this.orbit;
    s.azimuth += (o.azimuth - s.azimuth) * k;
    s.elevation += (o.elevation - s.elevation) * k;
    s.zoom += (o.zoom - s.zoom) * k;
    s.panX += (o.panX - s.panX) * k;
    s.panY += (o.panY - s.panY) * k;
  }

  _applyFov() {
    const fov = this.cameraMode === 'close' ? 36 : this.cameraMode === 'overhead' ? 48 : this.cameraMode === 'follow' ? 40 : 42;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  placeCamera() {
    const o = this.orbitShown;
    const r = overviewDistance(this.bounds, this.camera.fov, this.camera.aspect, o.azimuth, o.elevation) * o.zoom;
    const ce = Math.cos(o.elevation), se = Math.sin(o.elevation);
    const ca = Math.cos(o.azimuth), sa = Math.sin(o.azimuth);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(o.panX + r * ce * sa, o.panY - r * ce * ca, 10 + r * se);
    this.camera.lookAt(o.panX, o.panY, 10);
  }

  setZoom(z) {
    this.orbit.zoom = clampf(z, 0.5, 3.2);
  }

  toggleCameraMode() {
    const i = CAMERA_MODES.indexOf(this.cameraMode);
    this.cameraMode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this._applyFov();
    return this.cameraMode;
  }

  resetCamera() {
    Object.assign(this.orbit, { azimuth: 0.42, elevation: 0.68, zoom: 1, panX: 0, panY: 0 });
    this.cameraMode = 'overview';
    this._applyFov();
    return this.cameraMode;
  }

  _updateFollowCamera(dt) {
    const f = this.snap?.fly;
    if (!f) return;
    const close = this.cameraMode === 'close';
    const baseBack = close ? 58 : 112, baseUp = close ? 26 : 56;
    const bodyScale = this.flyViews?.[0]?.model.root.scale.x / FLY_SCALE || 1;
    const distance = Math.max(Math.hypot(baseBack, baseUp - FOLLOW_BODY_CENTER_Z),
      followFitDistance(this.camera.fov, this.camera.aspect, FOLLOW_BODY_RADIUS * bodyScale)) * this.orbitShown.zoom;
    // Fit first, then apply the user's zoom: zooming in deliberately remains
    // a macro view. Compensate for the unobstructed boom's 6% clearance.
    const boomScale = distance / Math.hypot(baseBack, baseUp - FOLLOW_BODY_CENTER_Z) / 0.94;
    const back = baseBack * boomScale;
    const up = FOLLOW_BODY_CENTER_Z + (baseUp - FOLLOW_BODY_CENTER_Z) * boomScale;
    const yaw = f.heading + this.orbitShown.azimuth * 0.35;
    const hx = Math.cos(yaw), hy = Math.sin(yaw);
    const k = Math.min(1, dt * 5.5);
    const c = this.camera.position;
    this.camera.up.set(0, 0, 1);
    const goal = this._unoccludedBoom(f, f.x - hx * back, f.y - hy * back, f.z + up);
    // Glass or scenery can shorten the horizontal boom. Gain height rather
    // than leave the tank or crop the body after a narrow-pane resize.
    const centerZ = f.z + FOLLOW_BODY_CENTER_Z;
    const horizontal2 = (goal.x - f.x) ** 2 + (goal.y - f.y) ** 2;
    goal.z = Math.max(goal.z, centerZ + Math.sqrt(Math.max(0, distance * distance - horizontal2)));
    c.x += (goal.x - c.x) * k;
    c.y += (goal.y - c.y) * k;
    c.z += (goal.z - c.z) * k;
    // Centring the body also prevents an instantaneous heading change from
    // swinging the look target away while the camera's position eases.
    this.followLookAt.set(f.x, f.y, centerZ);
    this.camera.lookAt(this.followLookAt);
  }

  // The following camera's boom from her head to (x, y, z), kept inside the
  // glass and out of the scenery: an object standing between her and the
  // camera (a cylinder of its radius and rendered height) shortens the boom
  // to just in front of it and lifts the camera over it. Observer only.
  _unoccludedBoom(f, x, y, z) {
    const out = this.boomGoal ??= new THREE.Vector3();
    const hw = this.bounds.width / 2 - FOLLOW_WALL_MARGIN, hh = this.bounds.height / 2 - FOLLOW_WALL_MARGIN;
    x = clampf(x, -hw, hw); y = clampf(y, -hh, hh);
    const sx = f.x, sy = f.y, sz = f.z + 8;
    const dx = x - sx, dy = y - sy, dz = z - sz;
    const len2 = dx * dx + dy * dy;
    let first = 1;
    if (len2 > 1e-6) {
      for (const o of this.world.objects) {
        if (o.kind === 'firefly' || !(o.topZ > FOLLOW_MIN_OCCLUDER)) continue;
        const r = o.radius + FOLLOW_CLEARANCE;
        // entry of the segment into the object's circle (2D), if any
        const ox = sx - o.pos.x, oy = sy - o.pos.y;
        const b = ox * dx + oy * dy, cc = ox * ox + oy * oy - r * r;
        if (cc <= 0) continue;               // she stands inside its footprint: nothing to clear
        const disc = b * b - len2 * cc;
        if (disc <= 0) continue;
        const s = (-b - Math.sqrt(disc)) / len2;
        if (s <= 0 || s >= first) continue;
        if (sz + dz * s > o.topZ + FOLLOW_CLEARANCE) continue;   // the boom passes over it
        first = s;
      }
    }
    const s = Math.max(FOLLOW_MIN_BOOM, first - 0.06);
    out.set(sx + dx * s, sy + dy * s, sz + dz * s + (1 - s) * FOLLOW_LIFT);
    return out;
  }

  _updateOverheadCamera(dt) {
    const o = this.orbitShown;
    const targetX = o.panX, targetY = o.panY;
    const halfVertical = Math.tan(this.camera.fov * Math.PI / 360);
    const height = Math.max(this.bounds.width / (2 * halfVertical * this.camera.aspect),
      this.bounds.height / (2 * halfVertical)) * o.zoom * 1.12;
    const k = Math.min(1, dt * 5);
    const c = this.camera.position;
    c.x += (targetX - c.x) * k;
    c.y += (targetY - c.y) * k;
    c.z += (height - c.z) * k;
    // The normal Z-up camera is degenerate when looking vertically down Z.
    // Y-up keeps north at the top instead of arbitrarily rotating the tank.
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(targetX, targetY, 0);
  }

  fitShadowCamera() {
    const c = this.key.shadow.camera, m = 260, b = this.bounds;
    c.left = -b.width / 2 - m; c.right = b.width / 2 + m; c.top = b.height / 2 + m; c.bottom = -b.height / 2 - m;
    c.near = 1; c.far = 2200;
    c.updateProjectionMatrix();
  }

  // ---- exposure and daylight (observer side) --------------------------------------
  setViewBrightness(v) { this.viewBrightness = clampf(v, 0.5, 2.5); this._applyExposure(); }
  setAutoNightLift(on) { this.autoNightLift = !!on; this._applyExposure(); }
  _applyExposure() {
    this.displayExposure = clampf(this.viewBrightness * (this.autoNightLift ? this.autoLiftGain : 1), 0.25, 4);
    this.renderer.toneMappingExposure = this.displayExposure;
  }
  get exposureInfo() { return { exposure: this.displayExposure, autoLift: this.autoNightLift ? this.autoLiftGain : 1 }; }

  updateDayNight() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const sky = dayNightAt(hour);
    const grad = this.skyCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${sky.top.getHexString()}`);
    grad.addColorStop(0.42, `#${sky.mid.getHexString()}`);
    grad.addColorStop(0.78, `#${sky.bottom.getHexString()}`);
    grad.addColorStop(1, `#${sky.bottom.getHexString()}`);
    this.skyCtx.fillStyle = grad;
    this.skyCtx.fillRect(0, 0, 8, 256);
    this.skyTex.needsUpdate = true;
    this.scene.fog.color.copy(sky.fog);
    this.renderer.setClearColor(sky.fog, 1);
    this.key.color.copy(sky.keyColor);
    const arousal = circadianActivity(hour);
    this.key.intensity = sky.keyIntensity * (0.75 + 0.25 * arousal);
    this.ambientLight.intensity = sky.ambient * (0.75 + 0.25 * arousal);
    this.lightBase = { key: this.key.intensity, ambient: this.ambientLight.intensity };
    this.look = null;    // the intensities just set are the eye's: re-apply the whole eye look
    this._lookFor('eye');
    this.hemi.color.copy(sky.mid).lerp(DISPLAY_SKY_TINT, 0.35);
    this.hemi.groundColor.copy(DISPLAY_SOIL).multiplyScalar(0.4 + 0.6 * Math.min(1, sky.keyIntensity / 1.65));
    const relative = sceneLightLevel(this.ambientLight.intensity, this.key.intensity) / DAY_REFERENCE_LIGHT;
    this.autoLiftGain = autoExposureGain(relative);
    this._applyExposure();
  }

  // ---- snapshots ------------------------------------------------------------------------
  applySnapshot(snap) {
    this.snap = snap;
    this._syncEyeRun();
    // flies
    while (this.flyViews.length < snap.poses.length) {
      const model = buildFlyModel();
      // Her own body (the first fly is the one whose eye is rendered) is not
      // in her eye: her limbs grooming in front of her face are not an
      // approaching object. It stays in the view and in the shadow map.
      if (this.flyViews.length === 0) model.root.traverse((o) => o.layers.set(DISPLAY_LAYER));
      this.scene.add(model.root);
      this.flyViews.push({ model, nodes: poseNodes(model) });
    }
    while (this.flyViews.length > snap.poses.length) {
      const v = this.flyViews.pop();
      this.scene.remove(v.model.root);
    }
    snap.poses.forEach((pose, i) => applyPose(this.flyViews[i].model, pose, this.flyViews[i].nodes));
    this.world.applyState(snap.objects);
    const env = snap.env;
    this.rainPoints.visible = env.rain || env.iceRain;
    this.rainPoints.material.color.setHex(env.iceRain ? 0xdff3ff : 0xbfe0ff);
    this.fireGroup.visible = env.fire;
    this.fireGroup.position.set(snap.firePos.x, snap.firePos.y, 0);
    this.smokePoints.visible = env.smoke;
    this.dustPoints.visible = env.dust;
    this.floodMesh.visible = env.floodLevel > 0.003;
    this.floodMesh.position.z = env.floodLevel * FLOOD_MAX_Z;
    this.scentGroup.position.set(snap.scentPos.x, snap.scentPos.y, 0);
    this.quake = env.quake;
    this._syncFood(snap.food);
  }

  _syncFood(food) {
    const seen = new Set();
    for (const d of food) {
      seen.add(d.id);
      let v = this.foodViews.get(d.id);
      if (!v) {
        const color = d.kind === 'sugar' ? 0xfff3b0 : d.kind === 'bitter' ? 0x9be27a : 0xd9c87a;
        const drop = new THREE.Mesh(new THREE.SphereGeometry(12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.78, specular: new THREE.Color(0.9, 0.9, 0.9), shininess: 120 }));
        drop.rotation.x = Math.PI / 2;
        drop.scale.set(1, 0.35, 1);
        const ring = new THREE.Mesh(new THREE.RingGeometry(15, 17, 32),
          new THREE.MeshBasicMaterial({ color: d.kind === 'sugar' ? 0xffe066 : d.kind === 'bitter' ? 0x6ee06e : 0xe0c060, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        ring.position.z = 0.3;
        const g = new THREE.Group();
        g.add(drop, ring);
        g.userData.drop = drop;
        this.scene.add(g);
        v = g;
        this.foodViews.set(d.id, v);
      }
      const s = 0.35 + 0.65 * Math.sqrt(Math.max(0, d.volume));
      v.userData.drop.scale.set(s, 0.35 * s, s);
      v.position.set(d.x, d.y, 0.2);
    }
    for (const [id, v] of this.foodViews) if (!seen.has(id)) { this.scene.remove(v); this.foodViews.delete(id); }
  }

  // ---- per displayed frame -------------------------------------------------------------------
  // `draw` false skips only the display render: every scene update and the
  // eye's samples still happen, so the fly's vision does not change.
  frame(dt, tSeconds, draw = true) {
    // The shadow map is refreshed by the display render and reused by her eye:
    // three.js fills it with the layers of the camera that renders first, and
    // her own body (display layer) must cast its shadow in both.
    const display = draw && !this.displayHidden;
    if (SHADOWS_ENABLED && display) this.renderer.shadowMap.needsUpdate = true;
    this.dayNightT += dt;
    if (this.dayNightT > 2) { this.dayNightT = 0; this.updateDayNight(); }
    this._animateWeather(dt, tSeconds);
    if (this.quake) { this.world.node.position.x = rnd(-3, 3); this.world.node.position.y = rnd(-3, 3); }
    else if (this.world.node.position.x || this.world.node.position.y) this.world.node.position.set(0, 0, 0);
    this._easeOrbit(dt);
    this._applyFov();
    if (this.cameraMode === 'follow' || this.cameraMode === 'close') this._updateFollowCamera(dt);
    else if (this.cameraMode === 'overhead') this._updateOverheadCamera(dt);
    else this.placeCamera();
    const want = this.viewInset, shown = this.viewInsetShown;
    if (Math.abs(want.bottom - shown.bottom) > 0.5 || Math.abs(want.right - shown.right) > 0.5) {
      const k = Math.min(1, dt * 9);
      shown.bottom += (want.bottom - shown.bottom) * k;
      shown.right += (want.right - shown.right) * k;
      this._applyViewOffset();
    }
    if (display) { this._lookFor('display'); this._displayAtmosphere(); this.world.animateDisplay(tSeconds); this.renderer.render(this.scene, this.camera); }
    // Her eye samples every EYE_SAMPLE_S of simulated time: the change
    // between two samples (her visual input) must not depend on how fast
    // this computer runs the simulation. A longer gap (a stalled page, a
    // pause, a new fly) re-primes the eye instead of reading the whole gap's
    // change as motion.
    const simT = this.snap?.t;
    if (this.visionEnabled && Number.isFinite(simT)) {
      if (this.eyeSimT === undefined || simT < this.eyeSimT) this.eyeSimT = simT;
      if (simT - this.eyeSimT >= EYE_SAMPLE_S) {
        // With the display hidden the shadow map is still refreshed through
        // the display camera (her own body casts its shadow from the display
        // layer), drawn into a single pixel: her eye sees the same world.
        if (!display && SHADOWS_ENABLED) this._refreshShadows();
        if (this._renderEye()) this.eyeSimT = simT;
      }
    }
  }

  _refreshShadows() {
    const r = this.renderer;
    this.shadowProbe ??= new THREE.WebGLRenderTarget(1, 1);
    r.shadowMap.needsUpdate = true;
    this._lookFor('display');
    this._displayAtmosphere();
    r.setRenderTarget(this.shadowProbe);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }

  // A sheet covering the bottom `px` of the pane (phone layout): the observer's
  // camera shifts the picture up so the tank sits in the visible part. Display
  // only; her eye has its own camera.
  setViewInset(bottom, right = 0) {
    this.viewInset = {
      bottom: Math.max(0, Math.min(Number(bottom) || 0, this.pane.height * 0.75)),
      right: Math.max(0, Math.min(Number(right) || 0, this.pane.width * 0.75)),
    };
  }
  // Shifts the picture so the camera's centre sits in the uncovered part.
  _applyViewOffset() {
    const x = this.viewInsetShown.right / 2, y = this.viewInsetShown.bottom / 2;
    if (x > 0.5 || y > 0.5) this.camera.setViewOffset(this.pane.width, this.pane.height, x, y, this.pane.width, this.pane.height);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
  }

  // The current view as a PNG data URL (snapshots outside Electron).
  capturePNG() {
    this._lookFor('display');
    this._displayAtmosphere();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  _animateWeather(dt, t) {
    if (this.rainPoints.visible) {
      for (let i = 0; i < this.RAIN_COUNT; i++) {
        this.rainPos[3 * i + 2] -= this.rainVel[i] * dt;
        if (this.rainPos[3 * i + 2] < 0) this._resetDrop(i);
      }
      this.rainPoints.geometry.attributes.position.needsUpdate = true;
    }
    if (this.fireGroup.visible) {
      for (const m of this.fireGroup.children) {
        if (!m.isMesh) continue;
        const u = m.userData;
        m.position.z = u.baseZ + 14 * ((t * u.speed) % 1);
        if (((t * u.speed) % 1) < dt * u.speed) { m.position.x = rnd(-10, 10); m.position.y = rnd(-10, 10); }
        m.position.x += Math.sin(t * 3 + u.wobble) * 0.4;
      }
      this.fireGlow.intensity = 1.4 + 0.5 * Math.sin(t * 17);
    }
    for (const points of [this.smokePoints, this.dustPoints, this.pollenPoints]) {
      if (!points.visible) continue;
      const pos = points.geometry.attributes.position.array, vel = points.userData.vel;
      const hw = this.bounds.width / 2, hh = this.bounds.height / 2;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[3 * i] += vel[3 * i] * dt; pos[3 * i + 1] += vel[3 * i + 1] * dt; pos[3 * i + 2] += vel[3 * i + 2] * dt;
        if (pos[3 * i + 2] > 150) pos[3 * i + 2] = 4;
        if (pos[3 * i] > hw) pos[3 * i] = -hw; else if (pos[3 * i] < -hw) pos[3 * i] = hw;
        if (pos[3 * i + 1] > hh) pos[3 * i + 1] = -hh; else if (pos[3 * i + 1] < -hh) pos[3 * i + 1] = hh;
      }
      points.geometry.attributes.position.needsUpdate = true;
    }
  }

  // The fly's own eye: the same scene from her head, along her heading, at
  // fixed exposure, without her own body. The pixels come back asynchronously
  // (a synchronous read stalls the whole GPU pipeline): a sensory latency of
  // 120-200 ms on integrated graphics in Chromium, measured 2026-10-01; the
  // samples themselves stay 50 ms of simulated time apart (frame()).
  _renderEye() {
    const f = this.snap?.fly;
    if (!f) return false;
    this._syncEyeRun();
    // A read waits for the GPU (in Chromium 120-200 ms on integrated
    // graphics), so several are in flight, each into its own buffer, and
    // their images are processed strictly in the order they were taken. With
    // all slots busy this sample is not taken (no unused GPU pass).
    if (this.eyeReads.length >= EYE_READS_IN_FLIGHT) return false;
    const headZ = f.z + 8;
    this.visionCamera.position.set(f.x, f.y, headZ);
    this.visionCamera.lookAt(f.x + Math.cos(f.heading) * 40, f.y + Math.sin(f.heading) * 40, headZ);
    const r = this.renderer;
    this._lookFor('eye');
    r.toneMappingExposure = VISION_EXPOSURE;
    r.setRenderTarget(this.visionTarget);
    r.render(this.scene, this.visionCamera);
    r.setRenderTarget(null);
    r.toneMappingExposure = this.displayExposure;
    const read = { pixels: this.eyePool.pop() ?? new Uint8Array(VISION_W * VISION_H * 4),
      simT: this.snap.t, neuralRun: this.snap.neuralRun, individual: this.snap.individual, done: false, ok: false };
    this.eyeReads.push(read);
    this.visionReadPending = true;
    r.readRenderTargetPixelsAsync(this.visionTarget, 0, 0, VISION_W, VISION_H, read.pixels)
      .then(() => { read.ok = true; }, () => {})
      .then(() => { read.done = true; this._drainEye(); });
    return true;
  }

  // Hands finished reads to _processEye oldest first; a read that finished
  // early waits for those taken before it.
  _drainEye() {
    this._syncEyeRun();
    while (this.eyeReads.length && this.eyeReads[0].done) {
      const read = this.eyeReads.shift();
      if (read.ok && read.neuralRun === this.snap?.neuralRun && read.individual === this.snap?.individual) {
        this.visionPixels.set(read.pixels); this.eyeImageT = read.simT; this._processEye();
      }
      this.eyePool.push(read.pixels);
    }
    this.visionReadPending = this.eyeReads.length > 0;
  }

  _syncEyeRun() {
    const snap = this.snap;
    if (!snap || (this.eyeNeuralRun === snap.neuralRun && this.eyeIndividual === snap.individual)) return;
    this.eyeNeuralRun = snap.neuralRun;
    this.eyeIndividual = snap.individual;
    this.eyePrimed = false;
    this.eyePreviousT = undefined;
    this.eyeSimT = snap.t;
    this.visionMotionL = 0; this.visionMotionR = 0;
    // Outstanding reads retain their own buffers until the GPU is finished;
    // _drainEye recycles them without passing old-run pixels to the model.
  }

  _sendVision(L, R) {
    this.onVision?.({ L, R, neuralRun: this.eyeNeuralRun, individual: this.eyeIndividual });
  }

  _processEye() {
    const px = this.visionPixels, n = VISION_W * VISION_H;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      const lum = (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255;
      this.visionMotion[p] = Math.abs(lum - this.visionPrevLum[p]);
      this.visionPrevLum[p] = lum;
    }
    // The first image after start (or after the eye was switched off) has
    // nothing real to be compared with: against the initial black it would
    // read as the whole world appearing at once — a maximal looming stimulus
    // manufactured by the renderer. It only primes the comparison.
    // The same holds after a gap of more than EYE_GAP_S of simulated time (a
    // stalled page, a pause, a new fly whose clock restarts): the input is
    // nothing until two close samples can be compared again. Decided per
    // image, so reads still in flight from before a gap cannot bridge it.
    const imageT = this.eyeImageT, previousT = this.eyePreviousT;
    this.eyePreviousT = imageT;
    const interval = Number.isFinite(imageT) && Number.isFinite(previousT) ? imageT - previousT : EYE_SAMPLE_S;
    if (!this.eyePrimed || !(interval > 0) || interval > EYE_GAP_S) {
      this.eyePrimed = true;
      this.visionMotionL = 0; this.visionMotionR = 0;
      this._sendVision(0, 0);
      return;
    }
    // Motion energy per EYE_SAMPLE_S of simulated time: images are 50-120 ms
    // apart (snapshots arrive in steps), and the looming detectors respond to
    // the rate of expansion, not to how far apart two samples happened to be.
    const perSample = Math.min(1, EYE_SAMPLE_S / interval);
    // Centre-surround antagonism removes self-motion flow and keeps compact,
    // locally different motion — what LC4/LPLC2 are tuned to (src/vision.js).
    localMotionResidual(this.visionMotion, VISION_W, VISION_H, this.visionResidual, this.visionSurround, this.visionScratch);
    let sumL = 0, sumR = 0;
    for (let y = 0; y < VISION_H; y++) {
      for (let x = 0; x < VISION_W; x++) {
        const v = this.visionResidual[y * VISION_W + x];
        if (x < VISION_W / 2) sumL += v; else sumR += v;   // image left = her left eye
      }
    }
    const half = n / 2;
    this.visionMotionL = (sumL / half) * perSample; this.visionMotionR = (sumR / half) * perSample;
    this._sendVision(this.visionMotionL, this.visionMotionR);
    if (this.visionPreview) this._paintEye();
  }

  _paintEye() {
    const { rawCtx, motionCtx } = this.visionPreview;
    if (rawCtx) {
      const img = rawCtx.createImageData(VISION_W, VISION_H);
      // WebGL rows are bottom-up
      for (let y = 0; y < VISION_H; y++) {
        const src = (VISION_H - 1 - y) * VISION_W * 4, dst = y * VISION_W * 4;
        img.data.set(this.visionPixels.subarray(src, src + VISION_W * 4), dst);
      }
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      rawCtx.putImageData(img, 0, 0);
    }
    if (motionCtx) {
      const img = motionCtx.createImageData(VISION_W, VISION_H);
      for (let y = 0; y < VISION_H; y++) {
        for (let x = 0; x < VISION_W; x++) {
          const g = clampf(this.visionResidual[(VISION_H - 1 - y) * VISION_W + x] / 0.25, 0, 1);
          const o = (y * VISION_W + x) * 4;
          img.data[o] = 6 + 30 * g; img.data[o + 1] = 16 + 239 * g; img.data[o + 2] = 12 + 53 * g * g; img.data[o + 3] = 255;
        }
      }
      motionCtx.putImageData(img, 0, 0);
    }
  }

  // ---- pointer ----------------------------------------------------------------------------
  projectToGround(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 };
    this.groundRay.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.groundRay.ray;
    if (Math.abs(direction.z) < 1e-6) return null;
    const t = -origin.z / direction.z;
    if (t < 0) return null;
    return { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.drag = null;
    // Touch: one finger is the mouse's left button (drag the fly or an object,
    // tap, swipe at her as a looming threat); two fingers turn the camera and
    // pinch to zoom.
    const touches = new Map();
    const gestureOf = () => {
      const [a, b] = [...touches.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          if (this.drag && this.drag.kind !== 'camera' && this.drag.kind !== 'pan' && this.drag.kind !== 'gesture') this.onCommand('drag.end', {});
          this.downPoint = null;
          this.onPointer?.(null);
          this.drag = { kind: 'gesture', ...gestureOf() };
          return;
        }
        if (touches.size > 2) return;
      }
      if (e.button === 2) {
        if (this.cameraMode === 'overview') this.drag = { kind: e.shiftKey ? 'pan' : 'camera', x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button === 1) {
        if (this.cameraMode === 'overview' || this.cameraMode === 'overhead') this.drag = { kind: 'pan', x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      const p = this.projectToGround(e.clientX, e.clientY);
      this.downPoint = p;
      if (!p || !this.snap) return;
      el.setPointerCapture(e.pointerId);
      const f = this.snap.fly;
      if (Math.hypot(f.x - p.x, f.y - p.y) < FLY_GRAB_RADIUS) {
        this.drag = { kind: 'fly' };
        this.onCommand('drag.start', { kind: 'fly', x: p.x, y: p.y });
        return;
      }
      let best = null, bestD = Infinity;
      this.world.objects.forEach((o, id) => {
        const d = Math.hypot(o.pos.x - p.x, o.pos.y - p.y);
        if (d < o.radius + OBJECT_GRAB_MARGIN && d < bestD) { bestD = d; best = { kind: 'object', id }; }
      });
      const points = [];
      if (this.snap.env.fire) points.push({ kind: 'fire', pos: this.snap.firePos, radius: 24 });
      points.push({ kind: 'scent', pos: this.snap.scentPos, radius: 18 });
      for (const d of this.snap.food) points.push({ kind: 'food', id: d.id, pos: d, radius: 20 });
      for (const pt of points) {
        const d = Math.hypot(pt.pos.x - p.x, pt.pos.y - p.y);
        if (d < pt.radius + OBJECT_GRAB_MARGIN && d < bestD) { bestD = d; best = { kind: 'point', id: { kind: pt.kind, id: pt.id } }; }
      }
      if (best) {
        this.drag = best;
        this.onCommand('drag.start', best);
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.drag?.kind === 'gesture') {
        if (touches.size < 2) return;
        const g = gestureOf();
        if (g.dist > 0 && this.drag.dist > 0) this.setZoom(this.orbit.zoom * this.drag.dist / g.dist);
        const dx = g.x - this.drag.x, dy = g.y - this.drag.y;
        if (this.cameraMode === 'overhead') {
          const scale = 2 * this.camera.position.z * Math.tan(this.camera.fov * Math.PI / 360) / this.pane.height;
          this.orbit.panX = clampf(this.orbit.panX - dx * scale, -this.bounds.width / 2, this.bounds.width / 2);
          this.orbit.panY = clampf(this.orbit.panY + dy * scale, -this.bounds.height / 2, this.bounds.height / 2);
        } else {
          this.orbit.azimuth -= dx * 0.006;
          this.orbit.elevation = clampf(this.orbit.elevation - dy * 0.006, 0.08, 1.45);
        }
        this.drag = { kind: 'gesture', ...g };
        this.onZoom?.(this.orbit.zoom);
        return;
      }
      const rect = el.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (this.drag?.kind === 'camera') {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        this.orbit.azimuth -= dx * 0.006;
        this.orbit.elevation = clampf(this.orbit.elevation - dy * 0.006, 0.08, 1.45);
        return;
      }
      if (this.drag?.kind === 'pan') {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        const distance = this.cameraMode === 'overhead'
          ? this.camera.position.z
          : overviewDistance(this.bounds, this.camera.fov, this.camera.aspect, this.orbitShown.azimuth, this.orbitShown.elevation) * this.orbitShown.zoom;
        const scale = 2 * distance * Math.tan(this.camera.fov * Math.PI / 360) / this.pane.height;
        const ca = Math.cos(this.orbitShown.azimuth), sa = Math.sin(this.orbitShown.azimuth);
        this.orbit.panX = clampf(this.orbit.panX - dx * scale * ca - dy * scale * sa, -this.bounds.width / 2, this.bounds.width / 2);
        this.orbit.panY = clampf(this.orbit.panY - dx * scale * sa + dy * scale * ca, -this.bounds.height / 2, this.bounds.height / 2);
        return;
      }
      const p = inside || this.drag ? this.projectToGround(e.clientX, e.clientY) : null;
      this.onPointer?.(p);
      if (this.drag && p) {
        if (this.drag.kind === 'object') {
          const o = this.world.objects[this.drag.id];
          if (o) { o.pos.x = p.x; o.pos.y = p.y; o.mesh.position.x = p.x; o.mesh.position.y = p.y; }
        }
        this.onCommand('drag.move', { x: p.x, y: p.y });
      }
    });
    el.addEventListener('pointerleave', () => { if (!this.drag) this.onPointer?.(null); });
    const lift = (e) => {
      if (!touches.delete(e.pointerId)) return false;
      if (this.drag?.kind === 'gesture') { if (touches.size < 2) this.drag = null; return true; }
      // A lifted finger leaves no cursor resting near her.
      setTimeout(() => { if (!this.drag) this.onPointer?.(null); }, 0);
      return false;
    };
    window.addEventListener('pointercancel', (e) => {
      if (lift(e)) return;
      if (touches.size === 0 && this.drag && this.drag.kind !== 'camera' && this.drag.kind !== 'pan') { this.onCommand('drag.end', {}); this.drag = null; }
    });
    window.addEventListener('pointerup', (e) => {
      if (lift(e)) return;
      if (this.drag?.kind === 'gesture') return;
      if (e.button === 2 || e.button === 1) { if (this.drag?.kind === 'camera' || this.drag?.kind === 'pan') this.drag = null; return; }
      if (this.drag && this.drag.kind !== 'camera' && this.drag.kind !== 'pan') this.onCommand('drag.end', {});
      else if (!this.drag && this.downPoint && e.target === el) this.onTap?.(this.downPoint);
      this.drag = null;
      this.downPoint = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.orbit.zoom + e.deltaY * 0.0004);
      this.onZoom?.(this.orbit.zoom);
    }, { passive: false });
  }

  resize() {
    const w = Math.max(100, this.container.clientWidth), h = Math.max(100, this.container.clientHeight);
    const bounds = arenaBounds(w, h, this.minArenaSide);
    if (w === this.pane.width && h === this.pane.height && bounds.width === this.bounds.width && bounds.height === this.bounds.height) return false;
    this.pane = { width: w, height: h };
    this.bounds = bounds;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._applyViewOffset();
    if (this.cameraMode === 'overview') this.placeCamera();
    this.fitMapOverlay();
    this.fitShadowCamera();
    this.world.resize(this.bounds);
    return true;
  }

  // three.js re-sizes the canvas on every call, which reallocates its drawing
  // buffer: only when the ratio actually changes (it is re-evaluated each second).
  setPixelRatio(r) {
    if (Math.abs(r - this.renderer.getPixelRatio()) < 0.001) return;
    this.renderer.setPixelRatio(r);
  }

  // head position of the brain-carrying fly on screen, for anchoring labels
  flyScreenPosition() {
    const f = this.snap?.fly;
    if (!f) return null;
    const v = new THREE.Vector3(f.x, f.y, f.z + 14).project(this.camera);
    return { x: (v.x + 1) / 2 * this.pane.width, y: (1 - v.y) / 2 * this.pane.height, visible: v.z < 1 };
  }
}
