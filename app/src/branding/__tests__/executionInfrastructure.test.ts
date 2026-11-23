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
const { readFileSync } = require('fs') as {
  readFileSync: (file: string, encoding: 'utf8') => string;
};

const repoRoot = path.resolve(__dirname, '../../../../');
const assetTests = path.join(repoRoot, 'scripts', 'brand', 'asset-tests.mjs');
const assetValidator = path.join(repoRoot, 'scripts', 'brand', 'validate.mjs');
const planValidator = path.join(repoRoot, 'scripts', 'brand', 'validate-execution-plan.mjs');
const captureValidator = path.join(repoRoot, 'scripts', 'brand', 'capture-manifest.mjs');
const postgresRunner = path.join(repoRoot, 'supabase', 'tests-postgres', 'run.mjs');
const codespaceHelper = path.join(repoRoot, 'scripts', 'cs-test.ps1');
const codespaceRunner = path.join(repoRoot, 'scripts', 'cs', 'run.sh');

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

  test('parses O37A asset checker modules without running O01X validation', () => {
    for (const script of [assetTests, assetValidator]) {
      const result = spawnSync(process.execPath, ['--check', script], {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
      });
      const actual = {
        script,
        status: result.status,
        stdout: String(result.stdout ?? '').trim(),
        stderr: String(result.stderr ?? '').trim(),
      };
      if (actual.status !== 0) {
        throw new Error(`O37A asset checker syntax failed; actual=${JSON.stringify(actual)} expected=status 0`);
      }
    }
  });

  if (process.env.CS_EXPECT) {
    test('runs the pinned O37A transform selftest in Codespace', () => {
      const result = runNode(assetTests, ['--selftest']);
      expectCommand(result, { status: 0, stdout: '"invalidCasesRejected":9' });
      expectCommand(result, { stdout: '"profileCrcVerified":true' });
      const selftestReport = JSON.parse(result.stdout.trim()) as {
        hexBorderSelftest?: { color: string; borderMismatch: number; measuredCanvas: string };
      };
      const hexBorder = selftestReport.hexBorderSelftest;
      if (!hexBorder || hexBorder.color !== '#173d39' || hexBorder.borderMismatch !== 0) {
        throw new Error(`PNG RGB byte/border selftest failed; actual=${JSON.stringify(hexBorder ?? selftestReport)} expected=${JSON.stringify({
          color: '#173d39',
          borderMismatch: 0,
        })}`);
      }
      console.info(`PNG RGB byte/border evidence: ${JSON.stringify(hexBorder)}`);
      const report = JSON.parse(result.stdout.trim()) as {
        suppliedDProfile?: {
          provenance?: {
            renderer?: string;
            version?: string;
            pngEncoder?: string;
            systemFontsUsed?: boolean;
          };
          file?: string;
          sha256?: string;
          colorProfile?: string;
          manifest?: string;
          manifestSha256?: string;
        };
        rawRendererProfile?: string;
        transformSelftest?: {
          dPalette?: {
            primary: string;
            backgroundLight: string;
            accent: string;
            darkPrimary: string;
            backgroundDark: string;
            recolorAndBackgroundPixels: boolean;
            sRgbProfile: { kind: string; renderingIntent: number };
          };
          circleSafeAreaFit?: {
            token: string;
            inkSizePx: number;
            circleScaleRatio: number;
            predictedMaxRadiusPx: number;
            measuredMaxRadiusPx: number;
            circleOutsidePixels: number;
            circleInkSize: { width: number; height: number };
            splashInkSize: { width: number; height: number };
            deterministic: boolean;
          };
          faviconFit?: {
            bounds: { left: number; top: number; right: number; bottom: number } | null;
            visiblePixels: number;
            clearSpace: { left: number; top: number; right: number; bottom: number };
            visibleSize: { width: number; height: number };
          };
        };
      };
      const suppliedDProfile = report.suppliedDProfile;
      const expectedSuppliedDProfile = {
        file: 'app/assets/brand/logo-horizontal-light.png',
        sha256: 'e97e8b3dfe0b62adceb5deadcdfafa18d7756631119c5e969a69d5a87c446e7e',
        colorProfile: 'sRGB',
        manifest: 'docs/design/oorva/brand-kit/handoff/supplied-export-manifest.json',
        provenance: {
          renderer: 'Chromium SVG rasterization',
          version: '158.0.4370.33',
          pngEncoder: 'Pillow',
          systemFontsUsed: false,
        },
      };
      if (report.rawRendererProfile !== 'NOT VERIFIED' || !suppliedDProfile ||
        suppliedDProfile.file !== expectedSuppliedDProfile.file ||
        suppliedDProfile.sha256 !== expectedSuppliedDProfile.sha256 ||
        suppliedDProfile.colorProfile !== expectedSuppliedDProfile.colorProfile ||
        suppliedDProfile.manifest !== expectedSuppliedDProfile.manifest ||
        !/^[a-f0-9]{64}$/.test(suppliedDProfile.manifestSha256 ?? '') ||
        JSON.stringify(suppliedDProfile.provenance) !== JSON.stringify(expectedSuppliedDProfile.provenance)) {
        throw new Error(`supplied D PNG profile/provenance must remain distinct from generated Resvg output; actual=${JSON.stringify({
          rawRendererProfile: report.rawRendererProfile,
          suppliedDProfile,
        })} expected=${JSON.stringify({
          rawRendererProfile: 'NOT VERIFIED',
          suppliedDProfile: { ...expectedSuppliedDProfile, manifestSha256: '<64 lowercase hexadecimal characters>' },
        })}`);
      }
      const dPalette = report.transformSelftest?.dPalette;
      const expectedDPalette = {
        primary: '#006d77',
        backgroundLight: '#ffffff',
        accent: '#e8b772',
        darkPrimary: '#80d4d4',
        backgroundDark: '#0c1b21',
        recolorAndBackgroundPixels: true,
        sRgbProfile: { kind: 'sRGB', renderingIntent: 0 },
      };
      if (!dPalette || JSON.stringify(dPalette) !== JSON.stringify(expectedDPalette)) {
        throw new Error(`approved D palette transform/profile assertions missing or mismatched; actual=${JSON.stringify(dPalette)} expected=${JSON.stringify(expectedDPalette)}`);
      }
      const circleFit = report.transformSelftest?.circleSafeAreaFit;
      if (!circleFit || circleFit.token !== 'symbol-circle-624' || circleFit.inkSizePx !== 576 ||
        circleFit.predictedMaxRadiusPx >= 312 || circleFit.measuredMaxRadiusPx >= 312 ||
        circleFit.circleOutsidePixels !== 0 || circleFit.circleInkSize.width > 624 || circleFit.circleInkSize.height > 624 ||
        circleFit.splashInkSize.width > 624 || circleFit.splashInkSize.height > 624 || !circleFit.deterministic) {
        throw new Error(`O01X circle-safe transform selftest failed; actual=${JSON.stringify(circleFit ?? report)} expected=token symbol-circle-624, 576px ink map, radius <312px, no circle overflow, <=624px splash bounds and deterministic output`);
      }
      console.info(`O01X circle-safe transform evidence: ${JSON.stringify(circleFit)}`);
      const favicon = report.transformSelftest?.faviconFit;
      if (!favicon) throw new Error(`favicon fit selftest report missing; actual=${JSON.stringify(report)} expected=transformSelftest.faviconFit`);
      console.info(`48px favicon measured geometry: ${JSON.stringify(favicon)}`);
      if (!favicon.bounds || favicon.visiblePixels < 1 ||
        Object.values(favicon.clearSpace).some((margin) => margin < 10) ||
        favicon.visibleSize.width < 20 || favicon.visibleSize.height < 20) {
        throw new Error(`48px favicon safe-space/recognizability check failed; actual=${JSON.stringify(favicon)} expected=10px margins and visible width/height >=20px`);
      }
    });
  } else {
    test.skip('runs the pinned O37A transform selftest in Codespace; lane tooling job runs it', () => undefined);
  }

  test('guards the registered Oorva assets-suite helper route', () => {
    const helperText = readFileSync(codespaceHelper, 'utf8');
    const runnerText = readFileSync(codespaceRunner, 'utf8');
    const helperAllowsAssets = /ValidateSet\([^)]*\bassets\b/s.test(helperText);
    const runnerLines = runnerText.split(/\r?\n/);
    const assetsLine = runnerLines.findIndex((line) => /^\s*assets\)\s*/.test(line));
    let assetsBranch = '';
    if (assetsLine >= 0) {
      for (let index = assetsLine + 1; index < runnerLines.length; index += 1) {
        const line = runnerLines[index];
        if (line === undefined || /^\s*(?:[A-Za-z_-]+\)|esac\b)/.test(line)) break;
        assetsBranch += `${line}\n`;
      }
    }
    const runnerHasAssetsCase = assetsLine >= 0;
    const runnerRequiresOorvaFilter = /["']?\$1["']?\s*(?:!=|==)\s*["']oorva["']/.test(assetsBranch);
    const runnerRunsExactOorvaCheck = /node\s+asset-tests\.mjs\s+--check-oorva/.test(assetsBranch);
    const actual = { helperAllowsAssets, runnerHasAssetsCase, runnerRequiresOorvaFilter, runnerRunsExactOorvaCheck };
    const anyRegistrationPresent = Object.values(actual).some(Boolean);

    if (!anyRegistrationPresent) {
      console.info(`O37A assets helper route: NOT VERIFIED; coordinator registration pending; actual=${JSON.stringify(actual)}`);
      return;
    }
    if (!helperAllowsAssets || !runnerHasAssetsCase || !runnerRequiresOorvaFilter || !runnerRunsExactOorvaCheck) {
      throw new Error(`O37A assets helper route is partial or mismatched; actual=${JSON.stringify(actual)} expected=${JSON.stringify({
        helperAllowsAssets: true,
        runnerHasAssetsCase: true,
        runnerRequiresOorvaFilter: true,
        runnerRunsExactOorvaCheck: true,
      })}`);
    }
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
