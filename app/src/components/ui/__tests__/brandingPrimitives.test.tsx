import type { ReactElement } from 'react';
import { SegmentedControl } from '../SegmentedControl';
import { Text } from '../Text';

type TestElement = ReactElement<Record<string, any>>;

const mockColors = {
  primary: 'D-dark-primary',
  onPrimary: 'D-dark-onPrimary',
  surfaceAlt: 'D-dark-surfaceAlt',
  borderStrong: 'D-dark-borderStrong',
  textSecondary: 'D-dark-textSecondary',
  segmentThumb: 'D-dark-segmentThumb',
};

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
    useState: (initial: unknown) => [initial, jest.fn()],
  };
});

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useSharedValue: (value: unknown) => ({ value }),
  withSpring: jest.fn((value: unknown) => value),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    colors: mockColors,
    motion: { spring: {} },
    radii: { md: 12, sm: 8 },
    shadows: { sm: {} },
    spacing: { sm: 8 },
  }),
}));
jest.mock('../../../lib/haptics', () => ({ haptics: { select: jest.fn() } }));
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

function flattenStyle(style: unknown): Record<string, any> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? style as Record<string, any> : {};
}

function expectToken(actual: unknown, expected: unknown, context: string) {
  try {
    expect(actual).toEqual(expected);
  } catch (error) {
    throw new Error(
      `${context}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}\n${String(error)}`,
    );
  }
}

function findBadge(tree: ReactElement, label: string, count: number) {
  const option = findElements(tree, 'Pressable').find((element) => element.props.accessibilityLabel === label)!;
  const container = findElements(option, 'View').find((element) => flattenStyle(element.props.style).minWidth === 18)!;
  const text = findElements(option, Text).find((element) => element.props.children === count)!;
  return { container, text };
}

function createControl() {
  return SegmentedControl({
    options: [
      { value: 'selected', label: 'Selected', badge: 7 },
      { value: 'neutral', label: 'Neutral', badge: 3 },
    ],
    value: 'selected',
    onChange: jest.fn(),
  });
}

describe('segmented-control badge color roles', () => {
  it('uses onPrimary text on the selected primary badge', () => {
    const tree = createControl();
    const { container, text } = findBadge(tree, 'Selected', 7);

    expectToken(flattenStyle(container.props.style).backgroundColor, mockColors.primary, 'selected badge background');
    expectToken(flattenStyle(text.props.style).color, mockColors.onPrimary, 'selected badge foreground');
  });

  it('uses textSecondary on surfaceAlt for the neutral badge', () => {
    const tree = createControl();
    const { container, text } = findBadge(tree, 'Neutral', 3);

    expectToken(flattenStyle(container.props.style).backgroundColor, mockColors.surfaceAlt, 'neutral badge background');
    expectToken(flattenStyle(text.props.style).color, mockColors.textSecondary, 'neutral badge foreground');
  });
});
