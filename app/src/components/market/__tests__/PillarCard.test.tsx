import React, { type ReactElement, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { PillarCard } from '../PillarCard';

jest.mock('react-native', () => ({
  View: 'View',
  useWindowDimensions: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../ui/Card', () => ({ Card: 'Card' }));
jest.mock('../../ui/Text', () => ({ Text: 'Text' }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    colors: {
      catCreators: '#000',
      catCreatorsSoft: '#fff',
      catHome: '#000',
      catHomeSoft: '#fff',
      catShops: '#000',
      catShopsSoft: '#fff',
      catSports: '#000',
      catSportsSoft: '#fff',
    },
    iconSize: { lg: 24 },
    radii: { pill: 999 },
    spacing: { md: 16, xs: 4 },
  }),
}));

type CardElement = ReactElement<{
  accessibilityLabel: string;
  onPress: () => void;
  style: { minHeight: number; width: string };
  children: ReactNode;
}>;

type StackElement = ReactElement<{
  style: { alignItems: string; flexDirection: string; gap: number };
  children: ReactNode;
}>;

type CopyElement = ReactElement<{
  style: { flex: number; gap: number; width?: string };
  children: ReactNode;
}>;

type TextElement = ReactElement<{
  children: string;
  maxFontSizeMultiplier?: number;
  numberOfLines?: number;
}>;

function renderPillar(width: number, fontScale: number, onPress: () => void): {
  card: CardElement;
  stack: StackElement;
  copy: CopyElement;
  title: TextElement;
} {
  jest.mocked(useWindowDimensions).mockReturnValue({
    width,
    height: 800,
    scale: 1,
    fontScale,
  });

  const card = PillarCard({
    pillar: 'creators',
    title: 'Creators & Artists',
    subtitle: 'Find creative professionals',
    onPress,
    fullWidth: width < 360,
  }) as CardElement;
  const stack = React.Children.toArray(card.props.children)[0] as StackElement;
  const copy = React.Children.toArray(stack.props.children)[1] as CopyElement;
  const title = React.Children.toArray(copy.props.children)[0] as TextElement;

  return { card, stack, copy, title };
}

describe('PillarCard', () => {
  it('MK-PILLAR-narrow-readable keeps the full destination readable at 320px and 200% text', () => {
    const onPress = jest.fn();
    const { card, stack, copy, title } = renderPillar(320, 2, onPress);

    expect(card.props.style).toMatchObject({ width: '100%', minHeight: 132 });
    expect(card.props.accessibilityLabel).toBe('Creators & Artists. Find creative professionals');
    expect(stack.props.style).toMatchObject({ flexDirection: 'column', alignItems: 'center' });
    expect(copy.props.style.width).toBe('100%');
    expect(title.props.children).toBe('Creators & Artists');
    expect(title.props.maxFontSizeMultiplier).toBe(2);
    expect(title.props.numberOfLines).toBeUndefined();

    card.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('MK-PILLAR-large-text-route wraps the full destination at 393px and keeps its action', () => {
    const onPress = jest.fn();
    const { card, stack, copy, title } = renderPillar(393, 2, onPress);

    expect(card.props.style).toMatchObject({ width: '48%', minHeight: 132 });
    expect(stack.props.style).toMatchObject({ flexDirection: 'column', alignItems: 'center' });
    expect(copy.props.style.width).toBe('100%');
    expect(title.props.children).toBe('Creators & Artists');
    expect(title.props.maxFontSizeMultiplier).toBe(2);
    expect(title.props.numberOfLines).toBeUndefined();

    card.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
