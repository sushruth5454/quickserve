declare const require: (moduleName: string) => unknown;
declare const __dirname: string;

interface FontBytes {
  toString(encoding: string, start?: number, end?: number): string;
  readUInt16BE(offset: number): number;
  readUInt32BE(offset: number): number;
}

interface FontEntry {
  file: string;
  sourcePath: string;
  weight: number;
  sha256: string;
  static: boolean;
  [key: string]: unknown;
}

interface FontManifest {
  family: string;
  independentOfFinalLogo: boolean;
  loading: string;
  source: {
    repository: string;
    commit: string;
    googleFontsMetadata: { repository: string; path: string };
  };
  license: { name: string; version: string; file: string; sha256: string };
  fonts: FontEntry[];
  fallback: {
    bodyFamily: string;
    scriptFamily: string;
    teluguFamily: string;
    teluguBehaviorValidation: string;
  };
}

const fs = require('fs') as {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: 'utf8'): string;
  readFileSync(filePath: string): FontBytes;
};
const path = require('path') as {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  basename(filePath: string): string;
};
const crypto = require('crypto') as {
  createHash(algorithm: string): {
    update(bytes: FontBytes): { digest(encoding: 'hex'): string };
  };
};

const fontDirectory = path.resolve(__dirname, '../../../assets/fonts');
const manifestPath = path.join(fontDirectory, 'manrope-manifest.json');
const expectedCommit = '6f81ebecdf65e4463b798cc07b16a4f8d5216917';
const expectedFonts = [
  {
    file: 'Manrope-SemiBold.ttf',
    sourcePath: 'fonts/ttf/manrope-semibold.ttf',
    weight: 600,
    sha256: 'e80a2c37e47ec09bff5a9960257bf9001e87d5fb7bf35719ef4958763a0c70ac',
  },
  {
    file: 'Manrope-Bold.ttf',
    sourcePath: 'fonts/ttf/manrope-bold.ttf',
    weight: 700,
    sha256: '2da33eb378d59e6314ed7afdfa837cdcb60e41ac8b1f5d3c4909471b95fcf7d9',
  },
];

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: actual=${actualJson}, expected=${expectedJson}`);
  }
}

function readTables(bytes: FontBytes): Map<string, { offset: number; length: number }> {
  assertEqual('TrueType sfnt signature', bytes.toString('hex', 0, 4), '00010000');
  const tableCount = bytes.readUInt16BE(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    const tag = bytes.toString('ascii', record, record + 4);
    const offset = bytes.readUInt32BE(record + 8);
    const length = bytes.readUInt32BE(record + 12);
    tables.set(tag, { offset, length });
  }
  return tables;
}

describe('Manrope bundled font manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FontManifest;

  test('records the pinned source, OFL license, and exact asset provenance', () => {
    assertEqual('family', manifest.family, 'Manrope');
    assertEqual('source repository', manifest.source.repository, 'https://github.com/aaronbell/manrope');
    assertEqual('source commit', manifest.source.commit, expectedCommit);
    assertEqual('Google Fonts metadata reference', manifest.source.googleFontsMetadata, {
      repository: 'https://github.com/google/fonts',
      path: 'ofl/manrope/METADATA.pb',
    });
    assertEqual(
      'font source mapping',
      manifest.fonts.map(({ file, sourcePath, weight, sha256 }) => ({ file, sourcePath, weight, sha256 })),
      expectedFonts,
    );
    assertEqual('license declaration', manifest.license, {
      name: 'SIL Open Font License',
      version: '1.1',
      file: 'Manrope-OFL.txt',
      sha256: 'e01b637272e0cbdfb240184dd98ea5cc671556d9894dae2668d92ab2c906787c',
    });

    const licensePath = path.join(fontDirectory, manifest.license.file);
    assertEqual('local OFL file exists', fs.existsSync(licensePath), true);
    const licenseText = fs.readFileSync(licensePath, 'utf8');
    const licenseBytes = fs.readFileSync(licensePath);
    const licenseHash = crypto.createHash('sha256').update(licenseBytes).digest('hex');
    assertEqual('OFL SHA-256', licenseHash, manifest.license.sha256);
    assertEqual(
      'OFL 1.1 notice is present',
      /SIL OPEN FONT LICENSE Version 1\.1/.test(licenseText),
      true,
    );
  });

  test('bundled bytes match manifest hashes and static OS/2 weight classes', () => {
    for (const font of manifest.fonts) {
      const fontPath = path.join(fontDirectory, font.file);
      assertEqual(`local font exists (${font.file})`, fs.existsSync(fontPath), true);
      const bytes = fs.readFileSync(fontPath);
      const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
      assertEqual(`SHA-256 (${font.file})`, actualHash, font.sha256);

      const tables = readTables(bytes);
      assertEqual(`static font has no fvar table (${font.file})`, tables.has('fvar'), false);
      const os2 = tables.get('OS/2');
      assertEqual(`OS/2 table exists (${font.file})`, Boolean(os2), true);
      if (!os2) continue;
      const actualWeight = bytes.readUInt16BE(os2.offset + 4);
      assertEqual(`OS/2 usWeightClass (${font.file})`, actualWeight, font.weight);
      assertEqual(`manifest declares static font (${font.file})`, font.static, true);
    }
  });

  test('uses only existing local font assets and preserves explicit fallback contracts', () => {
    assertEqual(
      'font references are exact local filenames',
      manifest.fonts.map((font) => ({
        isBasename: path.basename(font.file) === font.file,
        isRemote: /^[a-z][a-z0-9+.-]*:/i.test(font.file) || font.file.includes('//'),
        hasRemoteFetchField: ['url', 'uri', 'remoteUrl'].some((key) => key in font),
      })),
      [
        { isBasename: true, isRemote: false, hasRemoteFetchField: false },
        { isBasename: true, isRemote: false, hasRemoteFetchField: false },
      ],
    );
    assertEqual('logo independence', manifest.independentOfFinalLogo, true);
    assertEqual('font loading mode', manifest.loading, 'Bundled assets only; no runtime font fetching');
    assertEqual('fallback contract', manifest.fallback, {
      bodyFamily: 'Inter',
      scriptFamily: 'system',
      teluguFamily: 'system',
      teluguBehaviorValidation: 'NOT_VERIFIED',
    });
  });
});
