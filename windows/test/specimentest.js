import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SPECIMENS, specimenCompatibility, validateSpecimenBundle } from '../src/specimen.js';
import { createSpecimenStore } from '../src/specimen-data.js';
import { makeExperimentManifest } from '../src/experiment-manifest.js';

assert.equal(specimenCompatibility('banc-v888', 'banc-v888').sameSpecimen, true);
assert.equal(specimenCompatibility('banc-v888', 'fafb-v783').sameSex, true);
assert.equal(specimenCompatibility('banc-v888', 'fafb-v783').sameSpecimen, false);
assert.equal(specimenCompatibility('fafb-v783', 'malecns-v1').sameSex, false);
assert.equal(specimenCompatibility('manc-v1.0', 'malecns-v1').sameSex, true);
assert.equal(specimenCompatibility('manc-v1.0', 'malecns-v1').sameSpecimen, false);
assert.equal(specimenCompatibility('hemibrain-v1.2', 'fafb-v783').sameSex, true);
assert.equal(specimenCompatibility('hemibrain-v1.2', 'fafb-v783').sameSpecimen, false);
assert.equal(specimenCompatibility('l1em-winding-2023', 'hemibrain-v1.2').sameSpecimen, false);
assert.equal(specimenCompatibility('l1em-winding-2023', 'hemibrain-v1.2').sameSex, false, 'unknown larval sex must not be inferred');
assert.equal(specimenCompatibility('optic-lobe-v1.1', 'malecns-v1').sameSpecimen, true);
assert.equal(specimenCompatibility('optic-lobe-v1.1', 'malecns-v1').reason, 'same-specimen-different-release');
assert.equal(specimenCompatibility('unknown', 'unknown').sameSpecimen, false);
const sample = {
  profile: SPECIMENS['banc-v888'],
  neurons: ['720575941633499884', '720575941633499885'].map(id => ({ id, specimen: 'BANC', type: 'test', pos: [0, 0, 0] })),
  edges: [[0, 1, 7]],
};
assert.equal(validateSpecimenBundle(sample).valid, true);
assert.equal(validateSpecimenBundle({ ...sample, neurons: [sample.neurons[0], { ...sample.neurons[1], pos: null, positionKnown: false }] }).valid, true, 'missing soma position must not erase sensory neurons');
assert.equal(validateSpecimenBundle({ ...sample, neurons: [sample.neurons[0], { ...sample.neurons[1], pos: null }] }).valid, false);
const provenance = { specimens: { brain: { ...SPECIMENS['fafb-v783'] }, nerveCord: SPECIMENS['malecns-v1'] }, sensoryExtensionSHA256: 'taste-and-grooming', sensoryExtensionStatus: 'attached', sensoryExtension: { addedNeurons: 864 } };
const manifest = makeExperimentManifest({ data: { provenance } });
assert.equal(manifest.data.specimens.brain.sex, 'female');
assert.equal(manifest.data.specimens.nerveCord.sex, 'male');
assert.equal(manifest.data.sensoryExtensionSHA256, 'taste-and-grooming');
assert.equal(makeExperimentManifest({ data: { circuit: { neurons: Array(3), edges: Array(4) }, provenance: { sensoryExtensionStatus: 'attached' } } }).data.baseBrainNeurons, null, 'sensory-only extension does not fabricate base counts');
provenance.specimens.brain.sex = 'changed';
assert.equal(manifest.data.specimens.brain.sex, 'female', 'exports retain immutable specimen metadata');
assert.equal(validateSpecimenBundle({ ...sample, profile: { ...sample.profile, sex: 'male' } }).valid, false);
assert.equal(validateSpecimenBundle({ ...sample, profile: { ...sample.profile, name: 'BANC v999' } }).valid, false, 'a package cannot silently relabel its release');
assert.equal(validateSpecimenBundle({ ...sample, neurons: [sample.neurons[0], { ...sample.neurons[1], specimen: 'FAFB' }] }).valid, false);
assert.equal(validateSpecimenBundle({ ...sample, neurons: sample.neurons.map(n => ({ ...n, id: Number(n.id) })) }).valid, false, '64-bit IDs must not pass through JS numbers');
assert.equal(validateSpecimenBundle({ ...sample, edges: [[0, 1, 7], [0, 1, 7]] }).valid, false);
for (const edge of [[0, 2, 5], [0, 1, -1], [0, 1, 0.5], [-1, 0, 1], [0, 1, 1, 0]]) {
  assert.equal(validateSpecimenBundle({ ...sample, edges: [edge] }).valid, false);
}
assert.equal(validateSpecimenBundle(null).valid, false);
const integrated = createSpecimenStore();
const banc = integrated.load('banc-v888');
assert.equal(banc.summary.selectedMorphometricRows, 6000);
assert.ok(banc.neurons.some(n => n.annotations.morphometricsByRegion?.some(m => m.l2_cable_length_um !== null)));
assert.ok(banc.summary.selectedReviewedCorrespondences > 0);
assert.equal(banc.sources.filter(s => s.checksumBasis === 'publisher-MD5-and-local-SHA256').length, 6);
assert.ok(banc.neurons.every(n => (n.annotations.reviewedCorrespondences || []).every(m => /^\d+$/.test(m.targetId))),
  'free-text publisher target labels cannot masquerade as exact neuron IDs');
assert.ok(banc.neurons.find(n => n.id === '720575941645403000')?.annotations.reviewedCorrespondences?.some(m =>
  m.targetSpecimen === 'MANC' && m.targetId === '10892'), 'reviewed links use publisher pt_root_id, not query_id');
assert.ok(banc.neurons.every(n => (n.annotations.reviewedCorrespondences || []).every(m =>
  m.relation === 'within-specimen-mirror' || m.relation === 'cross-specimen-reviewed-correspondence')));
assert.equal(validateSpecimenBundle(banc).valid, true);
const manc = integrated.load('manc-v1.0');
assert.equal(manc.profile.specimen, 'MANC');
assert.equal(manc.profile.sex, 'male');
assert.equal(manc.runtimeReady, false);
assert.equal(manc.neurons.length, 6000);
assert.equal(manc.summary.selectedConnections, manc.edges.length);
assert.equal(manc.sources.length, 3, 'only the three source files actually used are attributed');
assert.ok(manc.sources.every(s => s.checksumBasis === 'previously-recorded-local-sha256'));
assert.equal(validateSpecimenBundle(manc).valid, true);
const optic = integrated.load('optic-lobe-v1.1');
assert.equal(optic.profile.specimen, 'MaleCNS');
assert.equal(optic.profile.sourceRelease, 'optic-lobe:v1.1');
assert.equal(validateSpecimenBundle({ ...optic, profile: { ...optic.profile, sourceRelease: 'malecns:v1.0' } }).valid, false, 'overlapping male releases remain distinct');
assert.equal(optic.summary.sameSampleIdOverlapVerified, 6000);
assert.equal(optic.runtimeReady, false);
assert.equal(optic.neurons.length, 6000);
assert.equal(optic.sources.length, 2, 'do not double-count the primary-only alternate edge export');
assert.equal(optic.neurons.find(n => n.annotations.instance === 'CT1_L')?.side, 'left', 'right optic-lobe scope does not imply right-sided somata');
assert.equal(validateSpecimenBundle(optic).valid, true);
const hemi = integrated.load('hemibrain-v1.2');
assert.equal(hemi.profile.specimen, 'Hemibrain');
assert.equal(hemi.profile.sex, 'female');
assert.equal(hemi.runtimeReady, false);
assert.equal(hemi.neurons.length, 6000);
assert.equal(hemi.sources.length, 3, 'ROI and alternate-release edges are not added to the v1.2 graph');
assert.ok(hemi.sources.some(s => s.sourceRelease === 'hemibrain:v1.2.1 supplementary metadata'));
assert.equal(validateSpecimenBundle(hemi).valid, true);
const larva = integrated.load('l1em-winding-2023');
assert.equal(larva.profile.specimen, 'L1EM');
assert.equal(larva.profile.sex, 'unspecified');
assert.equal(larva.neurons.length, 2952);
assert.equal(larva.edges.length, 110677);
assert.equal(larva.summary.selectedContacts, 352611);
assert.equal(larva.summary.unlocatedSelected, 2952, 'do not fabricate larval cell coordinates');
assert.equal(larva.neurons.every(n => n.pos === null && n.positionKnown === false), true);
assert.equal(larva.runtimeReady, false);
assert.equal(validateSpecimenBundle(larva).valid, true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-specimens-'));
try {
  const store = createSpecimenStore(dir);
  assert.equal(store.catalog().profiles.length, 7);
  assert.equal(store.catalog().profiles.every(p => !p.runtimeReady && p.status === 'not-imported'), true);
  assert.throws(() => store.load('../../private'));
  assert.throws(() => store.load('banc-v888'));
  const raw = JSON.stringify(sample), sha256 = createHash('sha256').update(raw).digest('hex');
  fs.writeFileSync(path.join(dir, 'banc-v888.json'), raw);
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ profiles: [{ id: 'banc-v888', sha256 }] }));
  assert.equal(store.catalog().profiles[0].status, 'anatomy-ready');
  assert.equal(store.catalog().profiles[0].runtimeReady, false, 'anatomy does not certify body/physiology');
  assert.equal(store.load('banc-v888').neurons[1].id, '720575941633499885');
  assert.equal(store.morphology('720575941633499885'), null);
  assert.throws(() => store.morphology('../invalid'));
  fs.writeFileSync(path.join(dir, 'banc-v888.json'), raw + ' ');
  assert.throws(() => createSpecimenStore(dir).load('banc-v888'), /checksum/);
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ profiles: [{ id: 'malecns-v1', sha256 }] }));
  fs.writeFileSync(path.join(dir, 'malecns-v1.json'), raw);
  assert.throws(() => createSpecimenStore(dir).load('malecns-v1'), /wrong animal/);
} finally {
  const resolved = fs.realpathSync(dir);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('neurofly-specimens-'));
  fs.rmSync(resolved, { recursive: true, force: true }); // only our verified fresh fixture
}
console.log('specimentest: PASS — identity, sex, exact IDs, counts, checksums, safe paths and readiness');
