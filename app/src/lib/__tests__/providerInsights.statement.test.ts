import { payoutStatusCopy, summarizeProviderStatement } from '../providerInsights';
import type { ProviderStatementRow } from '../types';

const row = (overrides: Partial<ProviderStatementRow>): ProviderStatementRow => ({
  payout_id: 'payout-1',
  booking_id: 'booking-1',
  sports_booking_id: null,
  booking_ref: 'QS-BOOKING1',
  date: '2030-11-05',
  gross: 215000,
  commission: 18000,
  gst_on_commission: 3240,
  reversed_amount: 0,
  net: 193760,
  status: 'pending',
  release_after: '2030-11-06T12:00:00Z',
  transferred_at: null,
  razorpay_transfer_id: null,
  utr: null,
  ...overrides,
});

describe('provider statement summaries', () => {
  it('totals the returned payout rows in integer paise without recomputing payout amounts', () => {
    const rows = [
      row({ status: 'pending' }),
      row({ payout_id: 'payout-2', gross: 20000, commission: 2000, gst_on_commission: 360, reversed_amount: 1000, net: 17640, status: 'partially_reversed' }),
      row({ payout_id: 'payout-3', gross: 10000, commission: 0, gst_on_commission: 0, net: 10000, status: 'failed' }),
      row({ payout_id: 'payout-4', gross: 5000, commission: 0, gst_on_commission: 0, net: 5000, status: 'frozen' }),
      row({ payout_id: 'payout-5', gross: 8000, commission: 0, gst_on_commission: 0, net: 8000, status: 'transferred' }),
      row({ payout_id: 'payout-6', gross: 1000, commission: 0, gst_on_commission: 0, net: 1000, status: 'demo' }),
    ];

    expect(summarizeProviderStatement(rows)).toEqual({
      gross: 258000,
      commission: 20000,
      gstOnCommission: 3600,
      reversedAmount: 1000,
      net: 234400,
      pending: 193760,
      frozen: 5000,
      failed: 10000,
      transferred: 8000,
      reversed: 0,
      partiallyReversed: 17640,
      demo: 1000,
    });
  });

  it('uses honest copy for pending, frozen, and failed payouts', () => {
    expect(payoutStatusCopy('pending')).toMatchObject({
      label: 'Pending',
      detail: 'This payout is not marked as transferred yet; its transfer may still be processing.',
    });
    expect(payoutStatusCopy('frozen')).toMatchObject({
      label: 'On hold · dispute',
      detail: 'This payout is on hold while the dispute is reviewed.',
    });
    expect(payoutStatusCopy('failed')).toMatchObject({
      label: 'Payment problem',
      detail: 'A payout transfer failed; the full payout is not confirmed as paid.',
    });
    expect(payoutStatusCopy('demo')).toMatchObject({
      label: 'Demo only',
      detail: 'This simulated payout will not be transferred to a bank.',
    });
  });
});
