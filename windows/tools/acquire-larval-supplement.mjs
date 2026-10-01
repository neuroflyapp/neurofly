// Small, pinned copy of Winding et al. 2023 Supplementary Data S1.
// This is an archived source, not a verified runnable larval specimen.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../../raw_specimens/l1em-winding-2023/', import.meta.url));
const name = 'Supplementary-Data-S1.zip';
const commit = '15e065f5c29f08c96ccd64ea8fe0f51510629009';
const blob = 'e7eff2cd789602c8a91bb2390b5d717faf0f8b51';
const source = `https://raw.githubusercontent.com/brain-networks/larval-drosophila-connectome/${commit}/${name}`;
const target = path.join(root, name);
await fsp.mkdir(root, { recursive: true });
const free = await fsp.statfs(root);
if (free.bavail * free.bsize < 12 * 1024 ** 3) throw new Error('At least 12 GiB free space required');
let bytes;
if (fs.existsSync(target)) bytes = await fsp.readFile(target);
else {
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Supplement HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 3 * 1024 ** 2) throw new Error('Unexpected archive size');
  const chunks = [];
  let total = 0;
  await pipeline(Readable.fromWeb(response.body), new Writable({ write(chunk, _encoding, next) {
    total += chunk.length;
    if (total > 3 * 1024 ** 2) return next(new Error('Archive exceeds 3 MiB'));
    chunks.push(chunk); next();
  } }));
  bytes = Buffer.concat(chunks);
}
const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (actualBlob !== blob || bytes.subarray(0, 2).toString() !== 'PK') throw new Error('Pinned Git blob or ZIP signature mismatch');
if (!fs.existsSync(target)) {
  await fsp.writeFile(target + '.partial', bytes);
  await fsp.rename(target + '.partial', target);
}
const record = { name, source, sourceStudy: 'Winding et al., Science 2023, doi:10.1126/science.add9330',
  mirror: 'brain-networks/larval-drosophila-connectome', commit, gitBlobSHA1: blob,
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  status: 'locally-verified-source-archive; integration tracked separately in catalog.json',
  license: 'verify-before-redistribution' };
await fsp.writeFile(path.join(root, 'MANIFEST.json.partial'), JSON.stringify(record, null, 2));
await fsp.rename(path.join(root, 'MANIFEST.json.partial'), path.join(root, 'MANIFEST.json'));
console.log(JSON.stringify(record, null, 2));
