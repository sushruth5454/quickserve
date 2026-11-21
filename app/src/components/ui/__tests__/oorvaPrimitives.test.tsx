import type { ReactElement } from 'react';
import { darkPalette, lightPalette, typography } from '../../../theme/tokens';
import { Badge, Chip } from '../Badge';
import { Button } from '../Button';
import { CountBadge } from '../CountBadge';
import { IconButton } from '../IconButton';
import { Input } from '../Input';
import { OTPInput } from '../OTPInput';
import { SegmentedControl } from '../SegmentedControl';
import { StepIndicator, Stepper } from '../Stepper';
import { Text } from '../Text';

type TestElement = ReactElement<Record<string, any>>;

const mockStateOverrides: unknown[] = [];
let mockColors: typeof lightPalette = lightPalette;
const mockTypography = typography;
let mockReducedMotion = false;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [
      mockStateOverrides.length ? mockStateOverrides.shift() : initial,
      jest.fn(),
    ],
  };
});

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'NativeText',
  TextInput: 'TextInput',
  View: 'View',
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  Easing: { bezier: jest.fn(() => ({})) },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
  useReducedMotion: () => mockReducedMotion,
  useSharedValue: (value: unknown) => ({ value }),
  withRepeat: jest.fn((value: unknown) => value),
  withSequence: jest.fn((...values: unknown[]) => values[values.length - 1]),
  withSpring: jest.fn((value: unknown) => value),
  withTiming: jest.fn((value: unknown) => value),
}));

jest.mock('../../../theme', () => ({
  useTheme: () => ({
    colors: mockColors,
    fontFamily: { semibold: 'semibold' },
    minTouch: 48,
    motion: { spring: {} },
    radii: { md: 12, pill: 999, sm: 8, xs: 6 },
    shadows: { sm: {} },
    spacing: { md: 12, sm: 8 },
    typography: mockTypography,
  }),
}));

jest.mock('../../../lib/haptics', () => ({
  haptics: { select: jest.fn(), tap: jest.fn() },
}));

function findElements(node: unknown, type: unknown): TestElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!node || typeof node !== 'object') return [];
  const element = node as TestElement;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props?.children, type),
  ];
}

function findComponents(node: unknown, name: string): TestElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findComponents(child, name));
  if (!node || typeof node !== 'object') return [];
  const element = node as TestElement;
  return [
    ...(typeof element.type === 'function' && element.type.name === name ? [element] : []),
    ...findComponents(element.props?.children, name),
  ];
}

function flattenStyle(style: unknown): Record<string, any> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? style as Record<string, any> : {};
}

function pressStyle(element: TestElement, pressed: boolean) {
  const style = element.props.style;
  return flattenStyle(typeof style === 'function' ? style({ pressed }) : style);
}

function renderedText(element: TestElement) {
  return Text(element.props);
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[0-9a-f]{2}/gi)!.map((channel) => parseInt(channel, 16) / 255);
    const linear = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

beforeEach(() => {
  mockColors = lightPalette;
  mockReducedMotion = false;
  mockStateOverrides.length = 0;
  jest.clearAllMocks();
});

describe('always-on primitive accessibility', () => {
  it('hides zero unread counts and renders 99+ with the semantic danger pair in both themes', () => {
    for (const palette of [lightPalette, darkPalette]) {
      mockColors = palette;
      expect(CountBadge({ count: 0 })).toBeNull();

      const badge = CountBadge({ count: 125 });
      const pill = findElements(badge, 'View')[0];
      const label = findElements(badge, Text)[0];
      const usedBackground = flattenStyle(pill?.props.style).backgroundColor;
      const usedForeground = flattenStyle(label?.props.style).color;

      expect(label?.props.children).toBe('99+');
      expect(usedBackground).toBe(palette.dangerStrong);
      expect(usedForeground).toBe(palette.onDanger);
      expect(label?.props.critical).toBe(true);
      expect(renderedText(label!).props.maxFontSizeMultiplier).toBe(2);
      expect(contrastRatio(usedForeground, usedBackground)).toBeGreaterThanOrEqual(4.5);

      const icon = IconButton({
        icon: 'notifications',
        accessibilityLabel: 'Notifications',
        onPress: jest.fn(),
        badge: 125,
      });
      expect(findElements(icon, CountBadge)).toHaveLength(1);
    }
  });

  it('uses a readable dark destructive fill while pressed and idle', () => {
    mockColors = darkPalette;
    const tree = Button({ title: 'Delete request', variant: 'destructive', onPress: jest.fn(), haptic: false });
    const button = findElements(tree, 'Pressable')[0];
    const title = findElements(tree, Text)[0];

    for (const pressed of [false, true]) {
      const background = pressStyle(button!, pressed).backgroundColor;
      const foreground = flattenStyle(title?.props.style).color;
      expect(background).toBe(pressed ? darkPalette.dangerPressed : darkPalette.dangerStrong);
      expect(foreground).toBe(darkPalette.onDanger);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps long actions and full native amount values available at 200% text size', () => {
    const action = 'Continue with the complete appointment request details';
    const buttonTree = Button({ title: action, onPress: jest.fn(), haptic: false });
    const actionText = findElements(buttonTree, Text)[0];
    const button = findElements(buttonTree, 'Pressable')[0];

    expect(actionText?.props.children).toBe(action);
    expect(actionText?.props.numberOfLines).toBeUndefined();
    expect(actionText?.props.critical).toBe(true);
    expect(renderedText(actionText!).props.maxFontSizeMultiplier).toBe(2);
    expect(pressStyle(button!, false).minHeight).toBeGreaterThanOrEqual(48);

    const amount = '$123,456.78 for the complete service';
    const onSubmitEditing = jest.fn();
    const inputTree = (Input as unknown as {
      render: (props: Record<string, unknown>, ref: unknown) => ReactElement;
    }).render({ label: 'Amount', value: amount, onSubmitEditing }, null);
    const nativeInput = findElements(inputTree, 'TextInput')[0];

    expect(nativeInput?.props.value).toBe(amount);
    expect(nativeInput?.props.onSubmitEditing).toBe(onSubmitEditing);
    expect(nativeInput?.props.maxFontSizeMultiplier).toBe(2);
  });

  it('lets long status and chip text wrap and uses onPrimary for chip counts', () => {
    const status = 'Awaiting provider confirmation for the selected appointment';
    for (const palette of [lightPalette, darkPalette]) {
      mockColors = palette;
      const badgeTree = Badge({ label: status, tone: 'danger' });
      const statusText = findElements(badgeTree, Text)[0];
      const statusBackground = flattenStyle(findElements(badgeTree, 'View')[0]?.props.style).backgroundColor;
      const statusForeground = flattenStyle(statusText?.props.style).color;

      expect(statusText?.props.children).toBe(status);
      expect(statusText?.props.numberOfLines).toBeUndefined();
      expect(statusText?.props.critical).toBe(true);
      expect(renderedText(statusText!).props.maxFontSizeMultiplier).toBe(2);
      expect(contrastRatio(statusForeground, statusBackground)).toBeGreaterThanOrEqual(4.5);

      const chipTree = Chip({ label: status, selected: true, count: 125 });
      const chip = findElements(chipTree, 'Pressable')[0];
      const chipText = findElements(chipTree, Text);
      const countText = chipText.find((node) => node.props.children === 125);
      const countContainer = findElements(chipTree, 'View').find((node) =>
        flattenStyle(node.props.style).backgroundColor === palette.primary,
      );

      expect(pressStyle(chip!, false).flexWrap).toBe('wrap');
      expect(chipText[0]?.props.numberOfLines).toBeUndefined();
      expect(chipText[0]?.props.critical).toBe(true);
      expect(flattenStyle(countText?.props.style).color).toBe(palette.onPrimary);
      expect(flattenStyle(countContainer?.props.style).minHeight).toBeGreaterThanOrEqual(18);
      expect(contrastRatio(flattenStyle(countText?.props.style).color, palette.primary)).toBeGreaterThanOrEqual(4.5);

      mockStateOverrides.push(300);
      const segmentTree = SegmentedControl({
        options: [{ value: 'all', label: status, badge: 8 }],
        value: 'all',
        onChange: jest.fn(),
      });
      const segmentCount = findElements(segmentTree, Text).find((node) => node.props.children === 8);
      const segmentThumb = findElements(segmentTree, 'AnimatedView')[0];
      expect(flattenStyle(segmentCount?.props.style).color).toBe(palette.onPrimary);
      expect(contrastRatio(flattenStyle(segmentCount?.props.style).color, palette.primary)).toBeGreaterThanOrEqual(4.5);
      expect(flattenStyle(segmentThumb?.props.style).backgroundColor).toBe(palette.segmentThumb);

      mockStateOverrides.push(900);
      const progressTree = StepIndicator({ steps: ['Start', status], current: 0 });
      const activeLabel = findElements(progressTree, Text).find((node) => node.props.children === 1);
      const activeCircle = findElements(progressTree, 'View').find((node) =>
        flattenStyle(node.props.style).backgroundColor === palette.primary,
      );
      expect(flattenStyle(activeLabel?.props.style).color).toBe(palette.onPrimary);
      expect(contrastRatio(flattenStyle(activeLabel?.props.style).color, flattenStyle(activeCircle?.props.style).backgroundColor))
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('switches seven-step progress to a compact 320px layout and keeps reduced-motion rails static', () => {
    const steps = ['Request details', 'Choose a provider', 'Review the complete amount', 'Confirm', 'Schedule', 'Pay', 'Done'];
    mockStateOverrides.push(320);
    const compact = StepIndicator({ steps, current: 2 });
    const compactRoot = findElements(compact, 'View')[0];

    expect(compactRoot?.props.accessibilityRole).toBe('progressbar');
    expect(compactRoot?.props.accessibilityLabel).toContain('Step 3 of 7');
    for (const step of steps) expect(compactRoot?.props.accessibilityLabel).toContain(step);
    expect(flattenStyle(compactRoot?.props.style).flexDirection).toBe('column');
    expect(findElements(compact, Text).some((node) => node.props.children === 'Review the complete amount')).toBe(true);

    mockReducedMotion = true;
    mockStateOverrides.push(900);
    const railTree = StepIndicator({ steps: ['Start', 'Review', 'Finish'], current: 1 });
    const rail = findComponents(railTree, 'Rail')[0];
    expect(rail).toBeDefined();
    (rail?.type as (props: Record<string, unknown>) => ReactElement)(rail?.props ?? {});

    const { withTiming } = jest.requireMock('react-native-reanimated');
    expect(withTiming).not.toHaveBeenCalled();
  });

  it('preserves OTP input and quantity semantics while allowing large values', () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    const otp = OTPInput({ value: '123', onChange, onComplete });
    const nativeOtp = findElements(otp, 'TextInput')[0];

    expect(nativeOtp?.props.value).toBe('123');
    expect(nativeOtp?.props.maxLength).toBe(6);
    nativeOtp?.props.onChangeText('123456');
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(findElements(otp, Text).some((node) => node.props.critical === true)).toBe(true);

    const onQuantityChange = jest.fn();
    const stepper = Stepper({ value: 3, onChange: onQuantityChange, min: 1, max: 8 });
    const quantity = findElements(stepper, 'View').find((node) => node.props.accessibilityRole === 'adjustable');
    const increase = findElements(stepper, 'Pressable').find((node) => node.props.accessibilityLabel === 'Increase quantity');

    expect(quantity?.props.accessibilityLabel).toBe('Quantity 3');
    increase?.props.onPress?.();
    expect(onQuantityChange).toHaveBeenCalledWith(4);
  });
});
