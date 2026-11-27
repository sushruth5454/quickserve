const mockFeatureFlags: Record<string, boolean> = { oorva_brand: false, oorva_onboarding_ux: false };
const mockIdentityContexts: string[] = [];

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `https://example.test${path}` }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), dismissTo: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  Share: { share: jest.fn() },
  Switch: 'Switch',
  View: 'View',
}));
jest.mock('../../../components/ui', () => ({
  Avatar: 'Avatar',
  Badge: 'Badge',
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  ErrorState: 'ErrorState',
  FullScreenLoader: 'FullScreenLoader',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  ListItem: 'ListItem',
  Screen: 'Screen',
  Text: 'Text',
  useConfirm: () => jest.fn(),
  useToast: () => jest.fn(),
}));
jest.mock('../../../theme', () => ({ useTheme: () => ({ colors: {}, spacing: {}, radii: {} }) }));
jest.mock('../../../lib/onboarding', () => ({ onboardingApi: {} }));
jest.mock('../../../lib/featureFlags', () => ({
  useFeature: (key: string) => key === 'oorva_brand'
    ? mockFeatureFlags.oorva_brand
    : key === 'oorva_onboarding_ux' && mockFeatureFlags.oorva_brand && mockFeatureFlags.oorva_onboarding_ux,
}));
jest.mock('../../../branding/useBrandIdentity', () => ({
  useBrandIdentity: (context: string) => {
    mockIdentityContexts.push(context);
    return { displayName: mockFeatureFlags.oorva_brand ? 'Oorva' : 'QuickServe' };
  },
}));
jest.mock('../media', () => ({ pickDocument: jest.fn(), pickPhoto: jest.fn() }));
jest.mock('../useOnboardingData', () => ({ useOnboardingData: jest.fn() }));
jest.mock('../BasicsSection', () => ({ BasicsSection: 'BasicsSection' }));
jest.mock('../ServicesSection', () => ({ ServicesSection: 'ServicesSection' }));
jest.mock('../AreaSection', () => ({ AreaSection: 'AreaSection' }));
jest.mock('../HoursSection', () => ({ HoursSection: 'HoursSection' }));
jest.mock('../PayoutSection', () => ({ PayoutSection: 'PayoutSection' }));

import { resolveBrandIdentity, type BrandIdentityState } from '../../../branding/identity';
import { isFeatureOn } from '../../../lib/featureFlagModel';
import { DEACTIVATION_CONFIRMATION_COPY, GO_LIVE_TITLE } from '../../../lib/onboarding/copy';
import { STEP_KEYS, resumeStep } from '../../../lib/onboarding/completeness';
import type { DocumentRequirement, ProviderDocument } from '../../../lib/onboarding';
import { isSectionKey, SECTIONS } from '../sections';
import {
  documentRows,
  portfolioPrimaryAction,
  portfolioSectionOrder,
  requiredCredentialRepairs,
} from '../PortfolioSection';
import { onboardingCompositionEnabled } from '../parts';
import {
  confirmProviderDeactivation,
  shouldPrioritizeCredentialRepairs,
} from '../../identityScreens/ProviderProfileIndexScreen';
import { profileSectionReturnTarget } from '../../identityScreens/ProviderProfileDetailScreen';
import type { OnboardingData } from '../useOnboardingData';

function requirement(
  categoryId: string,
  latestStatus: DocumentRequirement['latest_status'],
  satisfied = false,
): DocumentRequirement {
  const latestDocumentId = latestStatus ? `${categoryId}-latest` : null;
  return {
    doc_type: 'license',
    category_id: categoryId,
    category_name: categoryId === 'category-a' ? 'Electrical' : 'Plumbing',
    satisfied,
    approved_document_id: satisfied ? `${categoryId}-approved` : null,
    approved_status: satisfied ? 'approved' : null,
    latest_document_id: latestDocumentId,
    latest_status: latestStatus,
    effective_latest_status: latestStatus === 'superseded' ? null : latestStatus,
    expires_on: null,
    reject_reason: latestStatus === 'rejected' ? 'Upload a clearer copy.' : null,
  };
}

function dataFor(
  requirements: DocumentRequirement[],
  categoryDefinitions: { id: string; name: string; requires_docs?: string[]; recommended_docs?: string[] }[] = [
    { id: 'category-a', name: 'Electrical', requires_docs: ['license'], recommended_docs: ['safety'] },
    { id: 'category-b', name: 'Plumbing', requires_docs: ['license'] },
  ],
): OnboardingData {
  const documents: ProviderDocument[] = requirements.flatMap((item) => item.latest_document_id && item.latest_status
    ? [{
        id: item.latest_document_id,
        doc_type: item.doc_type,
        category_id: item.category_id,
        status: item.latest_status,
        reject_reason: item.reject_reason,
        expires_on: item.expires_on,
        created_at: item.latest_document_id,
      }]
    : []);
  return {
    state: {
      provider: null,
      profile: null,
      payout: null,
      documents,
      document_requirements: requirements,
      server_local_date: '2026-11-27',
      availability: [],
      time_off: [],
      portfolio: [],
      checks: [],
      go_live: { state: 'draft', reasons: [], paused: false },
      terms_version: 'v1',
    },
    categories: categoryDefinitions as never,
    services: categoryDefinitions.map((category, index) => ({
      id: `service-${index}`,
      category_id: category.id,
      active: true,
    }) as never),
    skills: [],
    docTypes: [
      { code: 'license', label: 'Trade license', description: '', has_expiry: true, sort_order: 1 },
      { code: 'safety', label: 'Safety training', description: '', has_expiry: false, sort_order: 2 },
    ],
  };
}

describe('O26-ID17 provider onboarding composition', () => {
  it('ID-WIZARD-SEVEN preserves resumable wizard keys and all six editable sections', () => {
    expect(STEP_KEYS).toEqual(['basics', 'services', 'area', 'hours', 'portfolio', 'payouts', 'review']);
    expect(Object.keys(SECTIONS)).toEqual(STEP_KEYS.filter((step) => step !== 'review'));
    expect(isSectionKey('services')).toBe(true);
    expect(isSectionKey('review')).toBe(false);

    const checks = ['name', 'photo', 'bio', 'languages', 'services', 'specialisations', 'area', 'hours', 'portfolio', 'payout']
      .map((key) => ({ key, ok: true, required: true }));
    expect(resumeStep({ provider: { submitted_at: null, onboarding_step: 4 } as never, checks } as never)).toBe(4);
    expect(resumeStep({ provider: { submitted_at: '2026-11-27T00:00:00Z', onboarding_step: 4 } as never, checks } as never)).toBe(6);
  });

  it('ID-SECTION-RETURNS preserves the services return target and defaults other sections to the hub', () => {
    expect(profileSectionReturnTarget('services')).toBe('/provider-profile/services');
    expect(profileSectionReturnTarget('hub')).toBe('/provider-profile');
    expect(profileSectionReturnTarget(undefined)).toBe('/provider-profile');
  });

  it('ID-REQUIRED-DOC-FIRST promotes only actionable canonical required credential repairs', () => {
    const data = dataFor([
      requirement('category-a', 'rejected'),
      requirement('category-b', null),
    ]);

    const repairs = requiredCredentialRepairs(data);
    expect(repairs.map((row) => row.key)).toEqual(['license:category-a', 'license:category-b']);
    expect(portfolioSectionOrder(true, repairs.length)).toEqual(['requiredCredentials', 'links', 'photos', 'documents']);
    expect(portfolioSectionOrder(false, repairs.length)).toEqual(['links', 'photos', 'documents']);
    expect(requiredCredentialRepairs(dataFor([requirement('category-a', 'pending')]))).toEqual([]);
  });

  it('ID-OPTIONAL-SKIP leaves recommended-only work optional and the wizard skip action unchanged', () => {
    const data = dataFor([], [
      { id: 'category-a', name: 'Electrical', recommended_docs: ['safety'] },
    ]);
    expect(requiredCredentialRepairs(data)).toEqual([]);
    expect(documentRows(data).find((row) => row.code === 'safety')?.need).toBe('recommended');
    expect(portfolioSectionOrder(true, 0)).toEqual(['links', 'photos', 'documents']);
    expect(portfolioPrimaryAction('wizard', 0)).toBe('Skip for now');
    expect(portfolioPrimaryAction('wizard', 2)).toBe('Continue');
    expect(portfolioPrimaryAction('edit', 0)).toBe('Done');
    expect(portfolioPrimaryAction('wizard', data.state.portfolio.length)).toBe('Skip for now');
  });

  it('ID-HUB-ACTION-FIRST places actual credential repairs ahead of weighted strength only in the new composition', () => {
    const repairs = requiredCredentialRepairs(dataFor([requirement('category-a', 'rejected')]));
    expect(shouldPrioritizeCredentialRepairs(true, repairs.length)).toBe(true);
    expect(shouldPrioritizeCredentialRepairs(true, 0)).toBe(false);
    expect(shouldPrioritizeCredentialRepairs(false, repairs.length)).toBe(false);
    expect(shouldPrioritizeCredentialRepairs(true, repairs.length, false)).toBe(false);
    expect(Object.keys(GO_LIVE_TITLE)).toEqual(['draft', 'under_review', 'action_needed', 'live', 'suspended', 'deactivated']);
  });

  it('ID-ONBOARDING-FLAG-PARENTS selects only the effective parent-and-leaf composition', () => {
    const cases = [
      { oorva_brand: false, oorva_onboarding_ux: false, expected: false },
      { oorva_brand: false, oorva_onboarding_ux: true, expected: false },
      { oorva_brand: true, oorva_onboarding_ux: false, expected: false },
      { oorva_brand: true, oorva_onboarding_ux: true, expected: true },
    ];
    for (const { oorva_brand, oorva_onboarding_ux, expected } of cases) {
      const features = { oorva_brand, oorva_onboarding_ux };
      expect(onboardingCompositionEnabled(
        isFeatureOn(features, 'oorva_brand'),
        isFeatureOn(features, 'oorva_onboarding_ux'),
      )).toBe(expected);
    }

    const publishedIdentity: NonNullable<BrandIdentityState['published']> = {
      schemaVersion: 1,
      displayName: 'Oorva',
      tagline: '',
      logoLight: null,
      logoDark: null,
      compactLight: null,
      compactDark: null,
    };
    const enabledIdentity: BrandIdentityState = {
      brandOn: true,
      runtimeOn: true,
      bundledIdentityReady: false,
      published: publishedIdentity,
    };
    expect(isFeatureOn({ oorva_brand: true, oorva_onboarding_ux: false }, 'oorva_onboarding_ux')).toBe(false);
    expect(resolveBrandIdentity('providerShare', enabledIdentity).displayName).toBe('Oorva');
    expect(resolveBrandIdentity('onboardingAgreement', enabledIdentity).displayName).toBe('Oorva');
    expect(resolveBrandIdentity('providerShare', { ...enabledIdentity, brandOn: false }).displayName).toBe('QuickServe');
    expect(resolveBrandIdentity('onboardingAgreement', { ...enabledIdentity, brandOn: false }).displayName).toBe('QuickServe');
  });

  it('ID-DEACTIVATION-DUTIES-COPY keeps the exact duties copy and existing cancel/confirm payload', async () => {
    expect(DEACTIVATION_CONFIRMATION_COPY).toBe(
      'Deactivation may require resolving currently blocking work first. Deactivation does not remove existing work or payment duties.',
    );
    for (const flags of [
      { oorva_brand: false, oorva_onboarding_ux: false },
      { oorva_brand: true, oorva_onboarding_ux: true },
    ]) {
      const oorvaComposition = onboardingCompositionEnabled(
        isFeatureOn(flags, 'oorva_brand'),
        isFeatureOn(flags, 'oorva_onboarding_ux'),
      );
      expect(DEACTIVATION_CONFIRMATION_COPY).toContain('does not remove existing work or payment duties');
      expect(oorvaComposition).toBe(flags.oorva_brand && flags.oorva_onboarding_ux);

      const confirm = jest.fn().mockResolvedValue(false);
      const deactivate = jest.fn().mockResolvedValue('done');
      await expect(confirmProviderDeactivation(confirm, deactivate)).resolves.toBeNull();
      expect(confirm).toHaveBeenCalledWith({
        title: 'Deactivate provider account?',
        message: DEACTIVATION_CONFIRMATION_COPY,
        confirmLabel: 'Deactivate',
        destructive: true,
      });
      expect(deactivate).not.toHaveBeenCalled();

      confirm.mockResolvedValue(true);
      await expect(confirmProviderDeactivation(confirm, deactivate)).resolves.toBe('done');
      expect(deactivate).toHaveBeenCalledTimes(1);
      expect(deactivate).toHaveBeenCalledWith(null);
    }
  });
});
