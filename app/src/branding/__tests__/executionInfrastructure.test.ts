declare const __dirname: string;
declare const require: (id: string) => unknown;

type SpawnResult = { status: number | null; stdout: string | null; stderr: string | null };
const path = require('path') as {
  resolve: (...parts: string[]) => string;
  join: (...parts: string[]) => string;
};
const { spawnSync } = require('child_process') as {
  spawnSync: (
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string | undefined>; encoding: 'utf8' },
  ) => SpawnResult;
};

const repoRoot = path.resolve(__dirname, '../../../../');
const planValidator = path.join(repoRoot, 'scripts', 'brand', 'validate-execution-plan.mjs');
const captureValidator = path.join(repoRoot, 'scripts', 'brand', 'capture-manifest.mjs');
const postgresRunner = path.join(repoRoot, 'supabase', 'tests-postgres', 'run.mjs');

function runNode(script: string, args: string[] = [], environment: Record<string, string | undefined> = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function expectCommand(result: { status: number | null; stdout: string; stderr: string }, expected: {
  status?: number;
  stdout?: string;
  stderr?: string;
}) {
  const actual = {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
  if (expected.status !== undefined && actual.status !== expected.status) {
    throw new Error(`expected status ${expected.status}; actual=${JSON.stringify(actual)}`);
  }
  if (expected.stdout && !actual.stdout.includes(expected.stdout)) {
    throw new Error(`expected stdout to include ${JSON.stringify(expected.stdout)}; actual=${JSON.stringify(actual)}`);
  }
  if (expected.stderr && !actual.stderr.includes(expected.stderr)) {
    throw new Error(`expected stderr to include ${JSON.stringify(expected.stderr)}; actual=${JSON.stringify(actual)}`);
  }
}

describe('isolated execution infrastructure', () => {
  test('validates the frozen plan and selected stage graph', () => {
    const result = runNode(planValidator, ['--all']);
    expectCommand(result, { status: 0, stdout: 'SELECTION PASS' });
  });

  test('rejects a zero plan selection', () => {
    const result = runNode(planValidator);
    expectCommand(result, { stderr: 'zero stage selection' });
    if (result.status === 0) throw new Error(`expected a failed zero selection; actual=${JSON.stringify(result)}`);
  });

  test('runs dependency-free capture-manifest checks', () => {
    const result = runNode(captureValidator, ['--selftest']);
    expectCommand(result, { status: 0, stdout: '"passed":true' });
  });

  test('rejects an empty requested PostgreSQL test selection before connecting', () => {
    const result = runNode(postgresRunner, ['--filter', 'o37a-no-such-test'], {
      LOCAL_DB_URL: undefined,
      PRIVATE_TEST_STACK: undefined,
    });
    expectCommand(result, { stderr: 'requested zero integration tests matched' });
    if (result.status === 0) throw new Error(`expected no-match selection to fail; actual=${JSON.stringify(result)}`);
  });

  test('keeps the PostgreSQL target check loopback-only and explicitly private', () => {
    const allowed = runNode(postgresRunner, ['--check-target'], {
      LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      PRIVATE_TEST_STACK: 'true',
    });
    expectCommand(allowed, { status: 0, stdout: '"privateStack":true' });

    const missingPrivateMarker = runNode(postgresRunner, ['--check-target'], {
      LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      PRIVATE_TEST_STACK: undefined,
    });
    expectCommand(missingPrivateMarker, { stderr: 'PRIVATE_TEST_STACK=true' });
    if (missingPrivateMarker.status === 0) {
      throw new Error(`expected missing private marker to fail; actual=${JSON.stringify(missingPrivateMarker)}`);
    }

    const remoteTarget = runNode(postgresRunner, ['--check-target'], {
      LOCAL_DB_URL: 'postgresql://postgres:password@database.example.test:5432/postgres',
      PRIVATE_TEST_STACK: 'true',
    });
    expectCommand(remoteTarget, { stderr: 'loopback host' });
    if (remoteTarget.status === 0) throw new Error(`expected remote target to fail; actual=${JSON.stringify(remoteTarget)}`);
  });
});
