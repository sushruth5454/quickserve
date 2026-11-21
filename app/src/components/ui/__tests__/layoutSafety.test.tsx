import type { ReactElement } from 'react';
import { DemoDataIndicator, getDemoDisclosureSlotHeight } from '../../DemoDataIndicator';
import { BottomSheet } from '../BottomSheet';
import { Header, Screen, screenToastOffset, StickyFooter, tabBarHeight } from '../Screen';
import { ToastProvider } from '../Toast';
import { withSpring, withTiming } from 'react-native-reanimated';

type TestElement = ReactElement<Record<string, any>>;
type TestGlobal = typeof globalThis & { __o07aStateOverrides?: unknown[] };

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useContext: () => false,
    useEffect: (effect: () => void) => effect(),
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const overrides = (globalThis as TestGlobal).__o07aStateOverrides;
      return [overrides?.length ? overrides.shift() : initial, jest.fn()];
    },
  };
});

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ height: 812, width: 320 }),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => false, replace: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  FadeIn: { duration: jest.fn(() => 'FadeIn') },
  FadeInUp: { springify: () => ({ damping: () => 'FadeInUp' }) },
  FadeOut: { duration: jest.fn(() => 'FadeOut') },
  FadeOutDown: { springify: () => ({ damping: () => 'FadeOutDown' }) },
  LinearTransition: 'LinearTransition',
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useReducedMotion: () => true,
  useSharedValue: (value: unknown) => ({ value }),
  withSpring: jest.fn((value: unknown) => value),
  withTiming: jest.fn((value: unknown) => value),
}));
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => ({
      onEnd() { return this; },
      onUpdate() { return this; },
    }),
  },
  GestureDetector: 'GestureDetector',
  GestureHandlerRootView: 'GestureHandlerRootView',
}));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: jest.fn() }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    dark: false,
    colors: {
      bg: 'bg-token',
      border: 'border-token',
      borderStrong: 'border-strong-token',
      danger: 'danger-token',
      dangerSoft: 'danger-soft-token',
      dangerText: 'danger-text-token',
      info: 'info-token',
      onPrimary: 'on-primary-token',
      overlay: 'overlay-token',
      primary: 'primary-token',
      surfaceAlt: 'surface-alt-token',
      surfaceOverlay: 'surface-overlay-token',
      success: 'success-token',
      textSecondary: 'text-secondary-token',
      toastBg: 'toast-bg-token',
      toastBorder: 'toast-border-token',
      warning: 'warning-token',
      warningSoft: 'warning-soft-token',
      warningText: 'warning-text-token',
    },
    motion: { base: 220, fast: 150, easing: { exit: {} } },
    radii: { md: 12, pill: 999, xl: 24 },
    shadows: { footer: {}, lg: {} },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  }),
}));
jest.mock('../../../lib/config', () => ({ isSeedDemoMode: true }));
jest.mock('../../../lib/haptics', () => ({ haptics: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../IconButton', () => ({ IconButton: 'IconButton' }));
jest.mock('../Text', () => ({ Text: 'Text' }));

function findElements(node: unknown, type: unknown): TestElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!node || typeof node !== 'object') return [];
  const element = node as TestElement;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props?.children, type),
  ];
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

function setStateOverrides(...states: unknown[]) {
  (globalThis as TestGlobal).__o07aStateOverrides = states;
}

describe('layout safety', () => {
  beforeEach(() => {
    (globalThis as TestGlobal).__o07aStateOverrides = [];
    jest.clearAllMocks();
  });

  it('reserves the disclosure outside CTA, tab and toast bounds at 320px with large text', () => {
    const indicator = DemoDataIndicator();
    const slot = findElements(indicator, 'View')[0];
    const slotHeight = getDemoDisclosureSlotHeight(34, true);
    const viewportHeight = 812;
    const insets = { top: 44, right: 0, bottom: 34, left: 0 };
    const slotTop = viewportHeight - slotHeight;
    const tabTop = slotTop - tabBarHeight(insets);
    const tabToastBottom = viewportHeight - screenToastOffset({
      hasFooter: false,
      footerHeight: 0,
      inTabs: true,
      bottomInset: insets.bottom,
      demoDisclosureEnabled: true,
    });
    const measuredLargeTextFooter = 196;
    const footerTop = slotTop - measuredLargeTextFooter;
    const footerToastBottom = viewportHeight - screenToastOffset({
      hasFooter: true,
      footerHeight: measuredLargeTextFooter,
      inTabs: false,
      bottomInset: insets.bottom,
      demoDisclosureEnabled: true,
    });

    expect(slotHeight).toBe(74);
    expect(slot?.props.pointerEvents).toBe('none');
    expect(slot?.props.accessibilityLabel).toBe('Demo data only. No real payments.');
    expect(flattenStyle(slot?.props.style)).toMatchObject({ height: slotHeight });
    expect(flattenStyle(slot?.props.style)).not.toHaveProperty('position');
    expect(findElements(indicator, 'Text').map((node) => node.props.children)).toContain('DEMO DATA');
    expect(tabToastBottom).toBe(tabTop - 8);
    expect(footerTop + measuredLargeTextFooter).toBe(slotTop);
    expect(footerToastBottom).toBe(footerTop - 8);
    expect(getDemoDisclosureSlotHeight(34, false)).toBe(0);

    setStateOverrides(false, 0);
    const screen = Screen({ children: 'Screen body', padded: false });
    const screenContent = findElements(screen, 'ScrollView')[0];
    const stickyFooter = StickyFooter({ children: 'Primary action' });
    const header = Header({ title: 'Verify', back: false });

    expect(flattenStyle(screenContent?.props.contentContainerStyle).paddingBottom).toBe(36);
    expect(flattenStyle(stickyFooter.props.style).paddingBottom).toBe(12);
    expect(flattenStyle(findElements(header, 'View')[0]?.props.style).paddingTop).toBe(44);
  });

  it('uses semantic toast text, action and tone-accent roles', () => {
    setStateOverrides(
      [{ id: 1, message: 'Your request was saved', tone: 'success', actionLabel: 'Undo', onAction: jest.fn() }],
      null,
    );
    const tree = ToastProvider({ children: null });
    const textNodes = findElements(tree, 'Text');
    const icon = findElements(tree, 'Ionicons')[0];

    expect(textNodes.find((node) => node.props.children === 'Your request was saved')?.props.color).toBe('onPrimary');
    expect(textNodes.find((node) => node.props.children === 'Undo')?.props.color).toBe('info');
    expect(icon?.props.color).toBe('success-token');
  });

  it('configures keyboard avoidance for modal actions and removes reduced-motion transitions', () => {
    const tree = BottomSheet({
      visible: true,
      onClose: jest.fn(),
      children: 'Form content',
      footer: 'Confirmation actions',
    });
    const keyboardAvoidingView = findElements(tree, 'KeyboardAvoidingView')[0];
    const modalSheet = findElements(tree, 'AnimatedView').find((node) => node.props.accessibilityViewIsModal);
    const scroll = findElements(tree, 'ScrollView')[0];

    expect(keyboardAvoidingView?.props).toMatchObject({ behavior: 'padding', keyboardVerticalOffset: 34 });
    expect(flattenStyle(modalSheet?.props.style).maxHeight).toBe('88%');
    expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
    expect(findElements(modalSheet, 'View').some((node) => node.props.children === 'Confirmation actions')).toBe(true);
    expect(withSpring).not.toHaveBeenCalled();
    expect(withTiming).not.toHaveBeenCalled();
  });

  it('keeps the retryable crash fallback readable without loading theme context or Reanimated', () => {
    const retry = jest.fn();
    let textNodes: TestElement[] = [];
    let buttons: TestElement[] = [];

    try {
      for (const blockedModule of ['../../../theme', 'react-native-reanimated']) {
        jest.isolateModules(() => {
          jest.doMock(blockedModule, () => {
            throw new Error(`The crash fallback must not load ${blockedModule}`);
          });

          const { RouteErrorBoundary } = require('../../RouteErrorBoundary') as typeof import('../../RouteErrorBoundary');
          const tree = RouteErrorBoundary({
            error: { message: 'route failed', stack: 'route stack' },
            retry,
          } as never);

          textNodes = findElements(tree, 'Text');
          buttons = findElements(tree, 'Pressable');
        });
        jest.dontMock(blockedModule);
      }
    } finally {
      jest.dontMock('../../../theme');
      jest.dontMock('react-native-reanimated');
    }

    expect(textNodes.map((node) => node.props.children)).toContain('Something went wrong on this screen');
    expect(textNodes.map((node) => node.props.children)).toContain('route failed');
    expect(buttons[0]?.props.accessibilityLabel).toBe('Try again');
    buttons[0]?.props.onPress?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
