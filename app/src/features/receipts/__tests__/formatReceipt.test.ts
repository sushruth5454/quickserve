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
  current_payment_status: 'paid',
  current_refunds: [],
  current_payment_is_demo: false,
  read_at: '2026-11-20T10:00:00.000Z',
};

function check(condition: boolean, label: string, actual: unknown) {
  if (!condition) throw new Error(`${label}; actual=${JSON.stringify(actual)}`);
}

describe('customer non-tax payment receipt formatting', () => {
  it('formats the receipt and exact integer-paise amounts without presenting it as a tax invoice', () => {
    const formatted = formatReceipt(receipt);

    check(
      formatted.receiptNumber === 'NR-2026-000456'
        && formatted.total === '₹2,129'
        && formatted.paidNow === '₹1,930'
        && formatted.statusAtIssue === 'Paid'
        && formatted.balanceDueAtIssue === '₹0'
        && formatted.taxInvoiceLabel === 'Not issued'
        && formatted.items[0]?.description === 'AC repair'
        && formatted.items[0]?.amount === '₹2,150'
        && formatted.priorPayments[0]?.amount === '₹199',
      'formats the original receipt amounts and non-tax disclaimer',
      formatted,
    );
  });

  it('MN-RECEIPT-REFUNDED-LINK keeps captured refund states but hides non-captured, coin and OFF links', () => {
    const capturedStates = ['paid', 'refund_pending', 'refund_processing', 'refunded'] as const;
    const capturedResults = capturedStates.map((status) =>
      shouldShowPaymentReceipt(true, { status, funding_source: 'customer' }));
    const unavailableResults = [
      shouldShowPaymentReceipt(false, { status: 'paid', funding_source: 'customer' }),
      shouldShowPaymentReceipt(true, { status: 'created', funding_source: 'customer' }),
      shouldShowPaymentReceipt(true, { status: 'failed', funding_source: 'customer' }),
      shouldShowPaymentReceipt(true, { status: 'refunded', funding_source: 'coins' }),
    ];
    const activityLabels = [activityReceiptLabel(true, false), activityReceiptLabel(true, true)];

    check(capturedResults.every(Boolean), 'retains receipt links for captured payment and refund states', {
      capturedStates,
      capturedResults,
    });
    check(unavailableResults.every((visible) => !visible), 'hides receipt links when OFF or not customer-captured', {
      unavailableResults,
    });
    check(
      JSON.stringify(activityLabels) === JSON.stringify(['Details', 'Receipt']),
      'preserves existing activity receipt labels',
      activityLabels,
    );
  });

  it('MN-RECEIPT-POST-ISSUE-REFUND keeps the immutable issue snapshot separate from the current refund overlay', () => {
    const originalSnapshot = JSON.stringify(receipt.snapshot);
    const refundedReceipt: PaymentReceipt = {
      ...receipt,
      current_payment_status: 'refund_pending',
      current_refunds: [{
        id: 'refund-current',
        payment_id: receipt.payment_id,
        amount: 2500,
        status: 'pending',
        created_at: '2026-11-20T11:00:00.000Z',
        processed_at: null,
      }],
      current_payment_is_demo: true,
      read_at: '2026-11-20T11:05:00.000Z',
    };
    const formatted = formatReceipt(refundedReceipt);

    check(
      JSON.stringify(refundedReceipt.snapshot) === originalSnapshot
        && formatted.receiptNumber === 'NR-2026-000456'
        && formatted.balanceDueAtIssue === '₹0',
      'keeps receipt identity and balance explicitly historical after a later refund',
      { originalSnapshot, receipt: refundedReceipt, formatted },
    );
    check(
      formatted.currentPaymentStatus === 'Refund pending'
        && formatted.currentRefunds.length === 1
        && formatted.currentRefunds[0]?.amount === '₹25'
        && formatted.currentRefunds[0]?.status === 'pending'
        && formatted.isDemoPayment
        && formatted.readAt !== null,
      'formats the current refund overlay and actual demo provenance separately',
      { formatted },
    );
  });
});
