import type { Quote } from '../../lib/types';
import { customerDueNow, formatINR } from '../../lib/money';
import { QuoteView } from '../QuoteView';
import { PriceRow } from '../ui';

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
});
