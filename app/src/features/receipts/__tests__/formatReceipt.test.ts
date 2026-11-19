import { activityReceiptLabel, formatReceipt, shouldShowPaymentReceipt } from '../formatReceipt';
import type { PaymentReceipt } from '../../../lib/apiTypes';

const receipt: PaymentReceipt = {
  id: 'receipt-id',
  receipt_no: 'NR-2026-000456',
  payment_id: 'payment-id',
  booking_id: 'booking-id',
  issued_at: '2026-11-19T15:00:00.000Z',
  snapshot: {
    receipt_no: 'NR-2026-000456',
    issued_at: '2026-11-19T15:00:00.000Z',
    status: 'Paid',
    booking_ref: 'QS-1A2B3C4D',
    category: 'AC repair',
    provider_display_name: 'Ravi K.',
    customer_name: 'Customer',
    customer_locality: 'Pune',
    items: [
      { description: 'AC repair', kind: 'other', qty: 1, unit_price: 215000, amount: 215000 },
    ],
    subtotal: 215000,
    platform_fee: 2900,
    tax_lines: [],
    coins_discount: 5000,
    total: 212900,
    prior_payments: [
      { amount: 19900, purpose: 'visit_fee', method: 'Online payment', gateway_ref: 'pay_prior', paid_at: '2026-11-19T14:00:00.000Z' },
    ],
    this_payment: { amount: 193000, method: 'Online payment', gateway_ref: 'pay_current', paid_at: '2026-11-19T15:00:00.000Z' },
    balance_due: 0,
    refunds: [],
    dispute_link: '/booking/booking-id',
    tax_invoice_url: null,
  },
};

describe('customer non-tax payment receipt formatting', () => {
  it('formats the receipt and exact integer-paise amounts without presenting it as a tax invoice', () => {
    const formatted = formatReceipt(receipt);

    expect(formatted).toMatchObject({
      receiptNumber: 'NR-2026-000456',
      total: '₹2,129',
      paidNow: '₹1,930',
      balanceDue: '₹0',
      taxInvoiceLabel: 'Not issued',
      items: [{ description: 'AC repair', amount: '₹2,150' }],
      priorPayments: [{ amount: '₹199' }],
    });
  });

  it('shows receipt entry points only for enabled customer-funded paid payments', () => {
    const paidCustomerPayment = { status: 'paid' as const, funding_source: 'customer' as const };

    expect(shouldShowPaymentReceipt(true, paidCustomerPayment)).toBe(true);
    expect(shouldShowPaymentReceipt(false, paidCustomerPayment)).toBe(false);
    expect(shouldShowPaymentReceipt(true, { status: 'failed', funding_source: 'customer' })).toBe(false);
    expect(shouldShowPaymentReceipt(true, { status: 'paid', funding_source: 'coins' })).toBe(false);
    expect(activityReceiptLabel(true, false)).toBe('Details');
    expect(activityReceiptLabel(true, true)).toBe('Receipt');
  });
});
