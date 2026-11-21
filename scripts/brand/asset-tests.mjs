#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSvg, renderSvg } from './export.mjs';
import { validatePng } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runSelftest() {
  const input = path.join(here, 'fixtures', 'export-selftest.svg');
  const fixture = await readFile(input, 'utf8');
  assert.match(fixture, /<path\b/, 'self-test fixture must contain outlined vector paths');
  assert.doesNotMatch(fixture, /<(?:text|font)\b|font-family\s*=|@font-face/i, 'self-test fixture must not use fonts');

  const first = renderSvg(fixture);
  const second = renderSvg(fixture);
  assert.deepEqual(first, second, 'identical outlined input must export byte-for-byte identically');
  assert.deepEqual(validatePng(first), { width: 64, height: 64, bytes: first.length });

  const output = path.join(here, 'fixtures', `.export-selftest-${randomUUID()}.png`);
  try {
    await exportSvg({ input, output, mode: 'write' });
    await exportSvg({ input, output, mode: 'check' });
    await writeFile(output, Buffer.from('stale'));
    await assert.rejects(exportSvg({ input, output, mode: 'check' }), /Export is stale/);
  } finally {
    await unlink(output).catch(() => undefined);
  }
  return { fixture: 'export-selftest.svg', width: 64, height: 64, deterministic: true, writeCheck: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--selftest') {
    console.error('usage: node asset-tests.mjs --selftest');
    process.exitCode = 2;
  } else {
    runSelftest()
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(`brand selftest: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
