import { fmt, heroCopy } from '../model';

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
});
