import { getSportsBookingActions } from '../../model';

const now = new Date('2026-11-21T00:00:00.000Z');
const deadline = '2026-11-21T01:00:00.000Z';

const statuses = [
  'pending_payment',
  'requested',
  'awaiting_payment',
  'accepted',
  'declined',
  'cancelled',
  'completed',
  'expired',
] as const;
type Status = (typeof statuses)[number];

const viewers = [
  { key: 'customer', id: 'customer' },
  { key: 'owner', id: 'owner' },
  { key: 'businessReader', id: 'business-reader' },
  { key: 'stranger', id: 'stranger' },
] as const;
type ViewerKey = (typeof viewers)[number]['key'];

const expectedAccess: Record<Status, Record<ViewerKey, {
  canPay: boolean;
  canDecide: boolean;
  canCancel: boolean;
}>> = {
  pending_payment: {
    customer: { canPay: true, canDecide: false, canCancel: true },
    owner: { canPay: false, canDecide: false, canCancel: true },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  requested: {
    customer: { canPay: false, canDecide: false, canCancel: true },
    owner: { canPay: false, canDecide: true, canCancel: true },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  awaiting_payment: {
    customer: { canPay: true, canDecide: false, canCancel: true },
    owner: { canPay: false, canDecide: false, canCancel: true },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  accepted: {
    customer: { canPay: false, canDecide: false, canCancel: true },
    owner: { canPay: false, canDecide: false, canCancel: true },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  declined: {
    customer: { canPay: false, canDecide: false, canCancel: false },
    owner: { canPay: false, canDecide: false, canCancel: false },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  cancelled: {
    customer: { canPay: false, canDecide: false, canCancel: false },
    owner: { canPay: false, canDecide: false, canCancel: false },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  completed: {
    customer: { canPay: false, canDecide: false, canCancel: false },
    owner: { canPay: false, canDecide: false, canCancel: false },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
  expired: {
    customer: { canPay: false, canDecide: false, canCancel: false },
    owner: { canPay: false, canDecide: false, canCancel: false },
    businessReader: { canPay: false, canDecide: false, canCancel: false },
    stranger: { canPay: false, canDecide: false, canCancel: false },
  },
};

function bookingFor(status: Status, businessRole?: 'staff') {
  return {
    status,
    customer_id: 'customer',
    owner_id: 'owner',
    business_role: businessRole,
    payment_mode: 'online' as const,
    paid_at: null,
    hold_expires_at: deadline,
    pay_by: deadline,
    expires_at: deadline,
    starts_at: '2026-11-22T00:00:00.000Z',
  };
}

describe('sports booking action eligibility', () => {
  it('SP-ACTION-ACTOR-STATE-DEADLINE: covers all statuses for customer, owner, business reader, and stranger', () => {
    statuses.forEach((status) => {
      viewers.forEach(({ key, id }) => {
        const actual = getSportsBookingActions({
          booking: bookingFor(status, key === 'businessReader' ? 'staff' : undefined),
          viewerId: id,
          now,
        });
        const expected = {
          ...expectedAccess[status][key],
          applicableDeadline: status === 'requested' ? deadline
            : status === 'pending_payment' || status === 'awaiting_payment' ? deadline
              : null,
          deadlineKind: status === 'requested' ? 'request'
            : status === 'pending_payment' ? 'hold'
              : status === 'awaiting_payment' ? 'payment'
                : null,
          nextAction: status === 'requested'
            ? 'view_request'
            : expectedAccess[status][key].canPay ? 'pay' : 'view_booking',
        };
        expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
      });
    });
  });
});
