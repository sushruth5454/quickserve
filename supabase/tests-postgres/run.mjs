#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  assertLoopbackHttpUrl,
  assertPrivateTestStack,
  createClient,
  runGuardSelftest,
  withClient,
  withTwoClients,
} from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagePath = path.join(here, 'package.json');

function parseArgs(argv) {
  const options = { filters: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--selftest', '--selftest-guards', '--check-target'].includes(arg)) {
      if (options.action) throw new Error('Choose one runner action');
      options.action = arg.slice(2);
    } else if (arg === '--filter') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || /[\\/]/.test(value)) {
        throw new Error('--filter requires a file name or name fragment, not a path');
      }
      options.filters.push(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.action && options.filters.length) throw new Error(`${options.action} cannot be combined with --filter`);
  return options;
}

async function discoverTests() {
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  const httpTests = manifest.httpIntegrationTests ?? [];
  if (!Array.isArray(httpTests)) throw new Error('package.json httpIntegrationTests must be an array');
  const httpNames = new Set();
  for (const name of httpTests) {
    if (
      typeof name !== 'string'
      || path.basename(name) !== name
      || !name.endsWith('.http.test.mjs')
      || httpNames.has(name)
    ) {
      throw new Error(`invalid explicit HTTP integration test: ${String(name)}`);
    }
    httpNames.add(name);
  }

  const entries = await readdir(here, { withFileTypes: true });
  const pgTests = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.pg.test.mjs'))
    .map((entry) => entry.name);
  const available = new Set(pgTests);
  for (const name of httpNames) {
    const details = await stat(path.join(here, name)).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!details?.isFile()) throw new Error(`explicit HTTP integration test does not exist: ${name}`);
    if (available.has(name)) throw new Error(`test is registered as both PostgreSQL and HTTP: ${name}`);
    available.add(name);
  }
  return [...available].sort();
}

async function runTests(filters) {
  const discovered = await discoverTests();
  const selected = filters.length
    ? discovered.filter((name) => filters.some((filter) => name.includes(filter)))
    : discovered;
  if (selected.length === 0) {
    throw new Error(`requested zero integration tests matched${filters.length ? `: ${filters.join(', ')}` : ''}`);
  }

  const connectionString = process.env.LOCAL_DB_URL;
  assertPrivateTestStack({ connectionString, privateTestStack: process.env.PRIVATE_TEST_STACK });
  const localApiUrl = process.env.LOCAL_API_URL;
  if (process.env.LOCAL_SERVICE_ROLE_KEY && !localApiUrl) {
    throw new Error('LOCAL_API_URL must be set when a local service-role key is provided');
  }
  const context = {
    connectionString,
    createClient: () => createClient({ connectionString }),
    withClient: (callback) => withClient(callback, { connectionString }),
    withTwoClients: (callback) => withTwoClients(callback, { connectionString }),
    localApiUrl: localApiUrl ? assertLoopbackHttpUrl(localApiUrl).toString() : undefined,
    localServiceRoleKey: process.env.LOCAL_SERVICE_ROLE_KEY,
  };

  for (const name of selected) {
    console.log(`> ${name}`);
    const suite = await import(pathToFileURL(path.join(here, name)).href);
    if (typeof suite.run !== 'function') throw new Error(`${name} must export async function run(context)`);
    await suite.run(context);
    console.log(`PASS ${name}`);
  }
  console.log(`PostgreSQL integration tests passed: ${selected.length}`);
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.action === 'selftest') {
    const { runSelftest } = await import('./harness.selftest.mjs');
    console.log(JSON.stringify(await runSelftest()));
  } else if (options.action === 'selftest-guards') {
    console.log(JSON.stringify(runGuardSelftest()));
  } else if (options.action === 'check-target') {
    const url = assertPrivateTestStack();
    console.log(JSON.stringify({ privateStack: true, protocol: url.protocol, host: url.hostname }));
  } else {
    await runTests(options.filters);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`private PostgreSQL runner: ${error.message}`);
    process.exitCode = 1;
  });
}
