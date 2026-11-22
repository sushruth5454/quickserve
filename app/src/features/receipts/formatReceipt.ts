import type { PaymentReceipt } from '../../lib/apiTypes';
import type { Payment } from '../../lib/types';
import { formatINR } from '../../lib/money';

function formatReceiptDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function paymentLabel(purpose?: string | null): string {
  switch (purpose) {
    case 'visit_fee':
      return 'Visit fee';
    case 'platform_fee':
      return 'Platform fee';
    case 'advance':
      return 'Advance';
    case 'milestone':
      return 'Milestone payment';
    case 'final':
      return 'Final payment';
    default:
      return 'Job payment';
  }
}

function currentPaymentStatusLabel(status: Payment['status']): string {
  switch (status) {
    case 'refund_pending':
      return 'Refund pending';
    case 'refund_processing':
      return 'Refund processing';
    default:
      return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}

export function shouldShowPaymentReceipt(
  enabled: boolean,
  payment: Pick<Payment, 'status' | 'funding_source'>,
): boolean {
  return enabled
    && (
      payment.status === 'paid'
      || payment.status === 'refund_pending'
      || payment.status === 'refund_processing'
      || payment.status === 'refunded'
    )
    && payment.funding_source === 'customer';
}

export function activityReceiptLabel(isDone: boolean, receiptsEnabled: boolean): 'Receipt' | 'Details' {
  return isDone && receiptsEnabled ? 'Receipt' : 'Details';
}

export function formatReceipt(receipt: PaymentReceipt) {
  const snapshot = receipt.snapshot;
  return {
    receiptNumber: receipt.receipt_no,
    issuedAt: formatReceiptDate(snapshot.issued_at),
    statusAtIssue: snapshot.status,
    bookingRef: snapshot.booking_ref,
    category: snapshot.category,
    providerDisplayName: snapshot.provider_display_name,
    customerName: snapshot.customer_name,
    customerLocality: snapshot.customer_locality,
    items: snapshot.items.map((item) => ({
      description: item.description,
      kind: item.kind,
      qty: item.qty,
      unitPrice: formatINR(item.unit_price),
      amount: `${item.amount < 0 ? '−' : ''}${formatINR(Math.abs(item.amount))}`,
    })),
    subtotal: formatINR(snapshot.subtotal),
    platformFee: formatINR(snapshot.platform_fee),
    taxLines: snapshot.tax_lines.map((line) => ({
      label: line.label,
      amount: formatINR(line.amount),
    })),
    coinsDiscount: snapshot.coins_discount > 0
      ? `−${formatINR(snapshot.coins_discount)}`
      : formatINR(0),
    total: formatINR(snapshot.total),
    priorPayments: snapshot.prior_payments.map((payment) => ({
      label: paymentLabel(payment.purpose),
      amount: formatINR(payment.amount),
      method: payment.method ?? 'Online payment',
      gatewayRef: payment.gateway_ref,
      paidAt: formatReceiptDate(payment.paid_at),
    })),
    paidNow: formatINR(snapshot.this_payment.amount),
    paidNowMethod: snapshot.this_payment.method ?? 'Online payment',
    paidNowGatewayRef: snapshot.this_payment.gateway_ref,
    paidAt: formatReceiptDate(snapshot.this_payment.paid_at),
    balanceDueAtIssue: formatINR(snapshot.balance_due),
    refundsAtIssue: snapshot.refunds.map((refund) => ({
      amount: formatINR(refund.amount),
      status: refund.status.replace(/_/g, ' '),
      processedAt: formatReceiptDate(refund.processed_at),
    })),
    currentPaymentStatus: currentPaymentStatusLabel(receipt.current_payment_status),
    currentRefunds: receipt.current_refunds.map((refund) => ({
      id: refund.id,
      paymentId: refund.payment_id,
      amount: formatINR(refund.amount),
      status: refund.status.replace(/_/g, ' '),
      createdAt: formatReceiptDate(refund.created_at),
      processedAt: formatReceiptDate(refund.processed_at),
    })),
    isDemoPayment: receipt.current_payment_is_demo,
    readAt: formatReceiptDate(receipt.read_at),
    disputeLink: snapshot.dispute_link,
    taxInvoiceLabel: snapshot.tax_invoice_url ? 'View tax invoice' : 'Not issued',
    taxInvoiceUrl: snapshot.tax_invoice_url,
  };
}
