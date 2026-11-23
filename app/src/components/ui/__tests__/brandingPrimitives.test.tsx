import type { ReactElement } from 'react';
import { OORVA_BRANDING_CANDIDATE } from '../../../branding/defaults';
import { resolveAppearanceConfig } from '../../../branding/AppearanceProvider';
import type { BrandingV1 } from '../../../branding/types';
import { contrastRatio } from '../../../theme/contrast';
import { createThemeSnapshot } from '../../../theme/ThemeProvider';
import { darkPalette, lightPalette, typography, type Palette } from '../../../theme/tokens';
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
let mockColors: Palette = lightPalette;
let mockTypography = typography;
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
  AppState: { addEventListener: jest.fn() },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'NativeText',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: jest.fn(() => 'light'),
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

jest.mock('../../../branding/FeatureFlagsProvider', () => ({
  useFeatureControlState: jest.fn(),
}));

jest.mock('../../../theme', () => ({
  maxFontScale: jest.requireActual('../../../theme/tokens').maxFontScale,
  useTheme: () => ({
    colors: mockColors,
    ['fontFamily']: { semibold: 'semibold' },
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

function findSegmentBadge(tree: unknown, label: string, count: number) {
  const option = findElements(tree, 'Pressable').find((element) => element.props.accessibilityLabel === label)!;
  const container = findElements(option, 'View').find((element) => flattenStyle(element.props.style).minWidth === 18)!;
  const text = findElements(option, Text).find((element) => element.props.children === count)!;
  return { container, text };
}

function pressStyle(element: TestElement, pressed: boolean) {
  const style = element.props.style;
  return flattenStyle(typeof style === 'function' ? style({ pressed }) : style);
}

function nativeText(element: TestElement) {
  return Text(element.props);
}

function expectWithContext(actual: unknown, expected: unknown, context: string, assertion: () => void) {
  try {
    assertion();
  } catch (error) {
    throw new Error(
      `${context}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}\n${String(error)}`,
    );
  }
}

function expectValue(actual: unknown, expected: unknown, context: string) {
  expectWithContext(actual, expected, context, () => expect(actual).toEqual(expected));
}

function expectContains(actual: string, expected: string, context: string) {
  expectWithContext(actual, expected, context, () => expect(actual).toContain(expected));
}

function expectAtLeast(actual: number, threshold: number, context: string) {
  expectWithContext(actual, threshold, context, () => expect(actual).toBeGreaterThanOrEqual(threshold));
}

function expectReadablePair(foreground: string, background: string, context: string) {
  const ratio = contrastRatio(foreground, background);
  expectWithContext(
    { foreground, background, ratio: `${ratio.toFixed(2)}:1` },
    'contrast >=4.5:1',
    context,
    () => expect(ratio).toBeGreaterThanOrEqual(4.5),
  );
}

function appearanceForTest(headingFont: BrandingV1['headingFont'] = 'inter'): BrandingV1 {
  return { ...OORVA_BRANDING_CANDIDATE, headingFont };
}

function themedColors(dark: boolean, appearance: BrandingV1 | null): Palette {
  return createThemeSnapshot(dark, appearance, false).colors;
}

beforeEach(() => {
  mockColors = lightPalette;
  mockTypography = typography;
  mockReducedMotion = false;
  mockStateOverrides.length = 0;
  jest.clearAllMocks();
});

describe('branding-aware primitive styling', () => {
  it('uses the approved onPrimary/primary roles for a selected dark D badge', () => {
    mockColors = {
      ...darkPalette,
      primary: 'D-dark-primary',
      onPrimary: 'D-dark-onPrimary',
      surfaceAlt: 'D-dark-surfaceAlt',
      textSecondary: 'D-dark-textSecondary',
    };
    const tree = SegmentedControl({
      options: [{ value: 'selected', label: 'Selected', badge: 7 }],
      value: 'selected',
      onChange: jest.fn(),
    });
    const badge = findSegmentBadge(tree, 'Selected', 7);

    expectValue(flattenStyle(badge.container.props.style).backgroundColor, mockColors.primary, 'D selected badge background role');
    expectValue(flattenStyle(badge.text.props.style).color, mockColors.onPrimary, 'D selected badge foreground role');
  });

  it('uses the approved textSecondary/surfaceAlt roles for a neutral dark D badge', () => {
    mockColors = {
      ...darkPalette,
      primary: 'D-dark-primary',
      onPrimary: 'D-dark-onPrimary',
      surfaceAlt: 'D-dark-surfaceAlt',
      textSecondary: 'D-dark-textSecondary',
    };
    const tree = SegmentedControl({
      options: [{ value: 'neutral', label: 'Neutral', badge: 3 }],
      value: 'selected',
      onChange: jest.fn(),
    });
    const badge = findSegmentBadge(tree, 'Neutral', 3);

    expectValue(flattenStyle(badge.container.props.style).backgroundColor, mockColors.surfaceAlt, 'D neutral badge background role');
    expectValue(flattenStyle(badge.text.props.style).color, mockColors.textSecondary, 'D neutral badge foreground role');
  });

  it('keeps Oorva OFF on legacy tokens and applies only selected heading identity when enabled', () => {
    const candidate = appearanceForTest('manrope');
    const candidateKey = JSON.stringify(candidate);
    const preloaded = { key: candidateKey, config: candidate };
    const offConfig = resolveAppearanceConfig({
      brandingEnabled: false,
      runtimeFlag: true,
      candidate,
      candidateKey,
      preloaded,
    });
    const onConfig = resolveAppearanceConfig({
      brandingEnabled: true,
      runtimeFlag: true,
      candidate,
      candidateKey,
      preloaded,
    });
    const offTheme = createThemeSnapshot(false, offConfig, false);
    const onTheme = createThemeSnapshot(false, onConfig, true);
    const brandedFontFallback = createThemeSnapshot(false, onConfig, false);

    expectValue(offConfig, null, 'brand-off appearance config');
    expectValue(offTheme.colors.primary, lightPalette.primary, 'brand-off primary');
    expectValue(offTheme.typography.title1.fontFamily, 'Inter_700Bold', 'brand-off title face');
    expectValue(onTheme.colors.primary, candidate.light.primary, 'brand-on primary');
    expectValue(onTheme.typography.display.fontFamily, 'Manrope_700Bold', 'brand-on display face');
    expectValue(onTheme.typography.title1.fontFamily, 'Manrope_700Bold', 'brand-on title face');
    expectValue(onTheme.typography.title2.fontFamily, 'Manrope_600SemiBold', 'brand-on section face');
    expectValue(onTheme.typography.title3.fontFamily, 'Manrope_600SemiBold', 'brand-on compact heading face');
    expectValue(onTheme.typography.body.fontFamily, 'Inter_400Regular', 'brand-on body fallback');
    expectValue(brandedFontFallback.typography.title1.fontFamily, 'Inter_700Bold', 'unavailable branded font fallback');
    expectValue(onTheme.typography.title1.fontSize, typography.title1.fontSize, 'brand-on title size');
    expectValue(onTheme.typography.title1.lineHeight, typography.title1.lineHeight, 'brand-on title line height');

    mockTypography = offTheme.typography;
    const offHeading = Text({ variant: 'title1', children: 'Service details' });
    const offAction = Button({ title: 'Continue', onPress: jest.fn(), haptic: false });
    const offPressable = findElements(offAction, 'Pressable')[0]!;
    const offStyle = pressStyle(offPressable, false);

    mockColors = onTheme.colors;
    mockTypography = onTheme.typography;
    const onHeading = Text({ variant: 'title1', children: 'Service details' });
    const onAction = Button({ title: 'Continue', onPress: jest.fn(), haptic: false });
    const onPressable = findElements(onAction, 'Pressable')[0]!;
    const onStyle = pressStyle(onPressable, false);

    expectValue(flattenStyle(offHeading.props.style).fontFamily, 'Inter_700Bold', 'brand-off Text heading face');
    expectValue(flattenStyle(onHeading.props.style).fontFamily, 'Manrope_700Bold', 'brand-on Text heading face');
    expectValue(offStyle.backgroundColor, lightPalette.primary, 'brand-off action fill');
    expectValue(onStyle.backgroundColor, candidate.light.primary, 'brand-on action fill');
    expectValue(offStyle.minHeight, onStyle.minHeight, 'brand A/B action minimum height');
    expectValue(offStyle.paddingHorizontal, onStyle.paddingHorizontal, 'brand A/B action padding');
  });

  it('uses contrast-safe component pairs for light, dark, and custom Oorva palettes', () => {
    const branded = appearanceForTest();
    const palettes = [
      { name: 'legacy light', colors: lightPalette },
      { name: 'legacy dark', colors: darkPalette },
      { name: 'custom Oorva light', colors: themedColors(false, branded) },
      { name: 'custom Oorva dark', colors: themedColors(true, branded) },
    ];

    for (const { name, colors } of palettes) {
      mockColors = colors;

      const primary = Button({ title: 'Continue', onPress: jest.fn(), haptic: false });
      const primaryPressable = findElements(primary, 'Pressable')[0]!;
      const primaryText = findElements(primary, Text)[0]!;
      const primaryForeground = flattenStyle(primaryText.props.style).color;
      expectReadablePair(primaryForeground, pressStyle(primaryPressable, false).backgroundColor, `${name} primary action`);
      expectReadablePair(primaryForeground, pressStyle(primaryPressable, true).backgroundColor, `${name} pressed primary action`);

      const destructive = Button({ title: 'Delete request', variant: 'destructive', onPress: jest.fn(), haptic: false });
      const destructivePressable = findElements(destructive, 'Pressable')[0]!;
      const destructiveText = findElements(destructive, Text)[0]!;
      const destructiveForeground = flattenStyle(destructiveText.props.style).color;
      expectReadablePair(destructiveForeground, pressStyle(destructivePressable, false).backgroundColor, `${name} destructive action`);
      expectReadablePair(destructiveForeground, pressStyle(destructivePressable, true).backgroundColor, `${name} pressed destructive action`);

      expectValue(CountBadge({ count: 0 }), null, `${name} hidden zero count`);
      const countTree = CountBadge({ count: 125 });
      const countBackground = flattenStyle(findElements(countTree, 'View')[0]!.props.style).backgroundColor;
      const countText = findElements(countTree, Text)[0]!;
      const countForeground = flattenStyle(countText.props.style).color;
      expectValue(countText.props.children, '99+', `${name} capped unread label`);
      expectReadablePair(countForeground, countBackground, `${name} unread count`);

      const iconTree = IconButton({
        icon: 'notifications',
        accessibilityLabel: 'Notifications',
        onPress: jest.fn(),
        badge: 125,
      });
      expectValue(findElements(iconTree, CountBadge).length, 1, `${name} numeric icon overlay uses CountBadge`);

      const chipTree = Chip({ label: 'Selected option', selected: true, count: 9 });
      const chipTexts = findElements(chipTree, Text);
      const chipLabel = chipTexts.find((node) => node.props.children === 'Selected option')!;
      const chipCount = chipTexts.find((node) => node.props.children === 9)!;
      const chipBackground = pressStyle(findElements(chipTree, 'Pressable')[0]!, false).backgroundColor;
      const chipCountBackground = flattenStyle(findElements(chipTree, 'View').find((node) =>
        flattenStyle(node.props.style).backgroundColor === colors.primary,
      )!.props.style).backgroundColor;
      expectReadablePair(flattenStyle(chipLabel.props.style).color, chipBackground, `${name} selected chip label`);
      expectValue(flattenStyle(chipCount.props.style).color, colors.onPrimary, `${name} chip count role`);
      expectReadablePair(flattenStyle(chipCount.props.style).color, chipCountBackground, `${name} chip count`);

      const statusTree = Badge({ label: 'Action required', tone: 'danger' });
      const statusView = findElements(statusTree, 'View')[0]!;
      const statusText = findElements(statusTree, Text)[0]!;
      expectReadablePair(
        flattenStyle(statusText.props.style).color,
        flattenStyle(statusView.props.style).backgroundColor,
        `${name} danger status`,
      );

      mockStateOverrides.push(320);
      const segmentTree = SegmentedControl({
        options: [{ value: 'all', label: 'All', badge: 8 }],
        value: 'all',
        onChange: jest.fn(),
      });
      const segmentTexts = findElements(segmentTree, Text);
      const segmentLabel = segmentTexts.find((node) => node.props.children === 'All')!;
      const segmentCount = segmentTexts.find((node) => node.props.children === 8)!;
      const segmentThumb = findElements(segmentTree, 'AnimatedView')[0]!;
      expectReadablePair(
        flattenStyle(nativeText(segmentLabel).props.style).color,
        flattenStyle(segmentThumb.props.style).backgroundColor,
        `${name} selected segment label`,
      );
      expectValue(flattenStyle(segmentCount.props.style).color, colors.onPrimary, `${name} segment count role`);
      expectReadablePair(flattenStyle(segmentCount.props.style).color, colors.primary, `${name} segment count`);

      mockStateOverrides.push(900);
      const progressTree = StepIndicator({ steps: ['Start', 'Review', 'Finish'], current: 0 });
      const activeLabel = findElements(progressTree, Text).find((node) => node.props.children === 1)!;
      const activeCircle = findElements(progressTree, 'View').find((node) =>
        flattenStyle(node.props.style).backgroundColor === colors.primary,
      )!;
      expectValue(flattenStyle(activeLabel.props.style).color, colors.onPrimary, `${name} step number role`);
      expectReadablePair(
        flattenStyle(activeLabel.props.style).color,
        flattenStyle(activeCircle.props.style).backgroundColor,
        `${name} active step number`,
      );
    }
  });

  it('keeps dark destructive pressed text on the semantic danger pair', () => {
    mockColors = darkPalette;
    const tree = Button({ title: 'Delete request', variant: 'destructive', onPress: jest.fn(), haptic: false });
    const pressable = findElements(tree, 'Pressable')[0]!;
    const title = findElements(tree, Text)[0]!;
    const foreground = flattenStyle(title.props.style).color;
    const background = pressStyle(pressable, true).backgroundColor;

    expectValue(foreground, darkPalette.onDanger, 'dark pressed destructive foreground');
    expectValue(background, darkPalette.dangerPressed, 'dark pressed destructive background');
    expectReadablePair(foreground, background, 'dark pressed destructive action');
  });

  it('allows full action, amount, chip, and status text to reflow at 320px and 200% scaling', () => {
    const action = 'Continue with the complete appointment request details';
    const buttonTree = Button({
      title: action,
      onPress: jest.fn(),
      haptic: false,
      fullWidth: true,
      style: { width: 320 },
    });
    const actionContainer = findElements(buttonTree, 'AnimatedView')[0]!;
    const button = findElements(buttonTree, 'Pressable')[0]!;
    const buttonText = findElements(buttonTree, Text)[0]!;
    const buttonRow = findElements(buttonTree, 'View')[0]!;
    expectValue(flattenStyle(actionContainer.props.style).width, 320, 'action container width');
    expectValue(buttonText.props.children, action, 'full action label');
    expectValue(buttonText.props.numberOfLines, undefined, 'full action is not truncated');
    expectValue(buttonText.props.critical, true, 'full action critical scaling');
    expectValue(nativeText(buttonText).props.maxFontSizeMultiplier, 2, 'full action 200% scale');
    expectValue(pressStyle(button, false).minWidth, 0, 'full action shrinkable button');
    expectValue(flattenStyle(buttonRow.props.style).flexWrap, 'wrap', 'full action row wrapping');
    expectValue(flattenStyle(buttonRow.props.style).minWidth, 0, 'full action shrinkable row');
    expectAtLeast(pressStyle(button, false).minHeight, 48, 'full action minimum height');

    const amount = '$123,456.78 for the complete service';
    const onSubmitEditing = jest.fn();
    const inputTree = (Input as unknown as {
      render: (props: Record<string, unknown>, ref: unknown) => ReactElement;
    }).render({
      label: 'Amount',
      value: amount,
      onSubmitEditing,
      containerStyle: { width: 320 },
    }, null);
    expectValue(flattenStyle(findElements(inputTree, 'View')[0]!.props.style).width, 320, 'amount container width');
    const inputField = findElements(inputTree, 'View').find((node) => flattenStyle(node.props.style).flexWrap === 'wrap')!;
    const nativeInput = findElements(inputTree, 'TextInput')[0]!;
    expectValue(flattenStyle(inputField.props.style).minHeight, 52, 'amount field minimum height');
    expectValue(flattenStyle(nativeInput.props.style).minWidth, 0, 'amount input shrinkability');
    expectValue(nativeInput.props.value, amount, 'full native amount value');
    expectValue(nativeInput.props.onSubmitEditing, onSubmitEditing, 'native amount submit handler');
    expectValue(nativeInput.props.maxFontSizeMultiplier, 2, 'amount 200% scale');

    const label = 'Awaiting provider confirmation for the selected appointment';
    const statusTree = Badge({ label, tone: 'danger', style: { width: 320 } });
    expectValue(flattenStyle(findElements(statusTree, 'View')[0]!.props.style).width, 320, 'status container width');
    const statusText = findElements(statusTree, Text)[0]!;
    expectValue(statusText.props.children, label, 'full status label');
    expectValue(statusText.props.numberOfLines, undefined, 'status is not truncated');
    expectValue(nativeText(statusText).props.maxFontSizeMultiplier, 2, 'status 200% scale');

    const chipTree = Chip({ label, selected: true, count: 99, style: { width: 320 } });
    const chip = findElements(chipTree, 'Pressable')[0]!;
    const chipText = findElements(chipTree, Text).find((node) => node.props.children === label)!;
    expectValue(pressStyle(chip, false).width, 320, 'chip container width');
    expectValue(pressStyle(chip, false).maxWidth, '100%', 'chip maximum width');
    expectValue(pressStyle(chip, false).flexWrap, 'wrap', 'chip wraps at narrow width');
    expectValue(chipText.props.numberOfLines, undefined, 'chip label is not truncated');
    expectValue(nativeText(chipText).props.maxFontSizeMultiplier, 2, 'chip 200% scale');

    mockStateOverrides.push(320);
    const segmentTree = SegmentedControl({
      options: [{ value: 'all', label, badge: 99 }],
      value: 'all',
      onChange: jest.fn(),
      style: { width: 320 },
    });
    const segmentOption = findElements(segmentTree, 'Pressable')[0]!;
    const segmentText = findElements(segmentTree, Text).find((node) => node.props.children === label)!;
    expectValue(flattenStyle(findElements(segmentTree, 'View')[0]!.props.style).width, 320, 'segment container width');
    expectValue(segmentOption.props.style.flexWrap, 'wrap', 'segment option wraps');
    expectValue(segmentOption.props.style.minWidth, 0, 'segment option shrinkability');
    expectValue(segmentText.props.numberOfLines, undefined, 'segment label is not truncated');
    expectValue(nativeText(segmentText).props.maxFontSizeMultiplier, 2, 'segment label 200% scale');
  });

  it('uses compact seven-step progress for long labels and keeps reduced-motion rails static', () => {
    const steps = [
      'Request every appointment detail',
      'Choose a qualified provider',
      'Review the complete service amount',
      'Confirm the proposed schedule',
      'Add any special instructions',
      'Select a payment method',
      'Finish and review your request',
    ];
    mockStateOverrides.push(320);
    const compact = StepIndicator({ steps, current: 2 });
    const root = findElements(compact, 'View')[0]!;
    const activeLabel = findElements(compact, Text).find((node) => node.props.children === steps[2])!;

    expectValue(root.props.accessibilityRole, 'progressbar', 'step progress accessibility role');
    expectContains(root.props.accessibilityLabel, 'Step 3 of 7', 'seven-step progress current position');
    for (const step of steps) {
      expectContains(root.props.accessibilityLabel, step, 'seven-step progress includes every label');
    }
    expectValue(flattenStyle(root.props.style).alignSelf, 'stretch', 'compact progress available width');
    expectValue(flattenStyle(root.props.style).flexDirection, 'column', 'compact progress auto-height layout');
    expectValue(activeLabel.props.numberOfLines, undefined, 'long active step is not truncated');
    expectValue(flattenStyle(activeLabel.props.style).minWidth, 0, 'long active step may shrink and wrap');
    expectValue(nativeText(activeLabel).props.maxFontSizeMultiplier, 2, 'active step 200% scale');

    mockReducedMotion = true;
    mockStateOverrides.push(900);
    const railTree = StepIndicator({ steps: ['Start', 'Review', 'Finish'], current: 1 });
    const rail = findComponents(railTree, 'Rail')[0]!;
    const { withTiming } = jest.requireMock('react-native-reanimated');
    withTiming.mockClear();
    (rail.type as (props: Record<string, unknown>) => ReactElement)(rail.props);
    expectValue(withTiming.mock.calls.length, 0, 'reduced-motion rail animation calls');
  });

  it('preserves button, segment, OTP, submit, and quantity interactions across brand palettes', () => {
    for (const colors of [lightPalette, themedColors(false, appearanceForTest('manrope'))]) {
      mockColors = colors;
      const onPress = jest.fn();
      const button = findElements(Button({ title: 'Continue', onPress, haptic: false }), 'Pressable')[0]!;
      button.props.onPress();
      expectValue(onPress.mock.calls.length, 1, 'button press count');

      const onSegmentChange = jest.fn();
      const segments = SegmentedControl({
        options: [{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }],
        value: 'all',
        onChange: onSegmentChange,
      });
      const unreadOption = findElements(segments, 'Pressable').find((node) => node.props.accessibilityLabel === 'Unread')!;
      unreadOption.props.onPress();
      expectValue(onSegmentChange.mock.calls[0]?.[0], 'unread', 'segment selected value');

      const onSubmitEditing = jest.fn();
      const amountInput = (Input as unknown as {
        render: (props: Record<string, unknown>, ref: unknown) => ReactElement;
      }).render({ value: '456.78', onSubmitEditing }, null);
      const nativeInput = findElements(amountInput, 'TextInput')[0]!;
      expectValue(nativeInput.props.value, '456.78', 'native input value');
      nativeInput.props.onSubmitEditing({ nativeEvent: { text: '456.78' } });
      expectValue(onSubmitEditing.mock.calls.length, 1, 'native submit call count');

      const onOtpChange = jest.fn();
      const onOtpComplete = jest.fn();
      const otp = OTPInput({ value: '123', onChange: onOtpChange, onComplete: onOtpComplete });
      const nativeOtp = findElements(otp, 'TextInput')[0]!;
      expectValue(nativeOtp.props.value, '123', 'OTP native value');
      nativeOtp.props.onChangeText('123456');
      expectValue(onOtpChange.mock.calls[0]?.[0], '123456', 'OTP change value');
      expectValue(onOtpComplete.mock.calls[0]?.[0], '123456', 'OTP completion value');

      const onQuantityChange = jest.fn();
      const quantityTree = Stepper({ value: 3, onChange: onQuantityChange, min: 1, max: 8 });
      const quantity = findElements(quantityTree, 'View').find((node) => node.props.accessibilityRole === 'adjustable')!;
      const increase = findElements(quantityTree, 'Pressable').find((node) => node.props.accessibilityLabel === 'Increase quantity')!;
      expectValue(quantity.props.accessibilityLabel, 'Quantity 3', 'quantity accessibility value');
      increase.props.onPress();
      expectValue(onQuantityChange.mock.calls[0]?.[0], 4, 'quantity increment');
    }
  });
});
