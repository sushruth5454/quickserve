import { partialRefundLimitPaise, parsePartialRefundRupees } from '../adminMoney';
import type { AdminBookingDetail } from '../adminApi';

describe('parsePartialRefundRupees', () => {
  it('converts whole rupees to exact paise at the paid cap', () => {
    expect(parsePartialRefundRupees('100', 10000)).toBe(10000);
  });

  it('rejects fractional, non-positive, unsafe and over-paid amounts', () => {
    expect(parsePartialRefundRupees('100.50', 20000)).toBeNull();
    expect(parsePartialRefundRupees('0', 20000)).toBeNull();
    expect(parsePartialRefundRupees('9007199254740992', 20000)).toBeNull();
    expect(parsePartialRefundRupees('101', 10000)).toBeNull();
  });
});

function makeDetail(overrides: Partial<AdminBookingDetail> = {}): AdminBookingDetail {
  return {
    booking: { id: 'booking', status: 'disputed', total_amount: 200, visit_fee: 0, refund_amount: 0 },
    category: 'Test',
    customer: { id: 'customer', name: 'Customer', phone: null },
    provider: { id: 'provider', name: 'Provider', phone: null },
    address: null,
    events: [],
    payments: [],
    refunds: [],
    payouts: [],
    transfers: [],
    reversals: [],
    receivables: [],
    ...overrides,
  };
}

describe('partialRefundLimitPaise', () => {
  it('MN-PARTIAL-CAP-PAYOUT: caps partial refunds at the payout and preserves whole-rupee entry', () => {
    const detail = makeDetail({
      payments: [
        { id: 'cash', purpose: 'session', amount: 20000, status: 'paid', paid_at: null, gateway_id: 'gateway-cash', funding_source: null },
        { id: 'coins', purpose: 'session', amount: 5000, status: 'paid', paid_at: null, gateway_id: 'gateway-coins', funding_source: 'coins' },
        { id: 'pending', purpose: 'session', amount: 10000, status: 'pending', paid_at: null, gateway_id: 'gateway-pending', funding_source: null },
      ],
      payouts: [{ id: 'payout', gross: 20000, commission: 2360, amount: 17640, status: 'pending', release_after: '2030-07-10T10:00:00Z', transferred_at: null }],
    });
    const limit = partialRefundLimitPaise(detail);

    expect(limit).toBe(17640);
    expect(parsePartialRefundRupees('180', limit)).toBeNull();
    expect(parsePartialRefundRupees('176', limit)).toBe(17600);
    expect(parsePartialRefundRupees('176.40', limit)).toBeNull();
  });

  it('subtracts non-failed refunds only from eligible cash payments when no payout exists', () => {
    const detail = makeDetail({
      payments: [
        { id: 'cash', purpose: 'session', amount: 20000, status: 'paid', paid_at: null, gateway_id: 'gateway-cash', funding_source: null },
        { id: 'coins', purpose: 'session', amount: 5000, status: 'paid', paid_at: null, gateway_id: 'gateway-coins', funding_source: 'coins' },
        { id: 'no-gateway', purpose: 'session', amount: 9000, status: 'paid', paid_at: null, gateway_id: null, funding_source: null },
      ],
      refunds: [
        { id: 'processing', payment_id: 'cash', amount: 2500, status: 'processing', attempts: 1, last_error: null, created_at: '2030-07-10T10:00:00Z' },
        { id: 'failed', payment_id: 'cash', amount: 8000, status: 'failed', attempts: 5, last_error: 'failed', created_at: '2030-07-10T10:00:00Z' },
        { id: 'coin-refund', payment_id: 'coins', amount: 1000, status: 'pending', attempts: 0, last_error: null, created_at: '2030-07-10T10:00:00Z' },
      ],
    });

    expect(partialRefundLimitPaise(detail)).toBe(17500);
  });
});
