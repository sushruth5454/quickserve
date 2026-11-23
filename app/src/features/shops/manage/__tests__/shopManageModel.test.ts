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

const { default: MerchantShopScreen } = require('../../../marketplaceScreens/MerchantShopScreen') as {
  default: () => unknown;
};
const React = require('react') as any;
const { useShopFeatureFlags } = require('../../components') as { useShopFeatureFlags: jest.Mock };
const { useSelectedLocation } = require('../../../../lib/locationContext') as { useSelectedLocation: jest.Mock };
const { useTheme } = require('../../../../theme') as { useTheme: jest.Mock };
const { useConfirm, useToast } = require('../../../../components/ui') as {
  useConfirm: jest.Mock;
  useToast: jest.Mock;
};

function renderShopScreenWithState(state: unknown[]) {
  let stateIndex = 0;
  const hookSpies = ['useState', 'useRef', 'useCallback', 'useEffect'].map((hook) => jest.spyOn(React, hook));
  hookSpies[0].mockImplementation((initial: unknown) => {
    const value = stateIndex < state.length ? state[stateIndex] : initial;
    stateIndex += 1;
    return [value, jest.fn()];
  });
  hookSpies[1].mockImplementation((initial: unknown) => ({ current: initial }));
  hookSpies[2].mockImplementation((callback: unknown) => callback);
  hookSpies[3].mockImplementation(() => undefined);

  useShopFeatureFlags.mockReturnValue({ products: true });
  useSelectedLocation.mockReturnValue({ location: { lat: 0, lng: 0 } });
  useTheme.mockReturnValue({
    spacing: { xs: 2, sm: 4, md: 8 },
    radii: { sm: 4, lg: 8 },
    colors: { surfaceAlt: 'surface-alt' },
  });
  useConfirm.mockReturnValue(jest.fn());
  useToast.mockReturnValue(jest.fn());

  try {
    return MerchantShopScreen();
  } finally {
    hookSpies.forEach((spy) => spy.mockRestore());
  }
}

function collectElements(node: unknown, elements: any[] = []): any[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, elements));
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as { props: { children?: unknown } };
    elements.push(node);
    collectElements(element.props.children, elements);
  }
  return elements;
}

beforeEach(() => {
  Object.assign(mockFlags, { products: true, product_rfq: true, merchant_staff: true });
});

it('MK-MANAGE-refreshed-suspension disables a stale product editor but keeps the catalogue and removal', () => {
  const shop = {
    id: 'shop-1',
    owner_id: 'owner-1',
    business_role: 'owner',
    name: 'Suspended Shop',
    description: '',
    address_line: '',
    city: 'Pune',
    area: '',
    lat: null,
    lng: null,
    delivery_radius_km: 10,
    offers_delivery: false,
    offers_pickup: true,
    whatsapp_contact: false,
    gstin: null,
    status: 'suspended',
    status_reason: 'Verification needs attention',
    category_slugs: ['building-materials'],
  };
  const product = {
    id: 'product-1',
    shop_id: shop.id,
    category_id: 'category-1',
    category_slug: 'building-materials',
    category_name: 'Building materials',
    name: 'Existing catalogue item',
    brand: '',
    model: '',
    description: '',
    specs: {},
    unit: 'piece',
    indicative_price_paise: null,
    price_updated_at: null,
    in_stock: true,
    active: true,
    image_paths: [],
  };
  const staleDraft = {
    id: product.id,
    categoryId: product.category_id,
    name: product.name,
    brand: '',
    model: '',
    description: '',
    specs: {},
    unit: 'piece',
    priceText: '',
    inStock: true,
    active: true,
    existingPaths: [],
    previousPaths: [],
    newPhotos: [],
  };
  const elements = collectElements(renderShopScreenWithState([
    shop,
    {},
    [],
    [product],
    {},
    '',
    [],
    staleDraft,
    null,
    null,
    false,
    false,
    true,
  ]));
  const buttons = elements.filter((element) => element.type === 'Button');
  const saveButton = buttons.find((button) => button.props.title === 'Save product');

  expect(saveButton === undefined || saveButton.props.disabled === true).toBe(true);
  expect(buttons.find((button) => button.props.title === 'Add product')?.props.disabled).toBe(true);
  expect(buttons.find((button) => button.props.title === 'Edit')?.props.disabled).toBe(true);
  expect(buttons.find((button) => button.props.title === 'Remove')?.props.disabled).toBe(false);
  expect(elements.some((element) => element.type === 'Text' && element.props.children === 'Verification needs attention')).toBe(true);
  expect(elements.some((element) => element.type === 'Text' && element.props.children === 'Existing catalogue item')).toBe(true);
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
