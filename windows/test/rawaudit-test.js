import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRawSourceAudit } from '../src/raw-source-audit.js';
import { createSpecimenStore } from '../src/specimen-data.js';
import { RESEARCH_COVERAGE } from '../src/research-coverage.js';

const ids = ['banc-v888', 'malecns-v1', 'manc-v1.0', 'hemibrain-v1.2', 'optic-lobe-v1.1'];
const sexes = ['female', 'male', 'male', 'female', 'male'];
const anatomy = ['brain-and-nerve-cord', 'brain-and-nerve-cord', 'nerve-cord', 'partial-brain', 'right-optic-lobe'];
for (const id of ids) {
  const entry = RESEARCH_COVERAGE.datasets.find(d => d.id === id);
  assert.ok(entry, `audited source ${id} must be identifiable in the research catalog`);
  assert.notEqual(entry.status, 'anatomy-ready', 'raw tables cannot silently become a simulated animal');
}
const sample = { schema: 'neurofly-raw-audit/1', checkedAt: '2026-09-27T12:00:00Z',
  checksumBasis: 'previously-recorded-local-sha256', publisherAuthenticated: false, worldwideComplete: false, runtimeModified: false,
  verifiedFiles: 5, verifiedBytes: 50, status: 'verified',
  datasets: ids.map((id, i) => ({ id, name: id, sex: sexes[i], stage: 'adult', anatomy: anatomy[i], species: 'Drosophila melanogaster',
    runtimeImportedByAudit: false, verifiedFiles: 1, verifiedBytes: 10, status: 'verified', errors: [],
    files: [{ name: 'source.feather', bytes: 10, sha256: 'a'.repeat(64), url: 'https://example.org/data', status: 'verified' }] })) };
assert.equal(validateRawSourceAudit(sample), sample);
for (const change of [s => s.verifiedFiles++, s => s.verifiedBytes++, s => s.publisherAuthenticated = true,
  s => s.runtimeModified = true, s => s.datasets[0].runtimeImportedByAudit = true, s => s.checkedAt = 'bad',
  s => s.datasets.pop(), s => s.datasets[0].files[0].bytes = -10,
  s => s.datasets[0].files[0].name = '../file', s => s.datasets[0].files[0].sha256 = 'bad',
  s => s.datasets[0].files[0].url = 'javascript:alert(1)', s => s.datasets[1].id = s.datasets[0].id,
  s => s.datasets[0].files[0].status = 'missing', s => s.datasets[0].errors.push('failure'),
  s => s.datasets[0].sex = 'male', s => s.datasets[1].anatomy = 'brain',
  s => s.datasets[0] = null, s => s.datasets[0].files[0] = null]) {
  const broken = structuredClone(sample); change(broken);
  assert.equal(validateRawSourceAudit(broken), null);
}
const partial = structuredClone(sample);
partial.datasets[0].files[0].status = 'checksum-mismatch';
Object.assign(partial.datasets[0], { verifiedFiles: 0, verifiedBytes: 0, status: 'needs-attention' });
Object.assign(partial, { verifiedFiles: 4, verifiedBytes: 40, status: 'needs-attention' });
assert.equal(validateRawSourceAudit(partial), partial, 'an honest partial audit is visible');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofly-raw-audit-'));
try {
  const store = createSpecimenStore(dir);
  assert.equal(store.catalog().rawSources, null);
  fs.writeFileSync(path.join(dir, 'raw-source-audit.json'), JSON.stringify(sample));
  assert.deepEqual(store.catalog().rawSources, sample);
  assert.ok(store.catalog().profiles.every(p => !p.runtimeReady), 'raw data never enables an unvalidated runtime');
  fs.writeFileSync(path.join(dir, 'raw-source-audit.json'), '{');
  assert.equal(store.catalog().rawSources, null, 'malformed optional audit cannot break the app');
} finally {
  assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('neurofly-raw-audit-'));
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('rawaudit-test: PASS — bounded offline snapshot, exact counts, no false runtime readiness');
