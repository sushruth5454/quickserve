import React from 'react';

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFocusCallbacks = new Set<() => void>();
const mockInputChanges = new Map<string, (value: string) => void>();
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockConfirm = jest.fn<Promise<boolean>, [Record<string, unknown>]>();
const mockToast = jest.fn();
const mockGetAdminRules = jest.fn();
const mockSaveAdminRules = jest.fn();
let mockFeatureEnabled = true;

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useFocusEffect(callback: () => void | (() => void)) {
      const callbackRef = ReactModule.useRef(callback);
      callbackRef.current = callback;
      ReactModule.useEffect(() => {
        const focus = () => {
          const result = callbackRef.current();
          return typeof result === 'function' ? result : undefined;
        };
        mockFocusCallbacks.add(focus);
        focus();
        return () => {
          mockFocusCallbacks.delete(focus);
        };
      }, []);
    },
  };
});

jest.doMock('react-native', () => {
  const ReactModule = require('react') as typeof React;
  return {
    View: 'div',
    Switch: ({ accessibilityLabel, value, onValueChange }: {
      accessibilityLabel: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
    }) => ReactModule.createElement('input', {
      type: 'checkbox',
      'aria-label': accessibilityLabel,
      checked: value,
      onChange: (event: { currentTarget: { checked: boolean } }) => onValueChange(event.currentTarget.checked),
    }),
  };
});

jest.doMock('../ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Button: ({ title, onPress, disabled, loading }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => ReactModule.createElement('button', {
      type: 'button',
      'aria-label': title,
      disabled: disabled || loading,
      onClick: onPress,
    }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    ErrorState: ({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) =>
      ReactModule.createElement('div', null, title, message,
        ReactModule.createElement('button', { type: 'button', onClick: onRetry }, 'Retry')),
    Header: ({ title, onBack }: { title: string; onBack?: () => void }) =>
      ReactModule.createElement('header', null, title,
        onBack ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Header back', onClick: onBack }, 'Back') : null),
    InlineAlert: ({ message }: { message: string | null }) => message
      ? ReactModule.createElement('div', { role: 'alert' }, message)
      : null,
    Input: ({ label, value, onChangeText }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
    }) => {
      mockInputChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label,
        ReactModule.createElement('input', {
          'aria-label': label,
          value,
          onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
        }));
    },
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    Skeleton: () => ReactModule.createElement('div', null, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    useConfirm: () => mockConfirm,
    useToast: () => mockToast,
  };
});

jest.doMock('../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({
    isOn: (key: string) => key === 'admin_rules_editor' && mockFeatureEnabled,
  }),
}));

jest.doMock('../../theme', () => ({
  useTheme: () => ({ spacing: { sm: 8, md: 16 }, radii: { lg: 16 } }),
}));

jest.doMock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

jest.doMock('../../lib/adminRulesApi', () => {
  const actual = jest.requireActual('../../lib/adminRulesApi');
  return {
    ...actual,
    getAdminRules: mockGetAdminRules,
    saveAdminRules: mockSaveAdminRules,
  };
});

const AdminRulesScreen = require('../../../app/admin/rules').default as React.ComponentType;
const { getAdminRules, saveAdminRules } = require('../../lib/adminRulesApi') as {
  getAdminRules: jest.Mock;
  saveAdminRules: jest.Mock;
};
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => TestRoot;
};
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = {
  render: (element: React.ReactElement) => void;
  unmount: () => void;
};

function makeRules(horizonDays = 28, paymentHoldMinutes = 10) {
  return {
    recurring: {
      frequencies: ['weekly'],
      horizon_days: horizonDays,
      max_plan_days: 365,
      skip_cutoff_hours: 12,
      reschedule_cutoff_hours: 12,
      reminder_hours_before: 12,
      payment_due_hours_before: 24,
      billing_grace_hours: 24,
      payment_frequencies: ['per_visit'],
      recurring_discount_bp: 0,
    },
    sports: {
      payment_hold_minutes: paymentHoldMinutes,
      approval_pay_window_minutes: 60,
      max_active_holds_per_customer: 3,
      request_response_minutes: 120,
      min_lead_minutes: 30,
      commission_bp: 1000,
      customer_fee_paise: 1990,
      full_refund_hours: 24,
      partial_refund_hours: 6,
      partial_refund_bp: 5000,
      release_after_hours: 24,
    },
  };
}

let mockServerRules = makeRules();
let mockRoot: TestRoot | undefined;

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount() {
  await testAct(async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mockRoot = createRoot(container);
    mockRoot.render(React.createElement(AdminRulesScreen));
    await flushMicrotasks();
  });
}

async function press(label: string) {
  const button = document.querySelector(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await testAct(async () => {
    button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks();
  });
}

async function changeInput(label: string, value: string) {
  const change = mockInputChanges.get(label);
  expect(change).toBeDefined();
  await testAct(() => change?.(value));
}

function inputValue(label: string) {
  return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.value;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.clear();
  mockInputChanges.clear();
  mockFeatureEnabled = true;
  mockServerRules = makeRules();
  mockGetAdminRules.mockImplementation(async () => mockServerRules);
  mockSaveAdminRules.mockImplementation(async (_key: string, value: unknown) => value);
  mockConfirm.mockResolvedValue(false);
  mockRouter.canGoBack.mockReturnValue(true);
});

afterEach(async () => {
  if (mockRoot) {
    await testAct(async () => {
      mockRoot?.unmount();
      await flushMicrotasks();
    });
  }
  mockRoot = undefined;
  document.body.innerHTML = '';
});

describe('AdminRulesScreen', () => {
  it('CM_RULES_DIRTY_FOCUS keeps dirty group drafts through navigation and refreshes only clean groups', async () => {
    await mount();
    await changeInput('Booking horizon (days)', '31');

    mockServerRules = makeRules(35, 15);
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await press('Geography');

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Discard unsaved changes?',
      confirmLabel: 'Discard changes',
    }));
    expect(mockRouter.push).not.toHaveBeenCalled();

    await testAct(async () => {
      for (const focus of [...mockFocusCallbacks]) focus();
      await flushMicrotasks();
    });

    expect(inputValue('Booking horizon (days)')).toBe('31');
    expect(inputValue('Payment hold (minutes)')).toBe('15');

    await press('Geography');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/geography');
    expect(inputValue('Booking horizon (days)')).toBe('28');
  });

  it('CM_RULES_OFF_ROUTE explains the disabled route and provides a back action without rule RPCs', async () => {
    mockFeatureEnabled = false;
    await mount();

    expect(document.body.textContent).toContain('Booking rules are unavailable');
    expect(document.querySelector('button[aria-label="Back to admin"]')).not.toBeNull();
    expect(getAdminRules).not.toHaveBeenCalled();
    expect(saveAdminRules).not.toHaveBeenCalled();

    await press('Back to admin');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(getAdminRules).not.toHaveBeenCalled();
    expect(saveAdminRules).not.toHaveBeenCalled();
  });

  it('CM_RULES_PARTIAL_SAVE retains the sports draft and reports the exact recurring-only outcome', async () => {
    await mount();
    await changeInput('Payment hold (minutes)', '15');
    mockSaveAdminRules.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'recurring_rules') return value;
      throw new Error('sports write rejected');
    });

    await press('Save booking rules');

    expect(mockSaveAdminRules).toHaveBeenNthCalledWith(1, 'recurring_rules', expect.any(Object));
    expect(mockSaveAdminRules).toHaveBeenNthCalledWith(2, 'sports_rules', expect.any(Object));
    expect(inputValue('Payment hold (minutes)')).toBe('15');
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toBe('Recurring rules were saved. Sports rules were not saved: sports write rejected');
  });
});
