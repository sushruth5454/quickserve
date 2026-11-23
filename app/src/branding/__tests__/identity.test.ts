jest.mock('../AppearanceProvider', () => ({
  useAppearance: jest.fn(),
}));

jest.mock('react-native', () => ({
  Text: 'Text',
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

import { useAppearance, type AppearanceState } from '../AppearanceProvider';
import { OORVA_BRANDING_CANDIDATE } from '../defaults';
import {
  resolveBrandIdentity,
  type BrandContext,
  type BrandIdentityState,
  type ResolvedBrandIdentity,
} from '../identity';
import { BrandLogo } from '../BrandLogo';

const mockUseAppearance = useAppearance as jest.MockedFunction<typeof useAppearance>;
const selectedExports = {
  logoLight: require('../../../assets/brand/logo-horizontal-light.png') as number,
  logoDark: require('../../../assets/brand/logo-horizontal-dark.png') as number,
  compactLight: require('../../../assets/brand/logo-compact-light.png') as number,
  compactDark: require('../../../assets/brand/logo-compact-dark.png') as number,
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

function appearanceState(overrides: Partial<AppearanceState> = {}): AppearanceState {
  return {
    brandingEnabled: false,
    runtimeEnabled: false,
    config: null,
    refresh: jest.fn().mockResolvedValue(undefined),
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

  it('uses approved bundled identity after runtime appearance rejection only when ready', () => {
    expect(
      resolveBrandIdentity(
        'auth',
        state({
          brandOn: true,
          runtimeOn: true,
          bundledIdentityReady: true,
          published: { ...validPublished(), displayName: '' },
        }),
      ).source,
    ).toBe('bundled');
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
          published,
        }),
      ),
    ).toEqual(legacy('QuickServe'));
  });

  it('keeps issuer, receipt, historical and technical data outside the identity API', () => {
    const excludedFields: ExcludedIdentityFields extends never ? true : never = true;
    expect(excludedFields).toBe(true);
  });

  it('maps rejected provider appearance to legacy and exposes only the identity label', () => {
    mockUseAppearance.mockReturnValue(
      appearanceState({
        brandingEnabled: true,
        runtimeEnabled: true,
        config: OORVA_BRANDING_CANDIDATE,
      }),
    );

    const logo = BrandLogo({ context: 'onboardingAgreement', testID: 'brand-logo' });

    expect(logo.props).toMatchObject({
      accessibilityLabel: 'QuickServe',
      children: 'QuickServe',
      testID: 'brand-logo',
    });
  });

  it('uses the provider-approved runtime identity without normalizing its display name', () => {
    const config = {
      ...OORVA_BRANDING_CANDIDATE,
      displayName: 'Oorva Business',
      tagline: 'A runtime-approved tagline',
      assets: {
        ...OORVA_BRANDING_CANDIDATE.assets,
        logoLight: '00000000-0000-4000-8000-000000000011',
      },
    };
    mockUseAppearance.mockReturnValue(
      appearanceState({ brandingEnabled: true, runtimeEnabled: true, config }),
    );

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
    const logo = BrandLogo({
      context: 'home',
      identity,
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
