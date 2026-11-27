import { canReportProposalPaymentDefault, fmt, heroCopy, paymentRefundPresentation, paymentRowLabel, shouldShowPaymentRow } from '../model';
import type { Payment, PaymentSchedule } from '../../../lib/types';
import { canManageServiceQuotes, canPayPendingQuoteWithoutSchedule, getQuoteApprovalMode, getQuoteEditorMode } from '../../../lib/fixedBooking';

jest.mock('../../../lib/supabase', () => ({ supabase: {} }));

describe('payment row presentation', () => {
  const payment = (overrides: Partial<Payment> = {}): Payment => ({
    id: 'payment-1',
    booking_id: 'booking-1',
    quote_id: null,
    purpose: 'milestone',
    amount: 12500,
    status: 'paid',
    funding_source: 'customer',
    cancel_link_pending: false,
    schedule_id: 'schedule-1',
    created_at: '2026-11-18T10:00:00.000Z',
    paid_at: '2026-11-18T10:01:00.000Z',
    ...overrides,
  });

  it('labels payment purposes and uses the matching schedule label for milestones', () => {
    const schedules = [{
      id: 'schedule-1',
      payment_id: 'payment-1',
      label: 'Final milestone',
    }] as PaymentSchedule[];

    expect(paymentRowLabel(payment({ purpose: 'platform_fee' }), [])).toBe('Platform fee');
    expect(paymentRowLabel(payment({ purpose: 'advance' }), [])).toBe('Advance');
    expect(paymentRowLabel(payment(), schedules)).toBe('Final milestone');
  });

  it('hides only abandoned-link and coins-funded failed payments', () => {
    expect(shouldShowPaymentRow(payment({ status: 'failed', cancel_link_pending: true }))).toBe(false);
    expect(shouldShowPaymentRow(payment({ status: 'failed', funding_source: 'coins' }))).toBe(false);
    expect(shouldShowPaymentRow(payment({ status: 'failed', cancel_link_pending: false }))).toBe(true);
    expect(shouldShowPaymentRow(payment({ status: 'paid', funding_source: 'coins' }))).toBe(true);
  });

  it('presents each refund amount in exact paise with its status and effective date', () => {
    expect(paymentRefundPresentation(payment({
      refunds: [
        { amount: 12345, status: 'processing', created_at: '2026-11-18T12:00:00.000Z', processed_at: null },
        { amount: 6700, status: 'refunded', created_at: '2026-11-18T12:01:00.000Z', processed_at: '2026-11-19T13:14:00.000Z' },
      ],
    }))).toEqual([
      { amountPaise: 12345, status: 'processing', at: '2026-11-18T12:00:00.000Z' },
      { amountPaise: 6700, status: 'refunded', at: '2026-11-19T13:14:00.000Z' },
    ]);
  });
});

const baseInput = {
  archetype: 'inspect_quote' as const,
  isCustomer: true,
  first: 'Asha',
  visitFee: 12900,
  startCode: null,
  endCode: null,
  changeOrderOpen: false,
  cancelledReason: null,
  defaultStatusLabel: 'Booking status',
};

describe('booking detail hero copy', () => {
  it('keeps the existing visit-fee payment instructions', () => {
    expect(heroCopy({ ...baseInput, status: 'pending_payment' })).toEqual({
      title: 'Pay the visit fee to send your request',
      subtitle: "Asha is notified as soon as the ₹129 visit fee is paid. It's adjusted in your final bill.",
    });
  });

  it('shows the provider delivery instructions for proposal bookings', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'delivery_pending',
        archetype: 'proposal',
        isCustomer: false,
      }),
    ).toEqual({
      title: 'Prepare the deliverables',
      subtitle: 'Submit the delivery links so Asha can review them.',
    });
  });

  it('uses the 72-hour delivery review copy for the customer', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'completion_requested',
        archetype: 'proposal',
        deliveryReview: true,
      }),
    ).toEqual({
      title: 'Review the delivery',
      subtitle: 'Open the delivered work below, pay any final milestone, then accept. It is accepted automatically 72 hours after delivery once fully paid.',
    });
  });

  it('uses delivery review copy for the provider without asking for a completion code', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'completion_requested',
        archetype: 'proposal',
        isCustomer: false,
        deliveryReview: true,
      }),
    ).toEqual({
      title: 'Delivery sent',
      subtitle: 'Waiting for the customer to review and pay the final milestone.',
    });
  });

  it('preserves the regular customer completion-code copy outside proposal delivery', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'completion_requested',
        deliveryReview: false,
      }),
    ).toEqual({
      title: 'Asha marked the job done',
      subtitle: 'Check the work, then share your completion code.',
    });
  });

  it('preserves the regular provider completion-code copy outside proposal delivery', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'completion_requested',
        isCustomer: false,
        deliveryReview: false,
      }),
    ).toEqual({
      title: 'Enter the completion code',
      subtitle: 'Ask Asha for the 4-digit completion code.',
    });
  });

  it('uses the existing status label when the provider copy has no special case', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'confirmed',
        archetype: 'fixed',
        isCustomer: false,
      }),
    ).toEqual({ title: 'Booking status' });
  });

  describe('booking detail date formatting', () => {
    it('keeps the existing locale and date parts', () => {
      const format = jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('formatted');

      try {
        expect(fmt('2026-01-02T03:04:00.000Z')).toBe('formatted');
        expect(format).toHaveBeenCalledWith('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        });
      } finally {
        format.mockRestore();
      }
    });
  });

  it('preserves a supplied cancellation reason for customers', () => {
    expect(
      heroCopy({
        ...baseInput,
        status: 'cancelled',
        cancelledReason: 'Provider unavailable',
      }),
    ).toEqual({
      title: 'Booking cancelled',
      subtitle: 'Provider unavailable',
    });
  });

  describe('proposal payment-default eligibility', () => {
    const now = Date.parse('2026-11-19T12:00:00.000Z');

    it('requires an unpaid due milestone that was reminded at least 48 hours ago', () => {
      const due = {
        status: 'due' as const,
        due_at: new Date(now - 49 * 60 * 60 * 1000).toISOString(),
        reminded_at: new Date(now - 49 * 60 * 60 * 1000).toISOString(),
      };
      const early = {
        ...due,
        due_at: new Date(now - 47 * 60 * 60 * 1000).toISOString(),
        reminded_at: new Date(now - 47 * 60 * 60 * 1000).toISOString(),
      };

      expect(canReportProposalPaymentDefault([due], 'completion_requested', 'submitted', now)).toBe(true);
      expect(canReportProposalPaymentDefault([early], 'completion_requested', 'submitted', now)).toBe(false);
      expect(canReportProposalPaymentDefault([due], 'completion_requested', 'not_applicable', now)).toBe(false);
      expect(canReportProposalPaymentDefault([{ ...due, reminded_at: null }], 'completion_requested', 'submitted', now)).toBe(false);
      expect(canReportProposalPaymentDefault([{ ...due, status: 'paid' }], 'completion_requested', 'submitted', now)).toBe(false);
      expect(canReportProposalPaymentDefault([due], 'in_progress', 'pending', now)).toBe(true);
    });
  });

  describe('family-specific quote actions', () => {
    it('familySpecificQuoteActions keeps itemized, package and BYO paths separate', () => {
      const basePackage = {
        id: 'package-base',
        status: 'approved' as const,
        is_change_order: false,
        quote_type: 'package' as const,
      };
      const fixedAddon = {
        id: 'package-addon',
        status: 'sent' as const,
        is_change_order: true,
        quote_type: 'package' as const,
      };
      const itemized = {
        id: 'inspect-quote',
        status: 'sent' as const,
        is_change_order: true,
        quote_type: 'itemized' as const,
      };
      const fixedBooking = {
        archetype: 'fixed' as const,
        booking_origin: 'marketplace' as const,
        status: 'in_progress' as const,
        approved_quote_id: basePackage.id,
      };
      const zeroHintBooking = { ...fixedBooking, changeOrder: '0' };
      const oneHintBooking = { ...fixedBooking, changeOrder: '1' };
      const results = {
        fixedEditor: getQuoteEditorMode(fixedBooking, [basePackage]),
        zeroHintEditor: getQuoteEditorMode(zeroHintBooking, [basePackage]),
        oneHintEditor: getQuoteEditorMode(oneHintBooking, [basePackage]),
        fixedApproval: getQuoteApprovalMode(fixedBooking, fixedAddon),
        fixedEditorWithPendingAddon: getQuoteEditorMode(fixedBooking, [
          basePackage,
          { ...fixedAddon, status: 'approved_pending_payment' },
        ]),
        ownerCanSend: canManageServiceQuotes('owner'),
        managerCanSend: canManageServiceQuotes('manager'),
        staffCannotSend: canManageServiceQuotes('staff'),
        customerCannotSend: canManageServiceQuotes('customer'),
        byoRetryAfterPaidUnrelatedSchedule: canPayPendingQuoteWithoutSchedule(
          { archetype: 'fixed', booking_origin: 'byo' },
          'pending-quote',
          [{ quote_id: 'accepted-package', status: 'paid' }],
        ),
        byoUsesScheduleWhenPendingQuoteObligationIsDue: canPayPendingQuoteWithoutSchedule(
          { archetype: 'fixed', booking_origin: 'byo' },
          'pending-quote',
          [{ quote_id: 'pending-quote', status: 'due' }],
        ),
        marketplaceFixedDoesNotFallbackToGenericPayment: canPayPendingQuoteWithoutSchedule(
          { archetype: 'fixed', booking_origin: 'marketplace' },
          'pending-quote',
          [{ quote_id: 'accepted-package', status: 'paid' }],
        ),
        inspectApproval: getQuoteApprovalMode({
          ...fixedBooking,
          archetype: 'inspect_quote',
          status: 'in_progress',
        }, itemized),
        byoEditor: getQuoteEditorMode({
          ...fixedBooking,
          booking_origin: 'byo',
        }, [{ ...basePackage, quote_type: 'itemized' }]),
        byoInitialEditor: getQuoteEditorMode({
          ...fixedBooking,
          booking_origin: 'byo',
          status: 'quote_sent',
          approved_quote_id: null,
        }, [itemized]),
        proposalEditor: getQuoteEditorMode({
          ...fixedBooking,
          archetype: 'proposal',
        }, [basePackage]),
        marketplaceFixedItemized: getQuoteApprovalMode(fixedBooking, itemized),
      };

      expect(results).toEqual({
        fixedEditor: 'fixed_addons',
        zeroHintEditor: 'fixed_addons',
        oneHintEditor: 'fixed_addons',
        fixedApproval: 'fixed_addons',
        fixedEditorWithPendingAddon: null,
        ownerCanSend: true,
        managerCanSend: true,
        staffCannotSend: false,
        customerCannotSend: false,
        byoRetryAfterPaidUnrelatedSchedule: true,
        byoUsesScheduleWhenPendingQuoteObligationIsDue: false,
        marketplaceFixedDoesNotFallbackToGenericPayment: false,
        inspectApproval: 'itemized',
        byoEditor: 'itemized',
        byoInitialEditor: 'itemized',
        proposalEditor: null,
        marketplaceFixedItemized: null,
      });
    });
  });
});
