// Pinned, small supplementary annotation download for the hemibrain explorer.
// The raw file stays outside Git; the importer checks its recorded digest.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = fileURLToPath(new URL('../../raw_specimens/hemibrain-v1.2/', import.meta.url));
const NAME = 'Supplemental_file5_hemibrain_meta.csv';
const COMMIT = 'a83b2776d60d5764cef36b927f5f9679c16c47a2';
const BLOB = '11d21b7e8cc2b4b8b0d910150bc836e2c4e9ebd3';
const SOURCE_URL = `https://raw.githubusercontent.com/flyconnectome/flywire_annotations/${COMMIT}/supplemental_files/${NAME}`;
const destination = path.join(ROOT, NAME);
const manifest = path.join(ROOT, 'supplementary-annotations.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
await fsp.mkdir(ROOT, { recursive: true });
const free = await fsp.statfs(ROOT);
if (free.bavail * free.bsize < 12 * 1024 ** 3) throw new Error('At least 12 GiB free space required');
let data;
if (fs.existsSync(destination)) data = await fsp.readFile(destination);
else {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Annotation HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 5 * 1024 ** 2) throw new Error('Unexpected annotation size');
  const chunks = [];
  let bytes = 0;
  await pipeline(Readable.fromWeb(response.body), new Writable({ write(chunk, _encoding, next) {
    bytes += chunk.length;
    if (bytes > 5 * 1024 ** 2) return next(new Error('Annotation exceeds 5 MiB'));
    chunks.push(chunk); next();
  } }));
  data = Buffer.concat(chunks);
}
if (gitBlob(data) !== BLOB) throw new Error('Pinned Git blob checksum mismatch; existing file preserved');
if (!fs.existsSync(destination)) {
  await fsp.writeFile(destination + '.partial', data);
  await fsp.rename(destination + '.partial', destination);
}
const record = { name: NAME, source: SOURCE_URL, sourceRelease: 'hemibrain:v1.2.1 supplementary metadata',
  connectivityRelease: 'hemibrain:v1.2', gitCommit: COMMIT, gitBlobSHA1: BLOB,
  bytes: data.length, sha256: digest(data),
  caveat: 'Exact body-ID annotations from a later minor release; never substitute or add connectivity from that release. Review supplementary-data license before public redistribution.' };
await fsp.writeFile(manifest + '.partial', JSON.stringify(record, null, 2));
await fsp.rename(manifest + '.partial', manifest);
console.log(JSON.stringify({ status: 'verified', ...record }, null, 2));
