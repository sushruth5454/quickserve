const mockFlags: Record<string, boolean> = {};

jest.mock('../../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: (key: string) => mockFlags[key] === true }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('../../../../components/ui', () => ({
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  EmptyState: 'EmptyState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  ListItem: 'ListItem',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
  TextArea: 'TextArea',
  useConfirm: jest.fn(),
  useToast: jest.fn(),
}));
jest.mock('../../../providerOnboarding/media', () => ({ pickPhoto: jest.fn() }));
jest.mock('../../api', () => ({}));
jest.mock('../../components', () => ({
  FeatureUnavailable: 'FeatureUnavailable',
  IndicativePrice: 'IndicativePrice',
  ShopStatusLabel: 'ShopStatusLabel',
  useShopFeatureFlags: jest.fn(),
}));
jest.mock('../../SpecFields', () => ({ SpecFields: 'SpecFields' }));
jest.mock('../../format', () => ({ UNIT_LABELS: {} }));
jest.mock('../../specs', () => ({ cleanSpecs: jest.fn() }));
jest.mock('../../../../lib/locationContext', () => ({}));
jest.mock('../../../../lib/places', () => ({ newPlacesSession: jest.fn() }));
jest.mock('../../../../lib/onboarding/validation', () => ({ parseRupees: jest.fn() }));
jest.mock('../../../../theme', () => ({ useTheme: jest.fn() }));

const { useRfqFeatureFlags } = require('../../../rfq/components') as {
  useRfqFeatureFlags: () => { rfq: boolean; enquiries: boolean };
};
const { getShopManagementLinks } = require('../../../marketplaceScreens/MerchantShopScreen') as {
  getShopManagementLinks: (
    role: 'owner' | 'manager' | 'staff',
    capabilities: { merchantStaff: boolean; rfq: boolean },
  ) => { staffManagement: boolean; supplierRfqs: boolean };
};

beforeEach(() => {
  Object.assign(mockFlags, { products: true, product_rfq: true, merchant_staff: true });
});

it('MK-GATE-staff-RFQ-links gates only the unavailable role-specific discovery links', () => {
  mockFlags.products = false;
  mockFlags.product_rfq = true;
  const rfqWithParentOff = useRfqFeatureFlags().rfq;

  expect(rfqWithParentOff).toBe(false);
  expect(getShopManagementLinks('staff', { merchantStaff: true, rfq: rfqWithParentOff })).toEqual({
    staffManagement: false,
    supplierRfqs: false,
  });

  mockFlags.products = true;
  mockFlags.product_rfq = false;
  const rfqChildOff = useRfqFeatureFlags().rfq;
  expect(getShopManagementLinks('owner', { merchantStaff: true, rfq: rfqChildOff })).toEqual({
    staffManagement: true,
    supplierRfqs: false,
  });
  expect(getShopManagementLinks('staff', { merchantStaff: false, rfq: rfqChildOff })).toEqual({
    staffManagement: false,
    supplierRfqs: false,
  });

  mockFlags.product_rfq = true;
  const rfqEnabled = useRfqFeatureFlags().rfq;
  expect(getShopManagementLinks('staff', { merchantStaff: false, rfq: rfqEnabled })).toEqual({
    staffManagement: false,
    supplierRfqs: true,
  });
  expect(getShopManagementLinks('owner', { merchantStaff: false, rfq: rfqEnabled })).toEqual({
    staffManagement: false,
    supplierRfqs: false,
  });
});
