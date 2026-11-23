import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

jest.mock('react-native', () => ({
  Text: 'Text',
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('../useBrandIdentity', () => ({
  useBrandIdentity: jest.fn(),
}));

import {
  OORVA_BRANDING_CANDIDATE,
  OORVA_SELECTED_BRAND_EXPORTS,
} from '../defaults';
import {
  resolveBrandIdentity,
  type BrandContext,
  type BrandIdentityState,
  type ResolvedBrandIdentity,
} from '../identity';
import { BrandLogo } from '../BrandLogo';
import { useBrandIdentity } from '../useBrandIdentity';

const mockUseBrandIdentity =
  useBrandIdentity as jest.MockedFunction<typeof useBrandIdentity>;
const selectedExports = {
  logoLight: require('../../../assets/brand/logo-horizontal-light.png') as number,
  logoDark: require('../../../assets/brand/logo-horizontal-dark.png') as number,
  compactLight: require('../../../assets/brand/logo-compact-light.png') as number,
  compactDark: require('../../../assets/brand/logo-compact-dark.png') as number,
};
type ExportKey = keyof typeof selectedExports;
type SelectedExportBinding = {
  source: number;
  path: string;
  role: string;
  sha256: string;
};
const selectedBindings = OORVA_SELECTED_BRAND_EXPORTS as unknown as Record<
  ExportKey,
  SelectedExportBinding
>;
const selectedManifest = require('../../../assets/brand/manifest.json') as {
  selected: boolean;
  publiclyCleared: boolean;
  files: Array<{
    selected: boolean;
    publiclyCleared: boolean;
    export: { path: string; role: string; sha256: string };
  }>;
};
const selectedEvidence = require('../../../../docs/design/oorva/evidence/o01x.json') as {
  dAssetDelta: {
    bindingHashes: Record<
      ExportKey,
      { modulePath: string; path: string; role: string; sha256: string }
    >;
    gateStatus: Record<string, string>;
    appManifestState: {
      publiclyCleared: boolean;
      productionReady: boolean;
      publicReleaseAllowed: boolean;
      nativeReleaseAuthorized: boolean;
      nativeAssetsInstalled: boolean;
      oorvaBrandEnabled: boolean;
    };
  };
};
const appRoot = resolve(__dirname, '../../..');
const selectedExportMetadata: Record<ExportKey, { path: string; role: string }> = {
  logoLight: {
    path: 'app/assets/brand/logo-horizontal-light.png',
    role: 'horizontal-lockup',
  },
  logoDark: {
    path: 'app/assets/brand/logo-horizontal-dark.png',
    role: 'horizontal-lockup',
  },
  compactLight: {
    path: 'app/assets/brand/logo-compact-light.png',
    role: 'compact-symbol',
  },
  compactDark: {
    path: 'app/assets/brand/logo-compact-dark.png',
    role: 'compact-symbol',
  },
};
type ExcludedIdentityFields = Extract<
  keyof BrandIdentityState | keyof ResolvedBrandIdentity,
  | 'issuer'
  | 'accountIdentifier'
  | 'receiptSnapshot'
  | 'contactUrl'
  | 'historicalUserText'
  | 'payoutNarration'
  | 'technicalIdentifier'
>;

const contexts: Array<[BrandContext, 'QuickServe' | 'Nearo']> = [
  ['login', 'QuickServe'],
  ['auth', 'QuickServe'],
  ['home', 'QuickServe'],
  ['account', 'QuickServe'],
  ['providerShare', 'QuickServe'],
  ['protectedInvite', 'QuickServe'],
  ['ai', 'QuickServe'],
  ['assistant', 'QuickServe'],
  ['support', 'QuickServe'],
  ['byo', 'QuickServe'],
  ['recurring', 'Nearo'],
  ['rfq', 'Nearo'],
  ['nearoReceipt', 'Nearo'],
  ['receiptChrome', 'Nearo'],
  ['quoteFunding', 'Nearo'],
  ['paymentOverlay', 'QuickServe'],
  ['statusTimeline', 'QuickServe'],
  ['nearoCheckout', 'Nearo'],
  ['checkoutPage', 'Nearo'],
  ['gatewayDescription', 'Nearo'],
  ['onboardingAgreement', 'QuickServe'],
];

function state(overrides: Partial<BrandIdentityState> = {}): BrandIdentityState {
  return {
    brandOn: false,
    runtimeOn: false,
    bundledIdentityReady: false,
    published: null,
    ...overrides,
  };
}

function legacy(displayName: 'QuickServe' | 'Nearo'): ResolvedBrandIdentity {
  return {
    displayName,
    tagline: null,
    logoLight: null,
    logoDark: null,
    compactLight: null,
    compactDark: null,
    source: 'legacy',
  };
}

function validPublished(
  overrides: Partial<NonNullable<BrandIdentityState['published']>> = {},
): NonNullable<BrandIdentityState['published']> {
  return {
    schemaVersion: 1,
    displayName: 'Oorva Partner',
    tagline: 'A runtime-approved tagline',
    logoLight: '00000000-0000-4000-8000-000000000001',
    logoDark: '00000000-0000-4000-8000-000000000002',
    compactLight: '00000000-0000-4000-8000-000000000003',
    compactDark: '00000000-0000-4000-8000-000000000004',
    ...overrides,
  };
}

describe('contextual brand identity', () => {
  it.each(contexts)('keeps the exact legacy identity for %s when branding is OFF', (context, name) => {
    expect(resolveBrandIdentity(context, state())).toEqual(legacy(name));
  });

  it.each(contexts)('falls back to the exact legacy identity for %s when bundled assets are unavailable', (context, name) => {
    expect(
      resolveBrandIdentity(
        context,
        state({ brandOn: true, runtimeOn: false, bundledIdentityReady: false }),
      ),
    ).toEqual(legacy(name));
  });

  it.each(contexts)('keeps the exact legacy identity for %s when the parent brand is OFF', (context, name) => {
    expect(
      resolveBrandIdentity(
        context,
        state({
          brandOn: false,
          runtimeOn: true,
          bundledIdentityReady: true,
          published: validPublished(),
        }),
      ),
    ).toEqual(legacy(name));
  });

  it.each(contexts.filter(([, name]) => name === 'Nearo'))(
    'keeps separately owned Nearo context %s on its legacy identity',
    (context, name) => {
      expect(
        resolveBrandIdentity(
          context,
          state({ brandOn: true, bundledIdentityReady: true }),
        ),
      ).toEqual(legacy(name));
    },
  );

  it('binds only selected O01X exports with their manifest roles and hashes', () => {
    expect(selectedManifest.selected).toBe(true);
    expect(selectedManifest.publiclyCleared).toBe(true);
    expect(selectedEvidence.dAssetDelta.gateStatus).toMatchObject({
      D03b: 'APPROVED',
      D03c: 'APPROVED',
      D02: 'PENDING',
      D07aPlatform: 'PENDING',
      D07bPlatform: 'PENDING',
    });
    expect(selectedEvidence.dAssetDelta.appManifestState).toMatchObject({
      publiclyCleared: true,
      productionReady: false,
      publicReleaseAllowed: false,
      nativeReleaseAuthorized: false,
      nativeAssetsInstalled: false,
      oorvaBrandEnabled: false,
    });

    for (const key of Object.keys(selectedExportMetadata) as ExportKey[]) {
      const expected = selectedExportMetadata[key];
      const binding = selectedBindings[key];
      const evidenceBinding = selectedEvidence.dAssetDelta.bindingHashes[key];
      const manifestFile = selectedManifest.files.find(
        (file) => file.export.path === expected.path,
      );

      expect(binding.path).toBe(expected.path);
      expect(binding.role).toBe(expected.role);
      expect(evidenceBinding).toMatchObject({
        path: expected.path,
        role: expected.role,
        sha256: binding.sha256,
      });
      expect(binding.source).toBe(selectedExports[key]);
      expect(manifestFile).toMatchObject({
        selected: true,
        publiclyCleared: true,
        export: {
          path: expected.path,
          role: expected.role,
          sha256: binding.sha256,
        },
      });
      expect(
        createHash('sha256')
          .update(
            readFileSync(
              resolve(appRoot, expected.path.replace(/^app\//, '')),
            ),
          )
          .digest('hex'),
      ).toBe(binding.sha256);
    }
  });

  it('uses the bundled identity only when its availability is approved', () => {
    const resolved = resolveBrandIdentity(
      'home',
      state({ brandOn: true, bundledIdentityReady: true }),
    );

    expect(resolved).toEqual({
      displayName: OORVA_BRANDING_CANDIDATE.displayName,
      tagline: OORVA_BRANDING_CANDIDATE.tagline,
      ...selectedExports,
      source: 'bundled',
    });
  });

  it('uses an approved runtime display name and its exact selected assets', () => {
    const published = validPublished({ displayName: 'Oorva Business' });

    expect(
      resolveBrandIdentity(
        'home',
        state({ brandOn: true, runtimeOn: true, published }),
      ),
    ).toEqual({
      displayName: published.displayName,
      tagline: published.tagline,
      logoLight: published.logoLight,
      logoDark: published.logoDark,
      compactLight: published.compactLight,
      compactDark: published.compactDark,
      source: 'published',
    });
  });

  it('preserves null runtime assets without substituting a made-up mark', () => {
    const published = validPublished({
      logoLight: null,
      logoDark: null,
      compactLight: null,
      compactDark: null,
    });

    expect(
      resolveBrandIdentity(
        'home',
        state({ brandOn: true, runtimeOn: true, published }),
      ),
    ).toEqual({
      displayName: published.displayName,
      tagline: published.tagline,
      logoLight: null,
      logoDark: null,
      compactLight: null,
      compactDark: null,
      source: 'published',
    });
  });

  it.each([
    null,
    {},
    { ...validPublished(), displayName: '   ' },
    { ...validPublished(), tagline: null },
    { ...validPublished(), logoLight: 4 },
  ])('fails safely to legacy when runtime appearance is invalid: %j', (published) => {
    expect(
      resolveBrandIdentity(
        'home',
        state({
          brandOn: true,
          runtimeOn: true,
          published: published as BrandIdentityState['published'],
        }),
      ),
    ).toEqual(legacy('QuickServe'));
  });

  it('falls back to legacy after runtime appearance rejection even when bundled assets are ready', () => {
    expect(
      resolveBrandIdentity(
        'auth',
        state({
          brandOn: true,
          runtimeOn: true,
          bundledIdentityReady: true,
          published: { ...validPublished(), displayName: '' },
        }),
      ),
    ).toEqual(legacy('QuickServe'));
  });

  it('rejects a published identity with an unsupported schema version', () => {
    const published = {
      ...validPublished(),
      schemaVersion: 2,
    } as unknown as BrandIdentityState['published'];

    expect(
      resolveBrandIdentity(
        'home',
        state({
          brandOn: true,
          runtimeOn: true,
          bundledIdentityReady: true,
          published,
        }),
      ),
    ).toEqual(legacy('QuickServe'));
  });

  it('keeps issuer, receipt, historical and technical data outside the identity API', () => {
    const excludedFields: ExcludedIdentityFields extends never ? true : never = true;
    expect(excludedFields).toBe(true);
  });

  it('renders the legacy identity supplied by useBrandIdentity', () => {
    mockUseBrandIdentity.mockReturnValue(legacy('QuickServe'));

    const logo = BrandLogo({ context: 'onboardingAgreement', testID: 'brand-logo' });

    expect(logo.props).toMatchObject({
      accessibilityLabel: 'QuickServe',
      children: 'QuickServe',
      testID: 'brand-logo',
    });
  });

  it('renders the published identity without normalizing its display name', () => {
    mockUseBrandIdentity.mockReturnValue({
      displayName: 'Oorva Business',
      tagline: 'A runtime-approved tagline',
      logoLight: '00000000-0000-4000-8000-000000000011',
      logoDark: null,
      compactLight: null,
      compactDark: null,
      source: 'published',
    });

    const logo = BrandLogo({ context: 'home' });

    expect(logo.props).toMatchObject({
      accessibilityLabel: 'Oorva Business',
      children: 'Oorva Business',
    });
  });

  it('renders the selected dark export for a bundled identity without a placeholder label', () => {
    const identity = resolveBrandIdentity(
      'home',
      state({ brandOn: true, bundledIdentityReady: true }),
    );
    mockUseBrandIdentity.mockReturnValue(identity);
    const logo = BrandLogo({
      context: 'home',
      variant: 'full',
      colorScheme: 'dark',
      testID: 'selected-brand-logo',
    });

    expect(logo.type).toBe('Image');
    expect(logo.props).toMatchObject({
      source: selectedExports.logoDark,
      accessibilityLabel: 'Oorva',
      testID: 'selected-brand-logo',
    });
  });
});
