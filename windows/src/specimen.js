// Shared, explicit specimen identity. Never infer sex from a file or a label.
export const SPECIMENS = Object.freeze({
  'fafb-v783': Object.freeze({ id: 'fafb-v783', name: 'FlyWire FAFB v783', specimen: 'FAFB', sex: 'female', scope: 'brain', license: 'CC-BY-NC-4.0', source: 'https://codex.flywire.ai/api/download' }),
  'banc-v888': Object.freeze({ id: 'banc-v888', name: 'BANC v888', specimen: 'BANC', sex: 'female', scope: 'brain-and-nerve-cord', license: 'CC-BY-4.0', source: 'https://doi.org/10.7910/DVN/7WTH1N' }),
  'malecns-v1': Object.freeze({ id: 'malecns-v1', name: 'MaleCNS v1.0', specimen: 'MaleCNS', sex: 'male', scope: 'brain-and-nerve-cord', license: 'CC-BY-4.0', source: 'https://male-cns.janelia.org/download/' }),
  'manc-v1.0': Object.freeze({ id: 'manc-v1.0', name: 'MANC v1.0', specimen: 'MANC', sex: 'male', scope: 'nerve-cord', license: 'CC-BY-4.0', source: 'https://www.janelia.org/project-team/flyem/manc-connectome' }),
  'optic-lobe-v1.1': Object.freeze({ id: 'optic-lobe-v1.1', name: 'Male optic lobe v1.1', specimen: 'MaleCNS', sex: 'male', scope: 'right-optic-lobe', license: 'CC-BY-4.0', source: 'https://www.janelia.org/node/69305', sourceRelease: 'optic-lobe:v1.1' }),
  'hemibrain-v1.2': Object.freeze({ id: 'hemibrain-v1.2', name: 'Hemibrain v1.2', specimen: 'Hemibrain', sex: 'female', scope: 'partial-brain', license: 'verify-before-redistribution', source: 'https://storage.googleapis.com/hemibrain/v1.2/', sourceRelease: 'hemibrain:v1.2+annotations:v1.2.1' }),
  'l1em-winding-2023': Object.freeze({ id: 'l1em-winding-2023', name: 'Larval brain (Winding 2023)', specimen: 'L1EM', sex: 'unspecified', scope: 'larval-brain', license: 'verify-before-redistribution', source: 'https://doi.org/10.1126/science.add9330', sourceRelease: 'Winding:2023-S1' }),
});

export function specimenCompatibility(brainId, cordId) {
  const brain = SPECIMENS[brainId], cord = SPECIMENS[cordId];
  if (!brain || !cord) return { sameSpecimen: false, sameSex: false, reason: 'unidentified-source' };
  const sameSpecimen = brain.specimen === cord.specimen;
  return { sameSpecimen, sameSex: brain.sex !== 'unspecified' && brain.sex === cord.sex,
    reason: sameSpecimen ? (brain.id === cord.id ? 'same-release' : 'same-specimen-different-release') : 'cross-specimen-model' };
}

export function validateSpecimenBundle(bundle) {
  const errors = [];
  const identity = SPECIMENS[bundle?.profile?.id];
  if (!identity || identity.specimen !== bundle.profile.specimen || identity.sex !== bundle.profile.sex
    || identity.name !== bundle.profile.name || identity.sourceRelease !== bundle.profile.sourceRelease) {
    errors.push('Unknown or inconsistent specimen identity or source release');
  }
  const neurons = bundle?.neurons, edges = bundle?.edges;
  if (!Array.isArray(neurons) || !neurons.length || !Array.isArray(edges) || !edges.length) return { valid: false, errors: [...errors, 'Empty anatomical network'] };
  const seen = new Set();
  for (const n of neurons) {
    // Root IDs can exceed JavaScript's integer range: decimal strings only.
    if (typeof n.id !== 'string' || !/^\d+$/.test(n.id) || seen.has(n.id)) errors.push('Invalid or duplicate neuron ID');
    seen.add(n.id);
    if (n.specimen !== identity?.specimen) errors.push('Cross-specimen neuron rejected');
    const located = Array.isArray(n.pos) && n.pos.length === 3 && n.pos.every(Number.isFinite);
    const explicitlyUnlocated = n.pos === null && n.positionKnown === false;
    if (typeof n.type !== 'string' || (!located && !explicitlyUnlocated)) errors.push('Invalid neuron annotation/position');
  }
  const pairs = new Set();
  // Bundles are bounded to a few thousand cells. A numeric pair key avoids
  // allocating a string for every edge during the first anatomy load.
  if (!Number.isSafeInteger(neurons.length * neurons.length)) errors.push('Anatomical network exceeds safe index range');
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || e[0] < 0 || e[1] < 0 || e[0] >= neurons.length || e[1] >= neurons.length || !Number.isSafeInteger(e[2]) || e[2] <= 0) { errors.push('Invalid anatomical contact count or endpoint'); continue; }
    const key = e[0] * neurons.length + e[1];
    if (pairs.has(key)) errors.push('Duplicate connection; alternative detections must not be added');
    pairs.add(key);
  }
  return { valid: !errors.length, errors: [...new Set(errors)] };
}
