// performance.js -- measured runtime telemetry for the simulation, not a
// guessed "performance score".  It separates wall-clock throughput (what the
// user experiences) from LIF-core throughput (what the neural solver costs).

export class PerformanceMeter {
  constructor(commitSeconds = 0.5) {
    this.commitSeconds = Math.max(0.05, commitSeconds);
    this.bucket = this._emptyBucket();
    this.last = this._emptySnapshot();
  }

  _emptyBucket() {
    return { wall: 0, frames: 0, simulated: 0, compute: 0, spikes: 0, deliveries: 0, dropped: 0 };
  }

  _emptySnapshot() {
    return {
      windowSeconds: 0,
      fps: 0,
      simulationRealtime: 0,
      coreRealtime: 0,
      neuralStepsPerSecond: 0,
      spikesPerSecond: 0,
      synapticDeliveriesPerSecond: 0,
      droppedSecondsPerSecond: 0,
    };
  }

  noteFrame(wallSeconds) {
    if (!(wallSeconds > 0) || !Number.isFinite(wallSeconds)) return this.last;
    this.bucket.wall += wallSeconds;
    this.bucket.frames++;
    return this.snapshot();
  }

  noteSimulation({ simulatedSeconds = 0, computeSeconds = 0, spikes = 0, deliveries = 0, droppedSeconds = 0 } = {}) {
    if (Number.isFinite(simulatedSeconds) && simulatedSeconds > 0) this.bucket.simulated += simulatedSeconds;
    if (Number.isFinite(computeSeconds) && computeSeconds > 0) this.bucket.compute += computeSeconds;
    if (Number.isFinite(spikes) && spikes > 0) this.bucket.spikes += spikes;
    if (Number.isFinite(deliveries) && deliveries > 0) this.bucket.deliveries += deliveries;
    if (Number.isFinite(droppedSeconds) && droppedSeconds > 0) this.bucket.dropped += droppedSeconds;
  }

  snapshot(force = false) {
    const b = this.bucket;
    if (b.wall < this.commitSeconds && !force) return this.last;
    if (!(b.wall > 0)) return this.last;
    this.last = {
      windowSeconds: b.wall,
      fps: b.frames / b.wall,
      simulationRealtime: b.simulated / b.wall,
      coreRealtime: b.compute > 0 ? b.simulated / b.compute : 0,
      neuralStepsPerSecond: b.simulated * 1000 / b.wall,
      spikesPerSecond: b.spikes / b.wall,
      synapticDeliveriesPerSecond: b.deliveries / b.wall,
      droppedSecondsPerSecond: b.dropped / b.wall,
    };
    this.bucket = this._emptyBucket();
    return this.last;
  }

  reset() {
    this.bucket = this._emptyBucket();
    this.last = this._emptySnapshot();
  }
}

// A slow or interrupted run must not be mistaken for a quiet biological state.
// These are observations about the numerical clock, not claims about the fly.
export function classifyRunTiming({ paused = false, speed = 1, perf = null } = {}) {
  const requested = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const measured = Number.isFinite(perf?.simulationRealtime) ? Math.max(0, perf.simulationRealtime) : null;
  const runMissing = Number.isFinite(perf?.runDroppedSimulationSeconds)
    ? perf.runDroppedSimulationSeconds : perf?.totalDroppedSimulationSeconds;
  const missing = Number.isFinite(runMissing) ? Math.max(0, runMissing) : 0;
  if (paused) return 'paused';
  if (missing > 0.000001) return 'gap';
  if (!Number.isFinite(perf?.windowSeconds) || perf.windowSeconds <= 0 || measured === null) return 'measuring';
  if (measured < requested * 0.9) return 'behind';
  return 'on-pace';
}

// GPU work is observer-side only. This controller can lower the number of
// shaded pixels when the measured simulation is falling behind, then restore
// them after sustained headroom. It never changes a neural timestep, input,
// random draw or anatomical edge -- only how expensively the two canvases are
// drawn for the human observer.
export class AdaptiveRenderQuality {
  constructor({ minPixelRatio = 0.75, maxPixelRatio = 1.5, startPixelRatio = maxPixelRatio } = {}) {
    this.minPixelRatio = Math.max(0.25, Math.min(minPixelRatio, maxPixelRatio));
    this.maxPixelRatio = Math.max(this.minPixelRatio, maxPixelRatio);
    this.pixelRatio = Math.min(this.maxPixelRatio, Math.max(this.minPixelRatio, startPixelRatio));
    this.headroomWindows = 0;
    this.resizeCooldown = 0;
  }

  observe({ fps = 0, simulationRealtime = 0, droppedSecondsPerSecond = 0 } = {}) {
    // Called once per measurement window (~1 s). A canvas resize itself
    // stalls integrated graphics; allow its effects to settle before sizing
    // again, and use quarter-resolution tiers to reach the floor in fewer
    // reallocations. Recovery requires sustained headroom.
    const cooling = this.resizeCooldown > 0;
    if (cooling) this.resizeCooldown--;
    const overloaded = fps < 42 || simulationRealtime < 0.92 || droppedSecondsPerSecond > 0.0005;
    if (overloaded) {
      this.headroomWindows = 0;
      if (!cooling) {
        const next = Math.max(this.minPixelRatio, (Math.ceil(this.pixelRatio * 4 - 1e-8) - 1) / 4);
        if (next !== this.pixelRatio) { this.pixelRatio = next; this.resizeCooldown = 2; }
      }
      return this.pixelRatio;
    }
    const healthy = fps >= 58 && simulationRealtime >= 0.98 && droppedSecondsPerSecond <= 0.0005;
    this.headroomWindows = healthy && !cooling ? this.headroomWindows + 1 : 0;
    if (this.headroomWindows >= 6) {
      const next = Math.min(this.maxPixelRatio, (Math.floor(this.pixelRatio * 4 + 1e-8) + 1) / 4);
      if (next !== this.pixelRatio) { this.pixelRatio = next; this.resizeCooldown = 2; }
      this.headroomWindows = 0;
    }
    return this.pixelRatio;
  }
}

// When the simulation falls behind real time, the page draws its display
// views on only every second or third animation frame. Every scene update
// still runs each frame and the fly's own eye keeps its 20 Hz sampling, so
// what she sees -- and with it every neural input -- is unchanged; only the
// observer's picture gets less smooth. On a small integrated-graphics machine
// the display renderer and the simulation worker share the same cores and
// power budget, so this gives the neural clock back its real-time pace before
// the picture loses resolution (AdaptiveRenderQuality).
export class DisplayPacer {
  constructor({ maxStride = 3, recoverWindows = 4 } = {}) {
    this.maxStride = Math.max(1, Math.floor(maxStride));
    this.recoverWindows = Math.max(1, Math.floor(recoverWindows));
    this.stride = 1;
    this.minStride = 1;      // raised while other simulation work needs the cores
    this.healthyWindows = 0;
    this.phase = 0;
  }

  // Once per measurement window (about a second). `simulationRealtime` is
  // relative to the requested speed and 1 while paused.
  observe({ simulationRealtime = 1, droppedSecondsPerSecond = 0 } = {}) {
    const lagging = simulationRealtime < 0.97 || droppedSecondsPerSecond > 0.005;
    if (lagging) {
      this.healthyWindows = 0;
      if (this.stride < this.maxStride) this.stride++;
      return this.stride = Math.max(this.stride, this.minStride);
    }
    const healthy = simulationRealtime >= 0.995 && droppedSecondsPerSecond <= 0.0005;
    this.healthyWindows = healthy ? this.healthyWindows + 1 : 0;
    if (this.healthyWindows >= this.recoverWindows && this.stride > 1) {
      this.stride--;
      this.healthyWindows = 0;
    }
    return this.stride = Math.max(this.stride, this.minStride);
  }

  // Once per animation frame: whether this frame draws the display views.
  shouldDraw() {
    this.phase = (this.phase + 1) % this.stride;
    return this.phase === 0;
  }
}
