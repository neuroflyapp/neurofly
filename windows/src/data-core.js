// data-core.js — reading, verifying and merging a fly model's data files,
// independent of where they come from. Node (data.js: Electron's main
// process, the tests, the tools) and the Android WebView
// (renderer/platform/web-data-worker.js) hand in their own file access, so
// every platform runs the same checks and builds the same bundle.

import { auditBrainCircuit } from './provenance.js';
import { validateLocomotorCircuit } from './locomotor.js';
import { SPECIMENS, specimenCompatibility } from './specimen.js';

// A path inside the data folder ('' parts are skipped: the mixed model's
// files sit at its top level).
const path = (...parts) => parts.filter(Boolean).join('/');

// The fly models the bundle can run. 'mixed': the female FlyWire FAFB brain
// with the male MaleCNS nerve cord, joined by a modelled population-rate
// interface (the original model). 'male': brain and nerve cord of one male
// animal, both from MaleCNS v1.0 (etl_malecns_brain.py writes data/male/), so
// the descending and ascending cells the two circuits share are the same cells.
export const FLY_MODELS = Object.freeze({
  mixed: { id: 'mixed', brain: 'fafb-v783', cord: 'malecns-v1', sex: 'mixed', dir: '' },
  // The male taste and grooming pathways carry whole-cell pair totals (FlyWire
  // splits a pair into neuropil rows) and concentrate their lateral synapses in
  // fewer pairs. Calibrated with pathwaytest's criteria (graded DNg12 response
  // to dust, sugar -> proboscis > 40 Hz with bitter suppression, release, no
  // latch after a hard relay kick), the same benchmark FlyWire's pathways
  // were tuned to: twice the forward weight, a tenth for lateral and backward
  // edges (grid of x1-x3 and 0.6-0.1 on 1 October 2026; x2 / 0.1 the only
  // setting passing every criterion with DNg12 in FlyWire's range).
  male: { id: 'male', brain: 'malecns-v1', cord: 'malecns-v1', sex: 'male', dir: 'male',
    pathwayCalibration: { weightScale: 2, recurrentFraction: 0.1 } },
  // Brain and cord of one female BANC v888 animal (etl_banc_adapter.py, then
  // etl_malecns_brain.py and etl_malecns.py; data/female holds circuit, cord
  // and the cord's own stepping decoder). BANC's brain reports ~140 synapses
  // per circuit neuron against FlyWire's ~521 and MaleCNS's ~456, while its
  // cord is close to MaleCNS's (545 vs 678 contacts per neuron). Its
  // looming-detector -> giant-fiber contacts total 930 synapses (MaleCNS
  // 11,198), so one global scale cannot restore the GF's input mix: unscaled
  // the GF answered an abrupt loom after 34 ms; scaled to equal mean load
  // (3.7) it also fired at rest (~1/s). With the GF threshold at 1.8 (FlyWire
  // 1.15, raised for the same reason: chance coincidences of its other
  // inputs) it stays silent over 20 s of rest on four seeds and answers an
  // abrupt loom after 8-12 ms (scan of scale 2.6-4.2 x threshold 1.15-2.5,
  // 1 October 2026). Her taste and grooming pathways carry the same low
  // counts, and BANC's 35 proboscis motor neurons include cells no sugar path
  // reaches in the extracted circuit (their population mean saturated near
  // 30 Hz while the reached cells fired 50-150 Hz). Scored with pathwaytest's
  // criteria over x3-x20 and recurrent 0.6-0: only fractions of 0.02-0.03
  // pass, at x12-x16 alike; at 0 bitter no longer halves the sugar response,
  // above 0.03 sugar stays under 40 Hz. x14 / 0.025: DNg12 0 / 13.5 / 20.8 Hz
  // at dust 0 / 0.3 / 1, proboscis 44 Hz on sugar, 17 with bitter, silent
  // after a hard relay kick. Her central neurons rest at 9.8 Hz (FlyWire 9.5,
  // MaleCNS 9.6), just under the 10 Hz arousal gate, which she then crossed
  // twice as often (10 vs 5 spontaneous flights in 3 x 90 s); her arousal is
  // read relative to FlyWire's resting level (x 9.5/9.8 = 0.97: 5 flights,
  // flying 3.2 % vs FlyWire 3.1 %). All four are calibrations of this
  // animal's model.
  female: { id: 'female', brain: 'banc-v888', cord: 'banc-v888', sex: 'female', dir: 'female', cordDir: 'female',
    synapseScale: 3.7, gfThreshold: 1.8, pathwayCalibration: { weightScale: 14, recurrentFraction: 0.025 }, arousalScale: 0.97 },
});

// The models whose brain files are present (io: see assembleBrainData).
export function availableModels(io) {
  return Object.values(FLY_MODELS).filter((m) => io.exists(path(m.dir, 'circuit.json')) && io.exists(path(m.dir, 'brain_points.json'))).map((m) => m.id);
}

// Reads, verifies and merges one fly model's files. `io` gives access to the
// data folder by relative path: exists(rel), read(rel) -> UTF-8 text and
// sha256(text) -> hex. Node (data.js) and the Android WebView
// (renderer/platform/web-data-worker.js) provide their own; the result is the
// same object either way.
export function assembleBrainData(io, { model = 'mixed', where = 'the data folder' } = {}) {
  const readData = (rel) => { const raw = io.read(rel); return { raw, value: JSON.parse(raw) }; };
  const fly = FLY_MODELS[model];
  if (!fly) throw new Error(`Unknown fly model: ${model}`);
  let pointsFile, circuitFile;
  try {
    pointsFile = readData(path(fly.dir, 'brain_points.json'));
    circuitFile = readData(path(fly.dir, 'circuit.json'));
  } catch (error) {
    // No readable bundle means no brain data — not a crash.
    console.warn(`Could not load the fly data in ${where}: ${error.message}`);
    return null;
  }
  const points = pointsFile.value, circuit = circuitFile.value;
  const rawPoints = pointsFile.raw, rawCircuit = circuitFile.raw;
  const audit = auditBrainCircuit(circuit);
  if (!audit.valid) {
    throw new Error(`Invalid brain circuit: ${audit.errors.slice(0, 3).join('; ')}`);
  }
  // Older bundles remain usable. A present but invalid nerve-cord dataset
  // is a load error, never a silent switch back to scripted locomotion.
  const cordDir = fly.cordDir ?? '';
  const locomotorPath = path(cordDir, 'locomotor_circuit.json');
  let locomotor = null;
  let rawLocomotor = '';
  if (io.exists(locomotorPath)) {
    try {
      ({ raw: rawLocomotor, value: locomotor } = readData(locomotorPath));
    } catch (error) {
      throw new Error(`Invalid locomotor dataset ${locomotorPath}: ${error.message}`);
    }
    if (!validateLocomotorCircuit(locomotor)) {
      throw new Error('Invalid locomotor circuit (MaleCNS or BANC nerve cord)');
    }
  }
  // A raw-file SHA-256 identifies the exact exported input bundle. It is not
  // used to authorize anything; it makes two recorded runs auditable even if
  // their human-readable source names are identical.
  const sha256 = (value) => io.sha256(value);
  const brainCircuitSHA256 = sha256(rawCircuit);
  const locomotorSHA256 = rawLocomotor ? sha256(rawLocomotor) : null;
  // Git may check the pretty-printed cord file out with CRLF line endings; the
  // decoder is locked to its content with LF endings, the published bytes.
  const locomotorContentSHA256 = rawLocomotor ? sha256(rawLocomotor.replace(/\r\n/g, '\n')) : null;
  const decoder = locomotor ? attachRhythmDecoder(io, cordDir, locomotor, locomotorContentSHA256, sha256) : { status: 'absent', sha256: null, summary: null };
  // The FlyWire annotation and extension files are keyed to FlyWire's
  // circuit.json; the male circuit carries its cell types and sensory groups
  // itself and has no extensions (yet).
  const notApplicable = { status: 'not-applicable', sha256: null, summary: null, sensoryGroupCounts: null };
  const flywire = fly.id === 'mixed';   // the FlyWire extension files belong to FlyWire's circuit.json
  if (fly.pathwayCalibration) circuit.pathwayCalibration = { ...fly.pathwayCalibration };
  if (fly.synapseScale) circuit.synapseScale = fly.synapseScale;
  if (fly.gfThreshold) circuit.gfThreshold = fly.gfThreshold;
  if (fly.arousalScale) circuit.arousalScale = fly.arousalScale;
  const annotation = flywire ? attachCellAnnotations(io, circuit, brainCircuitSHA256, sha256)
    : { ...notApplicable, status: 'embedded', sensoryGroupCounts: circuit.sensoryGroupCounts || null };
  // After the annotation: that one is keyed by circuit.json's own indices.
  const thermo = flywire ? attachThermoExtension(io, circuit, brainCircuitSHA256, sha256) : embeddedThermo(circuit);
  // After the thermo extension: its indices are part of what this one extends.
  const sensory = flywire ? attachSensoryExtension(io, thermo.circuit || circuit, brainCircuitSHA256, thermo.sha256, sha256) : embeddedSenses(circuit);
  const provenance = {
    flyModel: fly.id,
    specimens: {
      brain: SPECIMENS[fly.brain],
      nerveCord: locomotor ? SPECIMENS[fly.cord] : null,
      compatibility: locomotor ? specimenCompatibility(fly.brain, fly.cord) : null,
      body: { status: 'modeled', sex: fly.sex === 'mixed' ? 'unspecified' : fly.sex, measuredWholeAnimal: false },
    },
    brainPointsSHA256: sha256(rawPoints),
    brainCircuitSHA256,
    locomotorSHA256,
    locomotorContentSHA256,
    rhythmDecoderSHA256: decoder.sha256,
    rhythmDecoderStatus: decoder.status,
    rhythmDecoder: decoder.summary,
    annotationSHA256: annotation.sha256,
    annotationStatus: annotation.status,
    sensoryGroupCounts: annotation.sensoryGroupCounts,
    thermoExtensionSHA256: thermo.sha256,
    thermoExtensionStatus: thermo.status,
    thermoExtension: thermo.summary,
    sensoryExtensionSHA256: sensory.sha256,
    sensoryExtensionStatus: sensory.status,
    sensoryExtension: sensory.summary,
    // `brainAudit` describes circuit.json exactly as published (the file the
    // SHA-256 above identifies). The running circuit may be larger by the
    // extensions; `thermoExtension` and `sensoryExtension` say by how much.
    brainAudit: audit,
  };
  // Measured anatomy of the complete FlyWire brain (etl_pathways.mjs): how
  // directly aversive and thermal sensors reach integrative centres. Read for
  // the sentience criteria panel; nothing in the simulation depends on it.
  let pathways = null;
  if (io.exists('sentience_pathways.json')) {
    try { pathways = JSON.parse(io.read('sentience_pathways.json')); } catch { pathways = null; }
  }
  return { points, circuit: sensory.circuit || thermo.circuit || circuit, locomotor, provenance, pathways };
}

// The male bundle carries its heat, taste and grooming pathways inside its
// circuit.json (etl_malecns_brain.py); these summaries mirror the FlyWire
// extensions' so every panel and manifest reads them the same way.
function embeddedThermo(circuit) {
  const n = circuit.neurons, count = (pred) => n.filter(pred).length;
  const added = count((nr) => nr.extension === 'thermo');
  if (!added) return { status: 'absent', sha256: null, summary: null };
  return { status: 'embedded', sha256: null, summary: {
    addedNeurons: added, addedEdges: null,
    hotCells: count((nr) => nr.thermoGroup === 'hot'), coldCells: count((nr) => nr.thermoGroup === 'cold'),
    relayNeurons: count((nr) => nr.extension === 'thermo' && nr.layer === 1),
    runningNeurons: n.length, runningEdges: circuit.edges.length } };
}
function embeddedSenses(circuit) {
  const n = circuit.neurons, count = (pred) => n.filter(pred).length;
  const added = count((nr) => nr.extension === 'taste' || nr.extension === 'grooming');
  if (!added) return { status: 'absent', sha256: null, summary: null };
  return { status: 'embedded', sha256: null, summary: {
    addedNeurons: added, addedEdges: null,
    sugarCells: count((nr) => nr.sensoryGroup === 'sugar'), bitterCells: count((nr) => nr.sensoryGroup === 'bitter'),
    proboscisMotorNeurons: count((nr) => nr.motorGroup === 'proboscis'), ingestionMotorNeurons: count((nr) => nr.motorGroup === 'ingestion'),
    tasteRelays: count((nr) => nr.extension === 'taste' && nr.pathRole),
    joFCells: count((nr) => nr.sensoryGroup === 'jof'), dng12: count((nr) => nr.motorGroup === 'dng12'),
    groomingRelays: count((nr) => nr.extension === 'grooming' && nr.pathRole),
    taggedInRunningCircuit: count((nr) => !!nr.extensionTag), runningNeurons: n.length } };
}

// Optional real gustatory and antennal-grooming pathways
// (etl_sensory_extension.mjs): sugar/water and bitter receptor neurons, the
// proboscis and ingestion motor neurons, JO-F grooming mechanosensors, DNg12,
// and the neurons on the strongest paths between them. Appended after the
// thermo extension, and accepted only for exactly that circuit.json and
// thermo_extension.json; the merged result must pass the structural audit.
function attachSensoryExtension(io, running, circuitSHA256, thermoSHA256, sha256) {
  const file = 'sensory_extension.json';
  const none = (status, hash = null) => ({ status, sha256: hash, summary: null });
  if (!io.exists(file)) return none('absent');
  let raw, ext;
  try {
    raw = io.read(file);
    ext = JSON.parse(raw);
  } catch (error) {
    console.warn(`sensory_extension.json unreadable, ignored: ${error.message}`);
    return none('unreadable');
  }
  const hash = sha256(raw);
  if (ext.circuitSHA256 !== circuitSHA256 || ext.thermoExtensionSHA256 !== thermoSHA256
    || ext.baseNeurons !== running.neurons.length) {
    console.warn('sensory_extension.json was generated for a different circuit/thermo extension; ignored — rerun etl_sensory_extension.mjs');
    return none('stale', hash);
  }
  const tags = Array.isArray(ext.circuitTags) ? ext.circuitTags : [];
  if (!tags.every((t) => String(running.neurons[t.index]?.id) === String(t.id))) {
    console.warn('sensory_extension.json tags do not line up with the running circuit; ignored');
    return none('misaligned', hash);
  }
  const merged = {
    ...running,
    neurons: running.neurons.concat(ext.neurons || []),
    edges: running.edges.concat(ext.edges || []),
  };
  const audit = auditBrainCircuit(merged);
  if (!audit.valid) {
    console.warn(`sensory_extension.json fails the structural audit, ignored: ${audit.errors.slice(0, 2).join('; ')}`);
    return none('invalid', hash);
  }
  for (const t of tags) {
    const tag = { extension: t.extension };
    for (const f of ['sensoryGroup', 'motorGroup', 'pathRole']) if (t[f]) tag[f] = t[f];
    running.neurons[t.index].extensionTag = tag;
  }
  const added = ext.neurons || [];
  const count = (pred) => added.filter(pred).length;
  const summary = {
    addedNeurons: added.length,
    addedEdges: (ext.edges || []).length,
    sugarCells: count((nr) => nr.sensoryGroup === 'sugar'),
    bitterCells: count((nr) => nr.sensoryGroup === 'bitter'),
    proboscisMotorNeurons: count((nr) => nr.motorGroup === 'proboscis'),
    ingestionMotorNeurons: count((nr) => nr.motorGroup === 'ingestion'),
    tasteRelays: count((nr) => nr.extension === 'taste' && nr.pathRole),
    joFCells: count((nr) => nr.sensoryGroup === 'jof'),
    dng12: count((nr) => nr.motorGroup === 'dng12'),
    groomingRelays: count((nr) => nr.extension === 'grooming' && nr.pathRole),
    taggedInRunningCircuit: tags.length,
    runningNeurons: merged.neurons.length,
    runningEdges: merged.edges.length,
  };
  return { status: 'attached', sha256: hash, summary, circuit: merged };
}

// Optional real thermosensory extension (etl_thermo_extension.mjs): FlyWire's
// hot and cold cells plus the layer of neurons carrying their strongest
// two-synapse paths into the circuit. Appended after circuit.json's neurons,
// so every existing index, and every baseline drawn from the seeded PRNG for
// them, is unchanged. Accepted only for this exact circuit.json; the merged
// result must pass the same structural audit, or nothing is merged.
function attachThermoExtension(io, circuit, circuitSHA256, sha256) {
  const file = 'thermo_extension.json';
  const none = (status, hash = null) => ({ status, sha256: hash, summary: null });
  if (!io.exists(file)) return none('absent');
  let raw, ext;
  try {
    raw = io.read(file);
    ext = JSON.parse(raw);
  } catch (error) {
    console.warn(`thermo_extension.json unreadable, ignored: ${error.message}`);
    return none('unreadable');
  }
  const hash = sha256(raw);
  if (ext.circuitSHA256 !== circuitSHA256 || ext.baseNeurons !== circuit.neurons.length) {
    console.warn('thermo_extension.json was generated for a different circuit.json; ignored — rerun etl_thermo_extension.mjs');
    return none('stale', hash);
  }
  const tags = Array.isArray(ext.circuitTags) ? ext.circuitTags : [];
  if (!tags.every((t) => String(circuit.neurons[t.index]?.id) === String(t.id))) {
    console.warn('thermo_extension.json circuit tags do not line up with circuit.json; ignored');
    return none('misaligned', hash);
  }
  const merged = {
    ...circuit,
    neurons: circuit.neurons.concat(ext.neurons || []),
    edges: circuit.edges.concat(ext.edges || []),
  };
  const audit = auditBrainCircuit(merged);
  if (!audit.valid) {
    console.warn(`thermo_extension.json fails the structural audit, ignored: ${audit.errors.slice(0, 2).join('; ')}`);
    return none('invalid', hash);
  }
  for (const t of tags) circuit.neurons[t.index].thermoGroup = t.thermoGroup;
  // A new object, never circuit.json's mutated in place: audits are cached
  // per object, and the published circuit's audit must stay its own.
  const added = ext.neurons || [];
  const summary = {
    addedNeurons: added.length,
    addedEdges: (ext.edges || []).length,
    hotCells: added.filter((nr) => nr.thermoGroup === 'hot').length + tags.filter((t) => t.thermoGroup === 'hot').length,
    coldCells: added.filter((nr) => nr.thermoGroup === 'cold').length + tags.filter((t) => t.thermoGroup === 'cold').length,
    relayNeurons: added.filter((nr) => nr.layer === 1).length,
    runningNeurons: merged.neurons.length,
    runningEdges: merged.edges.length,
  };
  return { status: 'attached', sha256: hash, summary, circuit: merged };
}

// Optional real FlyWire cell types (etl_cell_annotations.mjs). Merged onto the
// neuron objects as `cellType` and, for sensory partners, `sensoryGroup`.
// It is keyed by circuit index, so it is only accepted when it was generated
// against this exact circuit.json AND every row's FlyWire id matches — a
// stale annotation would otherwise attach cell types to the wrong neurons,
// which is worse than having none. Absent or rejected, the model falls back
// to treating all sensory partners as one population, and says so.
// The stepping rules' premotor decoder (tools/derive-rhythm-decoder.mjs):
// derived from this exact nerve-cord file, so a decoder for any other file is
// ignored and the cord runs without stepping rules — never with a mismatch.
function attachRhythmDecoder(io, dir, locomotor, locomotorContentSHA256, sha256) {
  const file = path(dir, 'rhythm_decoder.json');
  if (!io.exists(file)) return { status: 'absent', sha256: null, summary: null };
  let raw, decoder;
  try {
    raw = io.read(file);
    decoder = JSON.parse(raw);
  } catch (error) {
    console.warn(`rhythm_decoder.json unreadable, ignored: ${error.message}`);
    return { status: 'unreadable', sha256: null, summary: null };
  }
  if (decoder.locomotorContentSHA256 !== locomotorContentSHA256) {
    console.warn('rhythm_decoder.json was derived for a different locomotor_circuit.json; ignored — rerun tools/derive-rhythm-decoder.mjs');
    return { status: 'stale', sha256: sha256(raw), summary: null };
  }
  locomotor.rhythmDecoder = decoder;
  return { status: 'attached', sha256: sha256(raw), summary: decoder.summary || null };
}

function attachCellAnnotations(io, circuit, circuitSHA256, sha256) {
  const file = 'circuit_annotations.json';
  if (!io.exists(file)) return { status: 'absent', sha256: null, sensoryGroupCounts: null };
  let raw, ann;
  try {
    raw = io.read(file);
    ann = JSON.parse(raw);
  } catch (error) {
    console.warn(`circuit_annotations.json unreadable, ignored: ${error.message}`);
    return { status: 'unreadable', sha256: null, sensoryGroupCounts: null };
  }
  if (ann.circuitSHA256 !== circuitSHA256) {
    console.warn('circuit_annotations.json was generated for a different circuit.json; ignored — rerun etl_cell_annotations.mjs');
    return { status: 'stale', sha256: sha256(raw), sensoryGroupCounts: null };
  }
  const rows = Array.isArray(ann.neurons) ? ann.neurons : [];
  const idsMatch = rows.length === circuit.neurons.length
    && rows.every((r, i) => r.index === i && String(circuit.neurons[i].id) === r.id);
  if (!idsMatch) {
    console.warn('circuit_annotations.json does not line up with circuit.json neuron ids; ignored');
    return { status: 'misaligned', sha256: sha256(raw), sensoryGroupCounts: null };
  }
  rows.forEach((r, i) => {
    const neuron = circuit.neurons[i];
    if (r.primaryType) neuron.cellType = r.primaryType;
    if (r.sensoryGroup) neuron.sensoryGroup = r.sensoryGroup;
  });
  return { status: 'attached', sha256: sha256(raw), sensoryGroupCounts: ann.sensoryGroupCounts || null };
}
