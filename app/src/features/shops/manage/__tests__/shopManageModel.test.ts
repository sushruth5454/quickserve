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
jest.mock('../../../../lib/locationContext', () => ({ useSelectedLocation: jest.fn() }));
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
const { getShopWorkspaceSectionOrder } = require('../../../marketplaceScreens/MerchantShopScreen') as {
  getShopWorkspaceSectionOrder: (input: {
    hasShop: boolean;
    canSetUpShop: boolean;
    workspaceEnabled: boolean;
  }) => Array<'readiness' | 'details' | 'catalogue'>;
};

const { default: MerchantShopScreen } = require('../../../marketplaceScreens/MerchantShopScreen') as {
  default: () => unknown;
};
const { default: MerchantEnquiriesScreen } = require('../../../marketplaceScreens/MerchantEnquiriesScreen') as {
  default: () => unknown;
};
const { default: ShopDetailsSection } = require('../ShopDetailsSection') as {
  default: (props: never) => unknown;
};
const { default: ProductEditorSection } = require('../ProductEditorSection') as {
  default: (props: never) => unknown;
};
const { shopManageActions } = require('../shopManageModel') as {
  shopManageActions: typeof import('../shopManageModel').shopManageActions;
};
const React = require('react') as Record<string, jest.Mock>;
const { useShopFeatureFlags } = require('../../components') as { useShopFeatureFlags: jest.Mock };
const { useSelectedLocation } = require('../../../../lib/locationContext') as { useSelectedLocation: jest.Mock };
const { useTheme } = require('../../../../theme') as { useTheme: jest.Mock };
const { useConfirm, useToast } = require('../../../../components/ui') as {
  useConfirm: jest.Mock;
  useToast: jest.Mock;
};

function renderShopScreenWithState(state: unknown[]) {
  let stateIndex = 0;
  const useStateSpy = jest.spyOn(React, 'useState');
  const useRefSpy = jest.spyOn(React, 'useRef');
  const useCallbackSpy = jest.spyOn(React, 'useCallback');
  const useEffectSpy = jest.spyOn(React, 'useEffect');
  useStateSpy.mockImplementation((initial: unknown) => {
    const value = stateIndex < state.length ? state[stateIndex] : initial;
    stateIndex += 1;
    return [value, jest.fn()];
  });
  useRefSpy.mockImplementation((initial: unknown) => ({ current: initial }));
  useCallbackSpy.mockImplementation((callback: unknown) => callback);
  useEffectSpy.mockImplementation(() => undefined);

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
    useEffectSpy.mockRestore();
    useCallbackSpy.mockRestore();
    useRefSpy.mockRestore();
    useStateSpy.mockRestore();
  }
}

function renderMerchantEnquiriesScreenWithState(state: unknown[]) {
  let stateIndex = 0;
  const useStateSpy = jest.spyOn(React, 'useState');
  const useCallbackSpy = jest.spyOn(React, 'useCallback');
  useStateSpy.mockImplementation((initial: unknown) => {
    const value = stateIndex < state.length ? state[stateIndex] : initial;
    stateIndex += 1;
    return [value, jest.fn()];
  });
  useCallbackSpy.mockImplementation((callback: unknown) => callback);
  useShopFeatureFlags.mockReturnValue({ enquiries: true });
  useTheme.mockReturnValue({
    spacing: { xs: 2, sm: 4, md: 8 },
    radii: { sm: 4, lg: 8 },
    colors: { surfaceAlt: 'surface-alt' },
  });

  try {
    return MerchantEnquiriesScreen();
  } finally {
    useCallbackSpy.mockRestore();
    useStateSpy.mockRestore();
  }
}

function createPersistentShopScreenRenderer(initialState: unknown[]) {
  const hookState = [...initialState];
  let stateIndex = 0;
  let theme = {
    spacing: { xs: 2, sm: 4, md: 8 },
    radii: { sm: 4, lg: 8 },
    colors: { surfaceAlt: 'surface-alt' },
  };
  const useStateSpy = jest.spyOn(React, 'useState');
  const useRefSpy = jest.spyOn(React, 'useRef');
  const useCallbackSpy = jest.spyOn(React, 'useCallback');
  const useEffectSpy = jest.spyOn(React, 'useEffect');

  const render = () => {
    stateIndex = 0;
    useStateSpy.mockImplementation((initial: unknown) => {
      const currentIndex = stateIndex++;
      if (currentIndex >= hookState.length) hookState[currentIndex] = initial;
      return [
        hookState[currentIndex],
        (next: unknown) => {
          const current = hookState[currentIndex];
          hookState[currentIndex] = typeof next === 'function'
            ? (next as (value: unknown) => unknown)(current)
            : next;
        },
      ];
    });
    useRefSpy.mockImplementation((initial: unknown) => ({ current: initial }));
    useCallbackSpy.mockImplementation((callback: unknown) => callback);
    useEffectSpy.mockImplementation(() => undefined);
    useShopFeatureFlags.mockReturnValue({ products: true });
    useSelectedLocation.mockReturnValue({ location: { lat: 0, lng: 0 } });
    useTheme.mockReturnValue(theme);
    useConfirm.mockReturnValue(jest.fn());
    useToast.mockReturnValue(jest.fn());
    return MerchantShopScreen();
  };

  return {
    render,
    setTheme(nextTheme: typeof theme) {
      theme = nextTheme;
    },
    restore() {
      useEffectSpy.mockRestore();
      useCallbackSpy.mockRestore();
      useRefSpy.mockRestore();
      useStateSpy.mockRestore();
    },
  };
}

type ScreenElement = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function collectElements(node: unknown, elements: ScreenElement[] = []): ScreenElement[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, elements));
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ScreenElement;
    elements.push(element);
    collectElements(element.props.children, elements);
    if (element.type === ShopDetailsSection) {
      collectElements((ShopDetailsSection as (props: never) => unknown)(element.props as never), elements);
    } else if (element.type === ProductEditorSection) {
      collectElements((ProductEditorSection as (props: never) => unknown)(element.props as never), elements);
    }
  }
  return elements;
}

beforeEach(() => {
  Object.assign(mockFlags, {
    products: true,
    product_rfq: true,
    merchant_staff: true,
    oorva_brand: false,
    oorva_merchant_shop_ux: false,
  });
});

it('MK-MANAGE-suspended-product-edit keeps owner details save but disables product edits and submission', () => {
  expect(shopManageActions({
    shop: { business_role: 'owner', status: 'suspended' },
    actualOwner: true,
    productsEnabled: true,
  })).toEqual({ canEditProducts: false, canSubmit: false, canSaveDetails: true });
});

it('MK-MANAGE-owner-member-actions allows only enabled actual owners to manage products', () => {
  const shop = { business_role: 'owner' as const, status: 'draft' as const };
  expect(shopManageActions({ shop, actualOwner: true, productsEnabled: true })).toEqual({
    canEditProducts: true,
    canSubmit: true,
    canSaveDetails: true,
  });
  expect(shopManageActions({
    shop: { business_role: 'manager', status: 'draft' },
    actualOwner: false,
    productsEnabled: true,
  })).toEqual({ canEditProducts: false, canSubmit: false, canSaveDetails: false });
  expect(shopManageActions({
    shop: { business_role: 'staff', status: 'draft' },
    actualOwner: false,
    productsEnabled: true,
  })).toEqual({ canEditProducts: false, canSubmit: false, canSaveDetails: false });
  expect(shopManageActions({ shop, actualOwner: true, productsEnabled: false })).toEqual({
    canEditProducts: false,
    canSubmit: false,
    canSaveDetails: false,
  });
  expect(shopManageActions({ shop: { ...shop, business_role: 'manager' }, actualOwner: true, productsEnabled: true }))
    .toEqual({ canEditProducts: false, canSubmit: false, canSaveDetails: false });
});

it('MK-MANAGE-refreshed-suspension disables an editor after the shop status refreshes', () => {
  const shop = { business_role: 'owner' as const, status: 'verified' as const };
  const before = shopManageActions({ shop, actualOwner: true, productsEnabled: true });
  const after = shopManageActions({
    shop: { ...shop, status: 'suspended' },
    actualOwner: true,
    productsEnabled: true,
  });

  expect(before.canEditProducts).toBe(true);
  expect(after.canEditProducts).toBe(false);
  expect(after.canSaveDetails).toBe(true);
});

it('MK-HOST-refreshed-suspension disables a stale product editor but keeps the catalogue and removal', () => {
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
  expect(buttons.find((button) => button.props.title === 'Save shop details')?.props.disabled).toBe(false);
  expect(buttons.find((button) => button.props.title === 'Submit for verification')).toBeUndefined();
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

it('MK-WORKSPACE-new-existing-priority', () => {
  expect(getShopWorkspaceSectionOrder({
    hasShop: false,
    canSetUpShop: true,
    workspaceEnabled: true,
  })).toEqual(['details']);
  expect(getShopWorkspaceSectionOrder({
    hasShop: true,
    canSetUpShop: true,
    workspaceEnabled: true,
  })).toEqual(['readiness', 'catalogue', 'details']);
  expect(getShopWorkspaceSectionOrder({
    hasShop: true,
    canSetUpShop: true,
    workspaceEnabled: false,
  })).toEqual(['readiness', 'details', 'catalogue']);
  expect(getShopWorkspaceSectionOrder({
    hasShop: false,
    canSetUpShop: false,
    workspaceEnabled: true,
  })).toEqual([]);

  const existingShop = {
    id: 'shop-1',
    owner_id: 'owner-1',
    business_role: 'owner',
    name: 'Existing shop',
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
    status: 'draft',
    status_reason: null,
    category_slugs: [],
  };
  const stateFor = (shop: unknown) => [
    shop, {}, [], [], {}, '', [], null, null, null, false, false, true, false,
  ];

  mockFlags.oorva_brand = true;
  mockFlags.oorva_merchant_shop_ux = true;
  const enabledElements = collectElements(renderShopScreenWithState(stateFor(existingShop)));
  expect(enabledElements
    .filter((element) => element.type === ShopDetailsSection || element.type === ProductEditorSection)
    .map((element) => element.type)).toEqual([ProductEditorSection, ShopDetailsSection]);

  mockFlags.oorva_merchant_shop_ux = false;
  const legacyElements = collectElements(renderShopScreenWithState(stateFor(existingShop)));
  expect(legacyElements
    .filter((element) => element.type === ShopDetailsSection || element.type === ProductEditorSection)
    .map((element) => element.type)).toEqual([ShopDetailsSection, ProductEditorSection]);

  const enquiryElements = collectElements(renderMerchantEnquiriesScreenWithState([[
    {
      id: 'enquiry-1',
      shop_id: 'shop-1',
      shop_name: 'Existing shop',
      product_name: 'Door handle',
      customer_name: 'Customer',
      status: 'open',
      last_message_at: '2026-01-01T00:00:00.000Z',
      shop_unread: 2,
    },
  ], null, false, true]));
  const inboxRow = enquiryElements.find((element) => element.type === 'ListItem');
  const manageButton = enquiryElements.find((element) => element.type === 'Button' && element.props.title === 'Manage my shop');
  const inboxIndex = enquiryElements.findIndex((element) => element.type === 'ListItem');
  const manageIndex = enquiryElements.findIndex((element) => element.type === 'Button' && element.props.title === 'Manage my shop');
  const unreadChildren = (inboxRow?.props.right as ScreenElement | undefined)?.props.children;
  expect(inboxRow?.props.subtitle).toContain('Existing shop');
  expect(Array.isArray(unreadChildren) ? unreadChildren.join('') : unreadChildren).toBe('2 new');
  expect(manageButton).toBeDefined();
  expect(inboxIndex).toBeGreaterThanOrEqual(0);
  expect(inboxIndex).toBeLessThan(manageIndex);
});

it('MK-WORKSPACE-dirty-draft-preserved', () => {
  const shop = {
    id: 'shop-1',
    owner_id: 'owner-1',
    business_role: 'owner',
    name: 'Saved shop',
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
    status: 'draft',
    status_reason: null,
    category_slugs: [],
  };
  const draft = {
    name: shop.name,
    description: shop.description,
    address_line: shop.address_line,
    city: shop.city,
    area: shop.area,
    lat: shop.lat,
    lng: shop.lng,
    delivery_radius_km: shop.delivery_radius_km,
    offers_delivery: shop.offers_delivery,
    offers_pickup: shop.offers_pickup,
    whatsapp_contact: shop.whatsapp_contact,
    gstin: shop.gstin,
    category_slugs: shop.category_slugs,
  };
  const renderer = createPersistentShopScreenRenderer([
    shop, draft, [], [], {}, '', [], null, null, null, false, false, true, false,
  ]);
  const requireDetails = (tree: unknown) => {
    const details = collectElements(tree).find((element) => element.type === ShopDetailsSection);
    if (!details) throw new Error('Expected shop details presentation in the workspace');
    return details;
  };
  const requireShopNameInput = (props: Record<string, unknown>) => {
    const input = collectElements(
      (ShopDetailsSection as (input: never) => unknown)(props as never),
    ).find((element) => element.type === 'Input' && element.props.label === 'Shop name');
    if (!input) throw new Error('Expected shop name field in expanded details');
    return input;
  };

  try {
    mockFlags.oorva_brand = true;
    mockFlags.oorva_merchant_shop_ux = true;
    let details = requireDetails(renderer.render());
    expect(details?.props.collapsed).toBe(true);
    (details?.props.onToggle as () => void)();
    details = requireDetails(renderer.render());
    expect(details?.props.collapsed).toBe(false);
    const shopNameInput = requireShopNameInput(details.props);
    (shopNameInput?.props.onChangeText as (value: string) => void)('Unsaved context');

    renderer.setTheme({
      spacing: { xs: 3, sm: 6, md: 12 },
      radii: { sm: 6, lg: 12 },
      colors: { surfaceAlt: 'updated-surface-alt' },
    });
    mockFlags.oorva_brand = false;
    mockFlags.oorva_merchant_shop_ux = true;
    details = requireDetails(renderer.render());
    expect(details?.props.collapsed).toBe(false);
    expect(requireShopNameInput(details.props).props.value).toBe('Unsaved context');

    mockFlags.oorva_brand = true;
    details = requireDetails(renderer.render());
    expect(requireShopNameInput(details.props).props.value).toBe('Unsaved context');
    (details?.props.onToggle as () => void)();
    details = requireDetails(renderer.render());
    expect(details?.props.collapsed).toBe(true);
    expect((details?.props.draft as typeof draft).name).toBe('Unsaved context');
  } finally {
    renderer.restore();
  }
});

it('MK-WORKSPACE-off-guards', () => {
  const shop = {
    id: 'shop-1',
    owner_id: 'owner-1',
    business_role: 'owner',
    name: 'Existing shop',
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
    status: 'draft',
    status_reason: null,
    category_slugs: [],
  };
  const state = [shop, {}, [], [], {}, '', [], null, null, null, false, false, true, false];
  const disabledCombinations: Array<[boolean, boolean]> = [[false, false], [true, false], [false, true]];
  for (const [brand, workspace] of disabledCombinations) {
    mockFlags.oorva_brand = brand;
    mockFlags.oorva_merchant_shop_ux = workspace;
    const sectionTypes = collectElements(renderShopScreenWithState(state))
      .filter((element) => element.type === ShopDetailsSection || element.type === ProductEditorSection)
      .map((element) => element.type);
    expect(sectionTypes).toEqual([ShopDetailsSection, ProductEditorSection]);
  }

  expect(shopManageActions({
    shop: { business_role: 'manager', status: 'draft' },
    actualOwner: false,
    productsEnabled: true,
  })).toEqual({ canEditProducts: false, canSubmit: false, canSaveDetails: false });
  expect(shopManageActions({
    shop: { business_role: 'owner', status: 'suspended' },
    actualOwner: true,
    productsEnabled: true,
  })).toEqual({ canEditProducts: false, canSubmit: false, canSaveDetails: true });
});
