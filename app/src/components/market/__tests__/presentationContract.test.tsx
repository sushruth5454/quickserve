import React, { type ReactElement, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { ListingCard } from '../ListingCard';
import { PillarCard } from '../PillarCard';
import { PriceFooter } from '../PriceFooter';
import { QuoteCompareTable } from '../QuoteCompareTable';
import { TrustStrip } from '../TrustStrip';
import { pillarCardLayout } from '../pillars';

jest.mock('react-native', () => ({
  View: 'View',
  useWindowDimensions: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'MockIonicons' }));
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
      primaryText: '#000',
    },
    iconSize: { lg: 24, md: 16 },
    radii: { pill: 999 },
    spacing: { lg: 24, md: 16, sm: 8, xs: 4 },
  }),
}));
jest.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));
jest.mock('../../ui', () => ({
  Avatar: 'MockAvatar',
  Badge: 'MockBadge',
  Card: 'MockCard',
  RatingStars: 'MockRatingStars',
  Text: 'MockText',
}));
jest.mock('../../ui/Button', () => ({ Button: 'MockButton' }));
jest.mock('../../ui/Badge', () => ({ Badge: 'MockBadge' }));
jest.mock('../../ui/Card', () => ({ Card: 'MockCard' }));
jest.mock('../../ui/RatingStars', () => ({ RatingStars: 'MockRatingStars' }));
jest.mock('../../ui/Text', () => ({ Text: 'MockText' }));
jest.mock('../MediaImage', () => ({ MediaImage: 'MockMediaImage' }));
jest.mock('../VerifiedBadge', () => ({ VerifiedBadge: 'MockVerifiedBadge' }));

type TestElement = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

function collectElements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!React.isValidElement(node)) return [];

  const element = node as TestElement;
  return [element, ...collectElements(element.props.children)];
}

function findElement(elements: TestElement[], type: string, child?: ReactNode): TestElement {
  const match = elements.find(
    (element) => element.type === type && (child === undefined || element.props.children === child),
  );
  if (!match) throw new Error(`Missing ${type} element with child ${String(child)}`);
  return match;
}

function setWindow(width: number, fontScale: number): void {
  jest.mocked(useWindowDimensions).mockReturnValue({
    width,
    height: 800,
    scale: 1,
    fontScale,
  });
}

describe('shared market presentation contract', () => {
  it('keeps the legacy pillar layout by default and applies Oorva intrinsic-size thresholds only when opted in', () => {
    expect(
      pillarCardLayout({ presentation: 'legacy', viewportWidth: 393, fontScale: 2, fullWidth: false }),
    ).toEqual({ width: '48%', stacked: true });
    expect(
      pillarCardLayout({ presentation: 'oorva', viewportWidth: 320, fontScale: 1.3, fullWidth: true }),
    ).toEqual({ width: '48%', stacked: true });
    expect(
      pillarCardLayout({ presentation: 'oorva', viewportWidth: 319, fontScale: 1.3, fullWidth: false }),
    ).toEqual({ width: '100%', stacked: false });
    expect(
      pillarCardLayout({ presentation: 'oorva', viewportWidth: 320, fontScale: 1.31, fullWidth: false }),
    ).toEqual({ width: '100%', stacked: false });

    setWindow(393, 2);
    const legacy = PillarCard({
      pillar: 'creators',
      title: 'Creators & Artists',
      subtitle: 'Find creative professionals',
      onPress: jest.fn(),
    });
    const legacyCard = collectElements(legacy).find((element) => element.type === 'MockCard');
    expect(legacyCard?.props.style).toMatchObject({ width: '48%', minHeight: 132 });

    setWindow(320, 2);
    const onPress = jest.fn();
    const oorva = PillarCard({
      pillar: 'creators',
      title: 'Creators & Artists',
      subtitle: 'Freelancers and event professionals near you',
      onPress,
      presentation: 'oorva',
    });
    const elements = collectElements(oorva);
    const card = findElement(elements, 'MockCard');
    const stack = elements.find(
      (element) => element.type === 'View' && (element.props.style as { flexDirection?: string })?.flexDirection,
    );
    const title = findElement(elements, 'MockText', 'Creators & Artists');
    const subtitle = findElement(elements, 'MockText', 'Freelancers and event professionals near you');

    expect(card.props.style).toMatchObject({ width: '100%' });
    expect((card.props.style as { minHeight?: number }).minHeight).toBeUndefined();
    expect((stack?.props.style as { flexDirection?: string }).flexDirection).toBe('row');
    expect(title.props.numberOfLines).toBeUndefined();
    expect(subtitle.props.numberOfLines).toBeUndefined();
    card.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps listing defaults compact and makes opted-in titles, metadata, and prices complete', () => {
    const props = {
      variant: 'shop' as const,
      title: 'A full local business name that must remain readable',
      subtitle: 'Neighbourhood and supported fulfilment details',
      rating: 4.8,
      ratingCount: 123,
      verified: true,
      priceLabel: 'From ₹1,250 per item',
      tags: ['Verified locally', 'Bulk quotes', 'Delivery available'],
      onPress: jest.fn(),
    };

    const legacy = collectElements(ListingCard(props));
    const legacyTitle = findElement(
      legacy,
      'MockText',
      'A full local business name that must remain readable',
    );
    const legacyPrice = findElement(legacy, 'MockText', 'From ₹1,250 per item');
    expect(legacyTitle.props.numberOfLines).toBe(1);
    expect(legacyPrice.props.numberOfLines).toBe(1);
    expect(legacy.filter((element) => element.type === 'MockBadge').map((element) => element.props.label)).toEqual([
      'Verified locally',
      'Bulk quotes',
    ]);

    const oorva = collectElements(ListingCard({ ...props, presentation: 'oorva' }));
    const oorvaTitle = findElement(
      oorva,
      'MockText',
      'A full local business name that must remain readable',
    );
    const oorvaSubtitle = findElement(oorva, 'MockText', 'Neighbourhood and supported fulfilment details');
    const oorvaPrice = findElement(oorva, 'MockText', 'From ₹1,250 per item');
    const card = findElement(oorva, 'MockCard');
    expect(oorvaTitle.props.numberOfLines).toBeUndefined();
    expect(oorvaSubtitle.props.numberOfLines).toBeUndefined();
    expect(oorvaPrice.props.numberOfLines).toBeUndefined();
    expect(oorva.filter((element) => element.type === 'MockBadge').map((element) => element.props.label)).toEqual([
      'Verified locally',
      'Bulk quotes',
      'Delivery available',
    ]);
    expect(card.props.accessibilityLabel).toContain('From ₹1,250 per item');
    expect(oorva.some((element) => element.type === 'MockRatingStars')).toBe(true);
    expect(oorva.some((element) => element.type === 'MockVerifiedBadge')).toBe(true);

    const grid = collectElements(ListingCard({ ...props, layout: 'grid', presentation: 'oorva' }));
    expect(findElement(grid, 'MockMediaImage').props.aspectRatio).toBe(1);
    expect(findElement(grid, 'MockText', 'A full local business name that must remain readable').props.numberOfLines)
      .toBeUndefined();
    expect(findElement(grid, 'MockText', 'From ₹1,250 per item').props.numberOfLines).toBeUndefined();
  });

  it('keeps the price footer legacy-default and stacks complete price/action content when opted in', () => {
    const cta = {
      title: 'Continue to booking',
      onPress: jest.fn(),
      disabled: true,
      loading: true,
      accessibilityHint: 'Review the complete amount before continuing',
    };
    const legacy = collectElements(
      PriceFooter({ caption: 'Total including delivery', amountLabel: '₹12,500', cta }),
    );
    const legacyRow = legacy.find(
      (element) => element.type === 'View' && (element.props.style as { flexDirection?: string })?.flexDirection,
    );
    expect((legacyRow?.props.style as { flexDirection?: string }).flexDirection).toBe('row');
    expect(findElement(legacy, 'MockButton').props.style).toEqual({ flex: 1 });

    const oorva = collectElements(
      PriceFooter({
        caption: 'Full total including delivery and service charges',
        amountLabel: '₹12,500 per completed booking',
        cta,
        presentation: 'oorva',
      }),
    );
    const oorvaRow = oorva.find(
      (element) => element.type === 'View' && (element.props.style as { flexDirection?: string })?.flexDirection,
    );
    const caption = findElement(oorva, 'MockText', 'Full total including delivery and service charges');
    const amount = findElement(oorva, 'MockText', '₹12,500 per completed booking');
    const button = findElement(oorva, 'MockButton');
    expect((oorvaRow?.props.style as { flexDirection?: string }).flexDirection).toBe('column');
    expect(caption.props.numberOfLines).toBeUndefined();
    expect(amount.props.numberOfLines).toBeUndefined();
    expect(button.props).toMatchObject({
      title: cta.title,
      onPress: cta.onPress,
      disabled: true,
      loading: true,
      style: { alignSelf: 'stretch' },
    });
  });

  it('keeps comparison cards stacked by default and offers Oorva wide columns without changing eligibility', () => {
    const rows = [
      { id: 'quote-b', who: 'Supplier B with a full name', pricePaise: 250000, detail1: 'Full coverage', detail2: 'Delivery in two weeks', rating: 4.6 },
      { id: 'quote-a', who: 'Supplier A', pricePaise: 150000, detail1: 'Different specification', detail2: 'Validity through next month', rating: 4.9 },
    ];
    const props = {
      rows,
      detailHeaders: ['Coverage', 'Delivery terms'] as [string, string],
      selectLabel: 'Choose quote',
      onSelect: jest.fn(),
      selectable: (id: string) => id === 'quote-a',
      warnings: { 'quote-a': ['Tax differs', 'Requested quantity is rounded'] },
    };

    setWindow(375, 1);
    const legacy = collectElements(QuoteCompareTable(props));
    const legacyRoot = findElement(legacy, 'View');
    expect((legacyRoot.props.style as { flexDirection?: string }).flexDirection).toBeUndefined();
    expect(legacy.filter((element) => element.type === 'MockButton')).toHaveLength(1);

    const mobileOorva = collectElements(QuoteCompareTable({ ...props, presentation: 'oorva' }));
    expect((findElement(mobileOorva, 'View').props.style as { flexDirection?: string }).flexDirection).toBeUndefined();

    setWindow(1200, 1);
    const oorva = collectElements(QuoteCompareTable({ ...props, presentation: 'oorva' }));
    const root = findElement(oorva, 'View');
    const supplier = findElement(oorva, 'MockText', 'Supplier B with a full name');
    const detail = findElement(oorva, 'MockText', 'Delivery in two weeks');
    const buttons = oorva.filter((element) => element.type === 'MockButton');
    expect(root.props.style).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(supplier.props.numberOfLines).toBeUndefined();
    expect(detail.props.numberOfLines).toBeUndefined();
    expect(buttons).toHaveLength(1);
    buttons[0].props.onPress();
    expect(props.onSelect).toHaveBeenCalledWith('quote-a');
    expect(oorva.filter((element) => element.type === 'MockBadge').map((element) => element.props.label)).toContain(
      'Requested quantity is rounded',
    );
  });

  it('wraps Oorva trust items without clamping their labels while preserving the legacy row', () => {
    const items = [
      { icon: 'shield-checkmark' as const, label: 'Identity checked for this specific service category' },
      { icon: 'time-outline' as const, label: 'Current availability confirmed by the provider' },
    ];

    const legacy = collectElements(TrustStrip({ items }));
    expect((findElement(legacy, 'View').props.style as { flexWrap?: string }).flexWrap).toBeUndefined();
    expect(findElement(legacy, 'MockText', items[0].label).props.numberOfLines).toBe(2);

    const oorva = collectElements(TrustStrip({ items, presentation: 'oorva' }));
    expect((findElement(oorva, 'View').props.style as { flexWrap?: string }).flexWrap).toBe('wrap');
    expect(findElement(oorva, 'MockText', items[0].label).props.numberOfLines).toBeUndefined();
  });
});
