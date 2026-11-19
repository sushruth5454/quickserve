import type { Quote } from '../../lib/types';
import { customerDueNow, formatINR } from '../../lib/money';
import { QuoteView } from '../QuoteView';
import { PriceRow } from '../ui';

jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('../ui', () => ({
  Badge: () => null,
  Card: () => null,
  Divider: () => null,
  InlineAlert: () => null,
  PriceRow: () => null,
  Text: 'Text',
}));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
    colors: { surfaceAlt: '#fff', textSecondary: '#333' },
    radii: { sm: 8 },
  }),
}));

function findPriceRow(node: any, label: string): any {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPriceRow(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  if (node.type === PriceRow && node.props.label === label) return node;
  return findPriceRow(node.props?.children, label);
}

function renderedText(node: any): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(renderedText);
  if (!node || typeof node !== 'object') return [];
  return renderedText(node.props?.children);
}

function expectExact(actual: unknown, expected: unknown) {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

const quote: Quote = {
  id: 'quote-1',
  booking_id: 'booking-1',
  version: 1,
  status: 'sent',
  is_change_order: false,
  subtotal_labour: 150000,
  subtotal_parts: 65000,
  subtotal_other: 0,
  total: 215000,
  note: null,
  created_at: '2026-01-01T00:00:00.000Z',
  quote_items: [],
};

describe('QuoteView coin due', () => {
  it('renders ₹1,930 due after a ₹50 coin payment without subtracting it twice', () => {
    const tree = QuoteView({
      quote,
      visitFee: 19900,
      platformFee: 2900,
      alreadyPaid: 24900,
      coinPaid: 5000,
      coinDiscountPreview: 5000,
    });
    const due = findPriceRow(tree, 'To pay now');
    const actual = {
      label: due?.props.label,
      amount: due?.props.amount,
      formatted: formatINR(due?.props.amount ?? 0),
      emphasis: due?.props.emphasis,
    };
    expectExact(actual, { label: 'To pay now', amount: 193000, formatted: '₹1,930', emphasis: 'total' });
  });

  it('calculates the footer amount from integer-paise totals and deducts a new preview once', () => {
    const actual = {
      newRedemption: customerDueNow(217900, 19900, 5000),
      alreadyRedeemed: customerDueNow(217900, 19900, 5000),
      reducedRedemption: customerDueNow(217900, 19900, 3000),
      fullyRestored: customerDueNow(217900, 19900, 0),
    };
    expectExact(actual, {
      newRedemption: 193000,
      alreadyRedeemed: 193000,
      reducedRedemption: 195000,
      fullyRestored: 198000,
    });
  });

  describe('QuoteView line kinds', () => {
    it('renders package lines and discounts as negative values', () => {
      const tree = QuoteView({
        quote: {
          ...quote,
          total: 97500,
          quote_items: [
            {
              id: 'item-package',
              quote_id: quote.id,
              kind: 'package',
              title: 'Cleaning package',
              qty: 1,
              unit_price: 100000,
              bill_photo_url: null,
            },
            {
              id: 'item-discount',
              quote_id: quote.id,
              kind: 'discount',
              title: 'Promotion',
              qty: 1,
              unit_price: 2500,
              bill_photo_url: null,
            },
          ],
        },
        visitFee: 0,
        platformFee: 0,
        alreadyPaid: 0,
      });
      const text = renderedText(tree);
      expect(text).toEqual(expect.arrayContaining(['Packages', 'Discounts', 'Cleaning package', 'Promotion', '-₹25']));
    });
  });

  it('renders the server settlement preview in exact paise', () => {
    const preview = {
      commissionable: 99900,
      commission_bp: 1500,
      commission: 14985,
      gst_on_commission: 2697,
      payout: 82218,
    };
    const tree = QuoteView({
      quote,
      visitFee: 0,
      platformFee: 2900,
      alreadyPaid: 0,
      settlementPreview: preview,
    });
    const actual = {
      commissionable: findPriceRow(tree, 'Commissionable amount')?.props.amount,
      commission: findPriceRow(tree, 'Commission (15%)')?.props.amount,
      gst: findPriceRow(tree, 'GST on commission')?.props.amount,
      payout: findPriceRow(tree, 'You receive')?.props.amount,
    };
    expectExact(actual, {
      commissionable: 99900,
      commission: -14985,
      gst: -2697,
      payout: 82218,
    });
  });
});
