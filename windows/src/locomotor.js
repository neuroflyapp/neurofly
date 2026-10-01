// locomotor.js — the MaleCNS v1.0 nerve cord, as a network of leaky
// integrate-and-fire cells driven by the brain's descending neurons and by the
// legs' own sense organs, ending in the leg muscles' motor commands.
//
// Measured: the cells, their roles and legs, and the synapse counts between
// them. Modelled: the cell dynamics, how synapse counts become currents, how
// firing rates carry over from the (female) brain to this (male) cord, how the
// sense organs respond to joint angles and loads, and how motor-pool rates
// become muscle activation.
import { LegDynamics, makeLegMotorCommand } from './legdynamics.js';
import { LegStepper, JOINT_AXES, LEG_NAMES } from './rhythm.js';

// Cord parameters a rhythm decoder was derived with; a decoder derived with
// other values is refused (tools/derive-rhythm-decoder.mjs).
export const DECODER_MODEL_KEYS = Object.freeze(['synapticGain', 'baseline', 'adaptationKick']);

// Every leg needs these four motor pools for the cord to be usable.
const REQUIRED_POOLS = ['tibia_flexor', 'tibia_extensor', 'trochanter_flexor', 'trochanter_extensor'];

// Per-millisecond decay factors, exp(-1 ms / tau): excitatory current 5 ms,
// inhibitory current and rate estimate 10 ms, membrane 20 ms, adaptation 200 ms.
const DECAY_EXCITATORY = 0.8187308;
const DECAY_INHIBITORY = 0.9048374;
const DECAY_RATE = 0.9048374;
const DECAY_MEMBRANE = 0.9512294;
const DECAY_ADAPTATION = 0.9950125;
// A spike adds this to the cell's rate estimate (Hz); with the 10 ms decay a
// cell firing steadily at f Hz reads about f.
const RATE_PER_SPIKE = 95.16258;
const REFRACTORY_MS = 2;

// Arrays of per-cell state, all cleared by reset().
const CELL_STATE = ['voltage', 'adaptation', 'rates', 'excitatory', 'inhibitory', 'nextExcitatory', 'nextInhibitory',
  'drive', 'sensoryDrive', 'rhythmDrive'];

// Role codes for the spike counters, and the three kinds of leg sense organ.
const ROLE_OTHER = 0, ROLE_MOTOR = 1, ROLE_SENSORY = 2;
const SENSE_LOAD = 0, SENSE_HAIR_PLATE = 1, SENSE_OTHER = 2;

// Muscle actions from motor pools: each action takes the stronger of its pools.
const ACTION_POOLS = [
  ['protract', ['coxa_promotor', 'coxa_anterior_rotator']],
  ['retract', ['coxa_remotor', 'coxa_posterior_rotator']],
  ['lift', ['trochanter_flexor']],
  ['depress', ['trochanter_extensor']],
  ['flex', ['tibia_flexor']],
  ['extend', ['tibia_extensor']],
];

export function validateLocomotorCircuit(circuit) {
  const neurons = circuit?.neurons, edges = circuit?.edges;
  if (!Array.isArray(neurons) || neurons.length === 0 || !Array.isArray(edges) || edges.length === 0) return false;
  // This loader is specifically for the native male cord. A different animal
  // cannot become this circuit just by having six motor-pool labels.
  if (circuit.schemaVersion !== 1 || circuit.provenance?.dataset !== 'MaleCNS v1.0'
    || circuit.provenance?.specimen !== 'male Drosophila melanogaster'
    || !Array.isArray(circuit.legOrder) || circuit.legOrder.join(',') !== 'RF,LF,RM,LM,RH,LH') return false;
  const contacts = circuit.rawSynapseCounts;
  if (!Array.isArray(contacts) || contacts.length !== edges.length) return false;
  const ids = new Set();
  const roles = new Set(['descending', 'premotor', 'motor', 'sensory', 'ascending']);
  const pools = Array.from({ length: 6 }, () => new Set());
  for (const nr of neurons) {
    if (!nr || typeof nr.id !== 'string' || !/^[1-9]\d{0,23}$/.test(nr.id) || !roles.has(nr.role)) return false;
    ids.add(nr.id);
    if (nr.leg !== null && nr.leg !== undefined && !(Number.isInteger(nr.leg) && nr.leg >= 0 && nr.leg < 6)) return false;
    if (nr.role === 'motor') {
      if (!Number.isInteger(nr.leg) || typeof nr.motorChannel !== 'string') return false;
      pools[nr.leg].add(nr.motorChannel);
    }
  }
  if (ids.size !== neurons.length) return false;
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < neurons.length;
  const pairs = new Set();
  const signByTransmitter = { acetylcholine: 1, gaba: -1, glutamate: -1 };
  let totalContacts = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i], raw = contacts[i];
    if (!Array.isArray(e) || e.length !== 3) return false;
    if (!inRange(e[0]) || !inRange(e[1]) || !Number.isSafeInteger(e[2]) || !Number.isSafeInteger(raw) || raw <= 0) return false;
    // Zero-current unknown/modulatory edges retain their measured contacts.
    if (e[2] !== 0 && Math.abs(e[2]) !== raw) return false;
    const transmitter = neurons[e[0]].neurotransmitter?.consensus_nt;
    const sign = Object.hasOwn(signByTransmitter, transmitter) ? signByTransmitter[transmitter] : 0;
    if (e[2] !== raw * sign) return false;
    const pair = `${e[0]}:${e[1]}`;
    if (pairs.has(pair)) return false;
    pairs.add(pair);
    totalContacts += raw;
  }
  if (!Number.isSafeInteger(totalContacts)) return false;
  if (circuit.summary && (circuit.summary.neurons !== neurons.length || circuit.summary.edges !== edges.length
    || circuit.summary.contacts !== totalContacts)) return false;
  for (let leg = 0; leg < 6; leg++) {
    for (const pool of REQUIRED_POOLS) {
      if (!pools[leg].has(pool)) return false;
    }
  }
  return true;
}

function poolActivation(rates, cells) {
  let sum = 0;
  for (let k = 0; k < cells.length; k++) sum += rates[cells[k]];
  const r = sum / Math.max(1, cells.length);
  return r / (r + 50);
}

export class LocomotorSim {
  constructor(circuit, parameters = {}) {
    // rhythm: false switches the stepping rules off (rhythm.js; otherwise
    // their parameter overrides). rhythmGain scales the decoder's drive onto
    // premotor cells per unit of joint-axis demand; rhythmCap bounds it.
    this.parameters = { synapticGain: 2.4, baseline: 0.022, adaptationKick: 0.01,
      rhythm: {}, rhythmGain: 0.2, rhythmCap: 0.4, ...parameters };
    if (!validateLocomotorCircuit(circuit)) throw new Error('Invalid MaleCNS locomotor circuit');
    this.circuit = circuit;
    const n = this.n = circuit.neurons.length;
    for (const name of CELL_STATE) this[name] = new Float64Array(n);
    this.refractory = new Int32Array(n);
    this.dnRates = new Map();          // `${type}:${side}` -> rate (Hz) from the brain
    this.commandGroups = new Map();    // descending cells by `${type}:${side}`
    this.motorGroups = [];             // per leg: motor channel -> cells
    for (let leg = 0; leg < 6; leg++) this.motorGroups.push(new Map());
    this.sensory = [];
    this.commands = [];
    for (let leg = 0; leg < 6; leg++) this.commands.push(makeLegMotorCommand());
    Object.assign(this, { totalSpikes: 0, motorSpikes: 0, sensorySpikes: 0, simMs: 0 });
    // Experimenter controls: leg feedback in, silenced cells, synapses and proprioception on or off.
    Object.assign(this, { feedback: [], silenced: new Set(), synapsesEnabled: true, feedbackEnabled: true });
    this._buildSynapses(circuit.edges);
    this._classifyCells(circuit.neurons);
    this._indexCache = new Map();
    // Stepping rules (rhythm.js) reach the cord only through a decoder derived
    // for exactly this dataset and cord model (data/rhythm_decoder.json).
    this.rhythmDecoder = this.parameters.rhythm === false ? null : this._buildDecoder(circuit.rhythmDecoder);
    this.stepper = this.rhythmDecoder ? new LegStepper(this.parameters.rhythm) : null;
  }

  // Outgoing synapses per presynaptic cell (compressed rows). Synapse counts
  // are kept relative, with their transmitter sign, and each target's inputs
  // are normalised by its total input count (at least 60): counts are not
  // conductances.
  _buildSynapses(edges) {
    const n = this.n;
    const outDegree = new Int32Array(n), inputCount = new Float64Array(n);
    for (const [pre, post, count] of edges) {
      outDegree[pre]++;
      inputCount[post] += Math.abs(count);
    }
    this.rowStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.rowStart[i + 1] = this.rowStart[i] + outDegree[i];
    this.targets = new Int32Array(edges.length);
    this.weights = new Float64Array(edges.length);
    const cursor = Int32Array.from(this.rowStart);
    const gain = this.parameters.synapticGain;
    for (const [pre, post, count] of edges) {
      const slot = cursor[pre]++;
      this.targets[slot] = post;
      this.weights[slot] = gain * count / Math.max(60, inputCount[post]);
    }
  }

  // Cell groups, and per-cell codes the per-millisecond loops read instead of
  // the neuron records' strings.
  _classifyCells(neurons) {
    const group = (map, key, i) => {
      const list = map.get(key);
      if (list) list.push(i); else map.set(key, [i]);
    };
    this.sensoryLeg = new Int8Array(this.n).fill(-1);
    this.sensoryKindCode = new Uint8Array(this.n);
    for (let i = 0; i < neurons.length; i++) {
      const nr = neurons[i];
      if (nr.role === 'descending') group(this.commandGroups, `${nr.type}:${nr.side}`, i);
      if (nr.role === 'sensory' && nr.leg != null) {
        this.sensory.push(i);
        this.sensoryLeg[i] = nr.leg;
        this.sensoryKindCode[i] = nr.sensoryKind === 'campaniform' || nr.sensoryKind === 'contact' ? SENSE_LOAD
          : nr.sensoryKind === 'hair_plate' ? SENSE_HAIR_PLATE : SENSE_OTHER;
      }
      if (nr.role === 'motor' && nr.leg != null && nr.motorChannel) group(this.motorGroups[nr.leg], nr.motorChannel, i);
    }
    this.sensory = Int32Array.from(this.sensory);
    this.roleCode = Uint8Array.from(neurons, (nr) => (nr.role === 'motor' ? ROLE_MOTOR : nr.role === 'sensory' ? ROLE_SENSORY : ROLE_OTHER));
    // Per leg and muscle action, the motor pools (cell lists in their original
    // order) whose activation drives it, so updateMotorCommands() needs no
    // string lookups.
    this._actionPools = this.motorGroups.map((pools) =>
      ACTION_POOLS.map(([, names]) => names.map((name) => Int32Array.from(pools.get(name) || []))));
  }

  // Decoder slots: (leg * 3 + axis) * 2 + (direction > 0 ? 0 : 1), each the
  // premotor cells and their drive per unit of demand.
  _buildDecoder(decoder) {
    if (!decoder || decoder.schema !== 'neurofly-rhythm-decoder-1' || !Array.isArray(decoder.decoders)) return null;
    for (const key of DECODER_MODEL_KEYS) {
      if (decoder.model?.[key] !== this.parameters[key]) {
        console.warn(`rhythm decoder derived with ${key}=${decoder.model?.[key]}, cord runs ${this.parameters[key]}: stepping rules off`);
        return null;
      }
    }
    const index = new Map(this.circuit.neurons.map((nr, i) => [String(nr.id), i]));
    const slots = Array.from({ length: 6 * JOINT_AXES.length * 2 }, () => null);
    const touched = new Set();
    for (const d of decoder.decoders) {
      const leg = LEG_NAMES.indexOf(d.leg), axis = JOINT_AXES.indexOf(d.axis);
      if (leg < 0 || axis < 0 || (d.direction !== 1 && d.direction !== -1) || !Array.isArray(d.cells)) return null;
      const cells = [], weights = [];
      for (const [id, weight] of d.cells) {
        const i = index.get(String(id));
        if (i === undefined || this.circuit.neurons[i].role !== 'premotor' || !Number.isFinite(weight)) return null;
        cells.push(i); weights.push(weight); touched.add(i);
      }
      slots[(leg * JOINT_AXES.length + axis) * 2 + (d.direction > 0 ? 0 : 1)] = [Int32Array.from(cells), Float64Array.from(weights)];
    }
    if (slots.some((slot) => !slot)) return null;
    return { slots, touched: Int32Array.from(touched) };
  }

  _dn(type, side) { return this.dnRates.get(`${type}:${side}`) || 0; }

  // Back to rest with the same anatomy: a fresh trial for the same cord.
  reset() {
    for (const name of CELL_STATE) this[name].fill(0);
    this.refractory.fill(0);
    this.dnRates.clear();
    this.stepper?.reset();
    this.commands = [];
    for (let leg = 0; leg < 6; leg++) this.commands.push(makeLegMotorCommand());
    this.totalSpikes = 0; this.motorSpikes = 0; this.sensorySpikes = 0; this.simMs = 0;
  }

  setDescending(type, side, rate) { this.setDescendingKey(`${type}:${side}`, rate); }

  // The brain calls this every simulated millisecond with a fixed key per
  // descending group (no key string built per call). Rate transfer between
  // specimens: 0.004 of drive per Hz, at most 0.35.
  setDescendingKey(key, rate) {
    this.dnRates.set(key, rate);
    const cells = this.commandGroups.get(key);
    if (!cells) return;
    const value = Math.min(0.35, Math.max(0, rate) * 0.004);
    for (let q = 0; q < cells.length; q++) this.drive[cells[q]] = value;
  }

  // Cells with this role (and on this leg, if given), in circuit order.
  indices(role, leg = null) {
    const out = [];
    const neurons = this.circuit.neurons;
    for (let i = 0; i < neurons.length; i++) {
      if (neurons[i].role === role && (leg === null || neurons[i].leg === leg)) out.push(i);
    }
    return out;
  }

  meanRate(role, leg = null) {
    const key = `${role}:${leg}`;
    let cells = this._indexCache.get(key);
    if (!cells) { cells = Int32Array.from(this.indices(role, leg)); this._indexCache.set(key, cells); }
    let sum = 0;
    for (let k = 0; k < cells.length; k++) sum += this.rates[cells[k]];
    return sum / Math.max(1, cells.length);
  }

  // One millisecond of stepping: descending rates and leg proprioception in,
  // drive onto the decoder's premotor cells out.
  _rhythmStep() {
    const stepper = this.stepper, dn = (key) => this.dnRates.get(key) || 0;
    stepper.update({
      forward: (dn('DNp09:left') + dn('DNp09:right')) / 2,
      backward: (dn('MDN:left') + dn('MDN:right')) / 2,
      steerLeft: (dn('DNa01:left') + dn('DNa02:left')) / 2,
      steerRight: (dn('DNa01:right') + dn('DNa02:right')) / 2,
    });
    const drive = this.rhythmDrive, { slots, touched } = this.rhythmDecoder;
    for (let q = 0; q < touched.length; q++) drive[touched[q]] = 0;
    const demand = stepper.step(this.feedbackEnabled ? this.feedback : null);
    if (!demand) return;
    const gain = this.parameters.rhythmGain, cap = this.parameters.rhythmCap;
    for (let k = 0; k < demand.length; k++) {
      const value = demand[k];
      if (value === 0) continue;
      const [cells, weights] = slots[k * 2 + (value > 0 ? 0 : 1)];
      const scale = Math.abs(value) * gain;
      for (let q = 0; q < cells.length; q++) drive[cells[q]] += scale * weights[q];
    }
    for (let q = 0; q < touched.length; q++) {
      const i = touched[q];
      drive[i] = Math.max(-cap, Math.min(cap, drive[i]));
    }
  }

  // The leg sense organs this millisecond (modelled transduction): load
  // sensors report ground load, hair plates the hip's excursion and the
  // elevation rate, the others knee and hip movement and the knee's bend.
  _senseLegs() {
    const sensory = this.sensory, drive = this.sensoryDrive;
    for (let q = 0; q < sensory.length; q++) drive[sensory[q]] = 0;
    const legs = this.feedback;
    if (!this.feedbackEnabled || legs.length !== 6) return;
    const hipLimit = LegDynamics.hipLimit, restKnee = LegDynamics.restKnee;
    const legOf = this.sensoryLeg, kindOf = this.sensoryKindCode;
    for (let q = 0; q < sensory.length; q++) {
      const i = sensory[q];
      const f = legs[legOf[i]];
      let level;
      switch (kindOf[i]) {
        case SENSE_LOAD: level = f.contact ? Math.min(1, f.load * 6) : 0; break;
        case SENSE_HAIR_PLATE: level = Math.min(1, Math.abs(f.hipAngle) / hipLimit + Math.abs(f.elevationVelocity) / 20); break;
        default: level = Math.min(1, Math.abs(f.kneeVelocity) / 20 + Math.abs(f.hipVelocity) / 16 + Math.abs(f.kneeAngle - restKnee) * 0.35);
      }
      drive[i] = level * 0.10;
    }
  }

  // `commands` false leaves the leg motor commands to a later
  // updateMotorCommands(): LIFSim steps the cord one millisecond at a time but
  // the body reads the commands only once its whole step is done.
  step(ms, commands = true) {
    if (!(ms > 0)) return;
    const n = this.n, baseline = this.parameters.baseline, kick = this.parameters.adaptationKick;
    const voltage = this.voltage, adaptation = this.adaptation, rates = this.rates, refractory = this.refractory;
    const exc = this.excitatory, inh = this.inhibitory, excNext = this.nextExcitatory, inhNext = this.nextInhibitory;
    const drive = this.drive, sensed = this.sensoryDrive, rhythm = this.rhythmDrive;
    const roleCode = this.roleCode, rowStart = this.rowStart, targets = this.targets, weights = this.weights;
    const silenced = this.silenced, synapses = this.synapsesEnabled;
    for (let t = 0; t < ms; t++) {
      this.simMs++;
      if (this.stepper) this._rhythmStep();
      this._senseLegs();
      // Synaptic currents: last millisecond's spikes arrive, old current decays.
      for (let i = 0; i < n; i++) {
        exc[i] = exc[i] * DECAY_EXCITATORY + excNext[i];
        inh[i] = inh[i] * DECAY_INHIBITORY + inhNext[i];
        excNext[i] = 0; inhNext[i] = 0;
      }
      const anySilenced = silenced.size > 0;
      for (let i = 0; i < n; i++) {
        rates[i] *= DECAY_RATE;
        adaptation[i] *= DECAY_ADAPTATION;
        if (anySilenced && silenced.has(i)) { voltage[i] = 0; rates[i] = 0; continue; }
        if (refractory[i] > 0) { refractory[i]--; continue; }
        voltage[i] = Math.max(-1, voltage[i] * DECAY_MEMBRANE + exc[i] + inh[i]
          + baseline + drive[i] + sensed[i] + rhythm[i] - adaptation[i]);
        if (!(voltage[i] >= 1)) continue;   // (NaN never fires)
        voltage[i] = 0; refractory[i] = REFRACTORY_MS;
        adaptation[i] += kick;
        rates[i] += RATE_PER_SPIKE;
        this.totalSpikes++;
        if (roleCode[i] === ROLE_MOTOR) this.motorSpikes++;
        else if (roleCode[i] === ROLE_SENSORY) this.sensorySpikes++;
        if (!synapses) continue;
        for (let e = rowStart[i], end = rowStart[i + 1]; e < end; e++) {
          const w = weights[e];
          if (w >= 0) excNext[targets[e]] += w;
          else inhNext[targets[e]] += w;
        }
      }
    }
    if (commands) this.updateMotorCommands();
  }

  // Muscle activation per leg: a pool's mean rate r becomes r / (r + 50)
  // (half activation at 50 Hz); an action takes its strongest pool.
  updateMotorCommands() {
    const rates = this.rates;
    for (let leg = 0; leg < 6; leg++) {
      const actions = this._actionPools[leg];
      const command = {};
      for (let a = 0; a < ACTION_POOLS.length; a++) {
        const pools = actions[a];
        let level = poolActivation(rates, pools[0]);
        for (let k = 1; k < pools.length; k++) level = Math.max(level, poolActivation(rates, pools[k]));
        command[ACTION_POOLS[a][0]] = level;
      }
      this.commands[leg] = command;
    }
  }
}
