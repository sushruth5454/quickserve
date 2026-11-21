#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateConsoleFilters(filters) {
  if (!Array.isArray(filters)) throw new Error('consoleFilters must be an array');
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new Error('console filters must be route-scoped objects');
    }
    if (!isNonEmptyString(filter.route) || !filter.route.startsWith('/') || filter.route.startsWith('//')) {
      throw new Error('console filters require one exact route path');
    }
    if (!isNonEmptyString(filter.message) || !isNonEmptyString(filter.reason)) {
      throw new Error('console filters require an exact message and a reason');
    }
    if (filter.message.includes('*') || /^(all|error|console(?:\.error)?|pageerror)$/i.test(filter.message.trim())) {
      throw new Error('blanket or pattern-based console filters are not allowed');
    }
  }
}

export function validateCapture(capture, expected = {}) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error('capture must be a JSON object');
  }
  if (!isNonEmptyString(capture.route) || !capture.route.startsWith('/') || capture.route.startsWith('//')) {
    throw new Error('capture.route must be an absolute app path');
  }
  for (const field of ['state', 'actor']) {
    if (!isNonEmptyString(capture[field])) throw new Error(`capture.${field} must be a non-empty string`);
  }
  if (!capture.flags || typeof capture.flags !== 'object' || Array.isArray(capture.flags)) {
    throw new Error('capture.flags must be an object');
  }
  const flagEntries = Object.entries(capture.flags);
  if (flagEntries.length === 0) throw new Error('capture.flags must include at least one explicit flag');
  for (const [key, value] of flagEntries) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || typeof value !== 'boolean') {
      throw new Error(`capture flag ${key} must have a valid key and boolean value`);
    }
  }
  validateConsoleFilters(capture.consoleFilters);

  for (const field of ['route', 'state', 'actor']) {
    if (expected[field] !== undefined && capture[field] !== expected[field]) {
      throw new Error(`capture.${field} mismatch: actual=${JSON.stringify(capture[field])} expected=${JSON.stringify(expected[field])}`);
    }
  }
  if (expected.flags !== undefined && stableJson(capture.flags) !== stableJson(expected.flags)) {
    throw new Error(`capture.flags mismatch: actual=${stableJson(capture.flags)} expected=${stableJson(expected.flags)}`);
  }

  return {
    schemaVersion: 1,
    route: capture.route,
    state: capture.state,
    actor: capture.actor,
    flags: Object.fromEntries(flagEntries.sort(([left], [right]) => left.localeCompare(right))),
    consoleFilters: capture.consoleFilters,
  };
}

export function runSelftest() {
  const capture = {
    route: '/home',
    state: 'loaded',
    actor: 'customer',
    flags: { oorva_brand: false, oorva_home_ux: false },
    consoleFilters: [],
  };
  assert.deepEqual(validateCapture(capture, capture), {
    schemaVersion: 1,
    route: '/home',
    state: 'loaded',
    actor: 'customer',
    flags: { oorva_brand: false, oorva_home_ux: false },
    consoleFilters: [],
  });
  assert.throws(() => validateCapture({ ...capture, route: '' }), /capture\.route/);
  assert.throws(() => validateCapture(capture, { ...capture, actor: 'provider' }), /capture\.actor mismatch/);
  assert.throws(() => validateCapture({ ...capture, flags: { oorva_brand: 'false' } }), /boolean value/);
  assert.throws(() => validateCapture({
    ...capture,
    consoleFilters: [{ route: '/home', message: '.*', reason: 'suppress noise' }],
  }), /blanket or pattern-based/);
  return { cases: 5, passed: true };
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--selftest') return { selftest: true };
  const options = { expected: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--input', '--output', '--expect-route', '--expect-state', '--expect-actor', '--expect-flags'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    index += 1;
    if (arg === '--input') options.input = value;
    else if (arg === '--output') options.output = value;
    else if (arg === '--expect-flags') options.expected.flags = JSON.parse(value);
    else options.expected[arg.slice('--expect-'.length)] = value;
  }
  if (!options.input) throw new Error('--input is required');
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.selftest) {
    console.log(JSON.stringify(runSelftest()));
    return;
  }
  const capture = JSON.parse(await readFile(options.input, 'utf8'));
  const manifest = validateCapture(capture, options.expected);
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.output) await writeFile(options.output, output, 'utf8');
  else process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`capture manifest: ${error.message}`);
    process.exitCode = 1;
  });
}
