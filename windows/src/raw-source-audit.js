// A portable offline snapshot, NOT a live storage-health or integration check.
// Keep fail-closed validation separate from filesystem access for cheap tests.
const PROFILES = {
  'banc-v888': ['female', 'brain-and-nerve-cord'], 'malecns-v1': ['male', 'brain-and-nerve-cord'],
  'manc-v1.0': ['male', 'nerve-cord'], 'hemibrain-v1.2': ['female', 'partial-brain'],
  'optic-lobe-v1.1': ['male', 'right-optic-lobe'],
};
const STATUSES = new Set(['verified', 'invalid-record', 'unsafe-path', 'size-mismatch', 'checksum-mismatch', 'changed-during-check', 'missing', 'unreadable']);
const count = n => Number.isSafeInteger(n) && n >= 0;
const short = s => typeof s === 'string' && s.length > 0 && s.length < 2048;
export function validateRawSourceAudit(value) {
  if (value?.schema !== 'neurofly-raw-audit/1' || value.checksumBasis !== 'previously-recorded-local-sha256'
    || value.publisherAuthenticated !== false || value.worldwideComplete !== false || value.runtimeModified !== false
    || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))
    || !Array.isArray(value.datasets) || value.datasets.length !== Object.keys(PROFILES).length) return null;
  const seen = new Set();
  let files = 0, bytes = 0;
  for (const d of value.datasets) {
    if (!d || !Object.hasOwn(PROFILES, d.id) || seen.has(d.id) || d.runtimeImportedByAudit !== false || !short(d.name)
      || d.sex !== PROFILES[d.id][0] || d.stage !== 'adult' || d.anatomy !== PROFILES[d.id][1]
      || d.species !== 'Drosophila melanogaster' || !Array.isArray(d.files) || d.files.length > 1000
      || !Array.isArray(d.errors) || !d.errors.every(short)) return null;
    seen.add(d.id);
    let n = 0, size = 0;
    const names = new Set();
    for (const f of d.files) {
      if (!f || !short(f.name) || /[/\\:]/.test(f.name) || ['.', '..'].includes(f.name) || names.has(f.name) || !STATUSES.has(f.status)) return null;
      names.add(f.name);
      if (f.status === 'verified') {
        if (!count(f.bytes) || f.bytes === 0 || !/^[0-9a-f]{64}$/.test(f.sha256) || !short(f.url)) return null;
        try { if (new URL(f.url).protocol !== 'https:') return null; } catch { return null; }
        n++; size += f.bytes;
      }
    }
    const status = d.files.length && !d.errors.length && n === d.files.length ? 'verified' : 'needs-attention';
    if (!count(size) || d.verifiedFiles !== n || d.verifiedBytes !== size || d.status !== status) return null;
    files += n; bytes += size;
  }
  if (!count(bytes) || value.verifiedFiles !== files || value.verifiedBytes !== bytes
    || value.status !== (value.datasets.every(d => d.status === 'verified') ? 'verified' : 'needs-attention')) return null;
  return value;
}
