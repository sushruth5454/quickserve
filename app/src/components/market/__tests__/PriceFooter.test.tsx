import type { ReactElement, ReactNode } from 'react';
import { PriceFooter } from '../PriceFooter';

jest.mock('../../ui/Button', () => ({ Button: 'MockButton' }));
jest.mock('../../ui/Text', () => ({ Text: 'MockText' }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({ spacing: { sm: 8, lg: 24 } }),
}));

type TestElement = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

function collectElements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];

  const element = node as TestElement;
  return [element, ...collectElements(element.props.children)];
}

function collectStrings(node: ReactNode): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectStrings);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  return collectStrings((node as TestElement).props.children);
}

describe('PriceFooter', () => {
  it('renders the default amount and a full-flex large CTA', () => {
    const onPress = jest.fn();
    const elements = collectElements(
      PriceFooter({
        caption: 'To pay now',
        amountLabel: '₹500',
        cta: { title: 'Continue', onPress, disabled: true, loading: true, leftIcon: 'lock-closed', accessibilityHint: 'Complete payment' },
      }),
    );
    const caption = elements.find((element) => element.type === 'MockText' && element.props.children === 'To pay now');
    const amount = elements.find((element) => element.type === 'MockText' && element.props.children === '₹500');
    const button = elements.find((element) => element.type === 'MockButton');

    expect(caption?.props).toMatchObject({ variant: 'caption', color: 'muted', numberOfLines: 1 });
    expect(amount?.props).toMatchObject({ variant: 'title2', tabular: true });
    expect(button?.props).toMatchObject({
      title: 'Continue',
      onPress,
      size: 'lg',
      style: { flex: 1 },
      disabled: true,
      loading: true,
      leftIcon: 'lock-closed',
      accessibilityHint: 'Complete payment',
    });
  });

  it('uses calloutStrong for text amounts', () => {
    const elements = collectElements(
      PriceFooter({
        caption: 'Repairs · price',
        amountLabel: 'Fixed quote per brief',
        amountVariant: 'text',
        cta: { title: 'Request proposal', onPress: jest.fn() },
      }),
    );
    const amount = elements.find((element) => element.type === 'MockText' && element.props.children === 'Fixed quote per brief');

    expect(amount?.props).toMatchObject({ variant: 'calloutStrong' });
    expect(amount?.props.tabular).toBeUndefined();
  });

  it('renders optional content above the row and a toned note below it', () => {
    const footer = PriceFooter({
      caption: 'To pay now',
      amountLabel: '₹500',
      cta: { title: 'Pay', onPress: jest.fn() },
      above: 'City mismatch',
      note: { text: 'Select another location', tone: 'warningText' },
    });
    const elements = collectElements(footer);
    const note = elements.find((element) => element.props.children === 'Select another location');
    const strings = collectStrings(footer);

    expect(strings).toContain('City mismatch');
    expect(strings.indexOf('City mismatch')).toBeLessThan(strings.indexOf('Select another location'));
    expect(note?.props).toMatchObject({ variant: 'caption', color: 'warningText', align: 'center' });
  });
});
