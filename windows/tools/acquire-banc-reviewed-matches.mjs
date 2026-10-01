// Publisher-authenticated, small human-reviewed correspondences.
// These are comparison labels, never cross-specimen synapses.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../../raw_specimens/banc-v888/', import.meta.url));
const source = 'https://doi.org/10.7910/DVN/7WTH1N';
const names = ['banc_fafb_reviewed_matches.csv.gz', 'banc_fanc_reviewed_matches.csv.gz',
  'banc_hemibrain_reviewed_matches.csv.gz', 'banc_malecns_reviewed_matches.csv.gz',
  'banc_manc_reviewed_matches.csv.gz', 'banc_mirror_reviewed_matches.csv.gz'];
const response = await fetch('https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/7WTH1N',
  { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`BANC publisher metadata HTTP ${response.status}`);
const published = (await response.json()).data.latestVersion.files;
const free = await fsp.statfs(root);
if (free.bavail * free.bsize < 12 * 1024 ** 3) throw new Error('At least 12 GiB free space required');
const files = [];
for (const name of names) {
  const entry = published.find(x => x.label === name);
  if (!entry || entry.dataFile.filesize > 10 * 1024 ** 2 || entry.dataFile.checksum?.type !== 'MD5')
    throw new Error(`Unrecognized BANC reviewed-match file: ${name}`);
  const { id, filesize, checksum } = entry.dataFile;
  const target = path.join(root, name);
  let bytes;
  if (fs.existsSync(target)) bytes = await fsp.readFile(target);
  else {
    const download = await fetch(`https://dataverse.harvard.edu/api/access/datafile/${id}`,
      { signal: AbortSignal.timeout(120000) });
    if (!download.ok || !download.body) throw new Error(`BANC file HTTP ${download.status}: ${name}`);
    const chunks = [];
    let total = 0;
    await pipeline(Readable.fromWeb(download.body), new Writable({ write(chunk, _encoding, next) {
      total += chunk.length;
      if (total > 10 * 1024 ** 2) return next(new Error('BANC file exceeds 10 MiB'));
      chunks.push(chunk); next();
    } }));
    bytes = Buffer.concat(chunks);
  }
  const md5 = createHash('md5').update(bytes).digest('hex');
  if (bytes.length !== filesize || md5 !== checksum.value.toLowerCase())
    throw new Error(`Publisher size/MD5 mismatch: ${name}; existing file preserved`);
  if (!fs.existsSync(target)) {
    await fsp.writeFile(target + '.partial', bytes);
    await fsp.rename(target + '.partial', target);
  }
  files.push({ name, bytes: bytes.length, md5, sha256: createHash('sha256').update(bytes).digest('hex'),
    source, url: `https://dataverse.harvard.edu/api/access/datafile/${id}`,
    encoding: bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ? 'gzip' : 'plain-csv-despite-gz-suffix',
    license: 'CC-BY-4.0' });
  console.log(`VERIFIED ${name} ${bytes.length} bytes`);
}
const manifest = path.join(root, 'reviewed-matches-manifest.json');
await fsp.writeFile(manifest + '.partial', JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(),
  verification: 'publisher-MD5-plus-local-SHA256', files }, null, 2));
await fsp.rename(manifest + '.partial', manifest);
console.log('DONE BANC reviewed correspondences');
