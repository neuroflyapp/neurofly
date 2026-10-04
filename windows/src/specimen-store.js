// specimen-store.js — the anatomy explorer's bundles: fixed catalog paths,
// hash-bound generated assets, no arbitrary paths or downloads controlled by
// the page. Platform-neutral: Node (specimen-data.js, in Electron a worker
// thread of the main process) and the Android WebView (a web worker) hand in
// their own file access.
import { SPECIMENS, validateSpecimenBundle } from './specimen.js';
import { indexSpecimen, findSpecimenPath } from './specimen-graph.js';
import { RESEARCH_COVERAGE } from './research-coverage.js';
import { validateRawSourceAudit } from './raw-source-audit.js';

// `io` reads the connectome asset folder by relative path: exists(rel),
// size(rel) -> bytes (throws when absent), readBytes(rel) -> Uint8Array,
// readText(rel) and sha256(bytes) -> hex. Node (specimen-data.js) and the
// Android WebView (renderer/platform/web-specimen-worker.js) supply their own.
export function createSpecimenStoreWith(io) {
  const parse = (bytes) => JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  const cache = new Map();
  let morphology = null;
  let graph = null;
  function readCatalog() {
    try { return JSON.parse(io.readText('catalog.json')); }
    catch { return { profiles: [], files: [], checkedAt: null }; }
  }
  function checked(id, sha256) {
    const bundle = store.load(id);
    if (bundle.sha256 !== sha256) throw new Error('Anatomy changed on disk; reload the specimen before querying');
    if (graph?.bundle !== bundle) graph = { bundle, index: indexSpecimen(bundle) };
    return graph;
  }
  const store = {
    catalog() {
      const raw = readCatalog();
      let archive = null;
      let publicSources = null;
      let rawSources = null;
      try {
        const file = 'research-inventory.json';
        if (io.size(file) < 4 * 1024 ** 2) archive = parse(io.readBytes(file));
      } catch { /* optional bulk archive, never necessary for simulation */ }
      try {
        const file = 'public-source-summary.json';
        if (io.size(file) < 1024 ** 2) publicSources = parse(io.readBytes(file));
      } catch { /* optional publisher audit */ }
      try {
        const file = 'raw-source-audit.json';
        if (io.size(file) < 1024 ** 2) rawSources = validateRawSourceAudit(parse(io.readBytes(file)));
      } catch { /* optional offline integrity snapshot; never load raw tables here */ }
      return { checkedAt: raw.checkedAt, files: raw.files || [], morphology: raw.morphology || null,
        archive, publicSources, rawSources, coverage: RESEARCH_COVERAGE,
        currentRuntime: { brain: 'fafb-v783', cord: 'malecns-v1', status: 'cross-specimen-model' },
        profiles: ['banc-v888', 'malecns-v1', 'manc-v1.0', 'fafb-v783', 'optic-lobe-v1.1', 'hemibrain-v1.2', 'l1em-winding-2023'].map(id => {
          const published = raw.profiles?.find(p => p.id === id);
          return { ...SPECIMENS[id], ...published, runtimeReady: false,
            status: published?.sha256 && io.exists(`${id}.json`) ? 'anatomy-ready' : 'not-imported' };
        }) };
    },
    load(id) {
      if (!Object.hasOwn(SPECIMENS, id)) throw new Error('Unknown specimen');
      const entry = readCatalog().profiles?.find(p => p.id === id);
      if (!entry?.sha256) throw new Error('Specimen has not been imported');
      if (cache.get(id)?.sha256 === entry.sha256) return cache.get(id).bundle;
      const file = `${id}.json`;
      if (io.size(file) > 80 * 1024 ** 2) throw new Error('Specimen bundle exceeds safe size');
      const raw = io.readBytes(file);
      if (io.sha256(raw) !== entry.sha256) throw new Error('Specimen checksum mismatch: reimport source data');
      const bundle = parse(raw);
      if (bundle.profile?.id !== id) throw new Error('Specimen file contains the wrong animal');
      const audit = validateSpecimenBundle(bundle);
      if (!audit.valid) throw new Error(audit.errors.join('; '));
      bundle.sha256 = entry.sha256;
      cache.clear(); // one anatomy bundle in memory; switching never grows unbounded
      graph = null;
      cache.set(id, { sha256: entry.sha256, bundle });
      return bundle;
    },
    overview(id) {
      const { edges, neurons, ...metadata } = store.load(id);
      // No hundreds of thousands of edge arrays or original annotation objects
      // are copied into main/preload/renderer. Details load for one cell only.
      return { ...metadata, edgeCount: edges.length, neurons: neurons.map(({ annotations, ...n }) => n) };
    },
    cell(id, neuron, sha256) {
      const { bundle, index } = checked(id, sha256);
      const i = index.byId.get(neuron);
      if (i === undefined) throw new Error('Neuron is not in this specimen subset');
      return { profileId: id, sha256, neuron: bundle.neurons[i], incoming: index.incoming[i], outgoing: index.outgoing[i] };
    },
    path(id, query, sha256) {
      const { bundle, index } = checked(id, sha256);
      return findSpecimenPath(bundle, index, query);
    },
    morphology(id, profileId = 'fafb-v783') {
      if (typeof id !== 'string' || !/^\d{1,24}$/.test(id)) throw new Error('Invalid neuron ID');
      if (!Object.hasOwn(SPECIMENS, profileId)) throw new Error('Unknown morphology specimen');
      const prefix = { 'fafb-v783': 'fafb', 'malecns-v1': 'malecns', 'manc-v1.0': 'manc', 'banc-v888': 'banc', 'optic-lobe-v1.1': 'optic-lobe', 'hemibrain-v1.2': 'hemibrain', 'l1em-winding-2023': 'l1em-winding-2023' }[profileId];
      const specimen = SPECIMENS[profileId].specimen;
      const expected = (profileId === 'fafb-v783' ? readCatalog().morphology : readCatalog().morphologies?.[profileId])?.sha256;
      if (!expected) return null;
      if (morphology?.sha256 !== expected || morphology?.profileId !== profileId) {
        const file = `${prefix}-morphology.json`;
        if (io.size(file) > 80 * 1024 ** 2) throw new Error('Morphology asset exceeds size limit');
        const raw = io.readBytes(file);
        if (io.sha256(raw) !== expected) throw new Error('Morphology checksum mismatch');
        const parsed = parse(raw);
        if (parsed.specimen !== specimen) throw new Error('Morphology belongs to another specimen');
        morphology = { sha256: expected, profileId, schema: parsed.schema, neurons: parsed.neurons };
      }
      const entry = morphology.neurons[id];
      if (!entry) return null;
      let neuron = entry;
      if (morphology.schema === 2) {
        // File path is derived solely from a checked decimal ID, never from JSON.
        const file = `${profileId === 'fafb-v783' ? 'morphology' : `${prefix}-morphology`}/${id}.json`;
        if (io.size(file) > 8 * 1024 ** 2) throw new Error('Cell morphology exceeds size limit');
        const raw = io.readBytes(file);
        if (io.sha256(raw) !== entry.sha256) throw new Error('Cell morphology checksum mismatch');
        neuron = parse(raw);
      }
      if (neuron.id !== id || neuron.specimen !== specimen || neuron.units !== 'nm'
        || !Array.isArray(neuron.segments) || neuron.segments.length > 30000
        || !neuron.segments.every(s => Array.isArray(s) && s.length === 6 && s.every(Number.isFinite))) {
        throw new Error('Morphology identity, units or geometry mismatch');
      }
      return neuron;
    },
  };
  return store;
}
