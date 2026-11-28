jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native', () => ({ View: 'View', Switch: 'Switch' }));
jest.mock('../../../components/ui', () => ({
  Button: 'Button', Card: 'Card', Chip: 'Chip', Header: 'Header', InlineAlert: 'InlineAlert',
  Input: 'Input', Screen: 'Screen', Section: 'Section', SegmentedControl: 'SegmentedControl',
  Skeleton: 'Skeleton', Text: 'Text', TextArea: 'TextArea', useToast: () => jest.fn(),
}));
jest.mock('../../../branding/FeatureFlagsProvider', () => ({
  DEFAULT_FEATURES: { archetypes: { proposal: true } },
  useAppFeatureFlags: () => ({ archetypes: { proposal: true }, isOn: () => true }),
  useFeature: () => true,
  useFeatureControlHydrationReady: () => true,
  useFeatureControlState: () => ({ features: { archetypes: { proposal: true } }, freshness: 'live', appearanceCandidate: null, refresh: jest.fn() }),
}));
jest.mock('../../../lib/api', () => ({}));
jest.mock('../../../lib/locationContext', () => ({ useSelectedLocation: () => ({ location: {} }) }));
jest.mock('../../../lib/money', () => ({ formatINR: jest.fn(), rupeesToPaise: jest.fn() }));
jest.mock('../../../lib/schedule', () => ({ relativeTimeLabel: jest.fn(), URGENT_MIN_HOURS: 2, urgentStartOptions: jest.fn(() => []) }));
jest.mock('../../catalogue/api', () => ({ getCatalogueCategoryById: jest.fn(), getCataloguePackage: jest.fn() }));
jest.mock('../../catalogue/SchemaForm', () => ({ SchemaForm: 'SchemaForm' }));
jest.mock('../api', () => ({ getCreatorProposalConfig: jest.fn(), sendProposalWithDeadline: jest.fn(), getRequestRecipientCount: jest.fn() }));

import { isProposalComposeReady } from '../../serviceScreens/ProposalComposeDetailScreen';
import { isProposalRequestReady } from '../../serviceScreens/RequestNewScreen';

const composeBase = {
  controlsHydrated: true,
  freshness: 'live' as const,
  proposalEnabled: true,
  requestResolved: true,
  configResolved: true,
};

const requestBase = {
  controlsHydrated: true,
  freshness: 'live' as const,
  proposalEnabled: true,
  categoryResolved: true,
  categoryValid: true,
  packageResolved: true,
};

function assertReadiness(actual: boolean, expected: boolean, input: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected readiness=${expected}; actual=${JSON.stringify({ actual, input })}`);
  }
}

describe('new proposal readiness', () => {
  it('resolvedConfigRequired', () => {
    const input = { ...composeBase, configResolved: false };
    assertReadiness(isProposalComposeReady(input), false, input);
    assertReadiness(isProposalComposeReady({ ...input, configResolved: true }), true, { ...input, configResolved: true });
  });

  it('parentOff', () => {
    const compose = { ...composeBase, proposalEnabled: false };
    const request = { ...requestBase, proposalEnabled: false };
    assertReadiness(isProposalComposeReady(compose), false, compose);
    assertReadiness(isProposalRequestReady(request), false, request);
  });

  it('unresolved or failed parent state fails closed before request controls render', () => {
    const composeFallback = { ...composeBase, freshness: 'fallback' as const };
    const requestFallback = { ...requestBase, freshness: 'fallback' as const };
    const composeError = { ...composeBase, freshness: 'error' as const };
    const requestError = { ...requestBase, freshness: 'error' as const };
    assertReadiness(isProposalComposeReady(composeFallback), false, composeFallback);
    assertReadiness(isProposalRequestReady(requestFallback), false, requestFallback);
    assertReadiness(isProposalComposeReady(composeError), false, composeError);
    assertReadiness(isProposalRequestReady(requestError), false, requestError);
  });

  it('request category schema must resolve before request controls render', () => {
    const input = { ...requestBase, categoryResolved: false };
    assertReadiness(isProposalRequestReady(input), false, input);
  });
});
