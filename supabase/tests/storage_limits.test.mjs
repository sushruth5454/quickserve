import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'migrations', '0070_nearo_r1.sql'), 'utf8');
const required = [
  ['job-photos bucket', /job-photos/i],
  ['dispute-photos bucket', /dispute-photos/i],
  ['5 MB upload limit', /file_size_limit\s*=\s*5242880/i],
  ['JPEG/PNG/WebP MIME allow-list', /allowed_mime_types\s*=\s*'\{image\/jpeg,image\/png,image\/webp\}'/i],
];
const missing = required.filter(([, pattern]) => !pattern.test(sql)).map(([name]) => name);
assert.deepEqual(missing, [], `storage limit migration is missing: ${JSON.stringify(missing)}`);
console.log('Storage bucket limits migration checks passed');
