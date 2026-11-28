import type { ProviderJob } from '../../../lib/types';
import { getPrimaryJobAction } from '../../../lib/types';
import { firstName, getDashboardNextStep, selectDashboardWork } from '../model';

describe('firstName', () => {
  it('returns the first part of a full name', () => {
    expect(firstName('Asha Rao')).toBe('Asha');
  });

  it('uses the existing fallback for an empty name', () => {
    expect(firstName('')).toBe('Customer');
  });
});

function job(
  booking_id: string,
  status: ProviderJob['status'],
  archetype: ProviderJob['archetype'] = 'fixed',
  scheduled_at: string | null = null,
): ProviderJob {
  return {
    booking_id,
    status,
    archetype,
    category_name: 'Repair',
    customer_name: 'Customer',
    description: '',
    scheduled_at,
    created_at: '2026-11-27T10:00:00.000Z',
    visit_fee: 100,
    area: '',
    distance_km: null,
    address_line: null,
    lat: null,
    lng: null,
  };
}

describe('selectDashboardWork', () => {
  it('ID-DASH-ACTIVE-ALL: keeps confirmed and delivery_pending once in active work', () => {
    const jobs = [
      job('request', 'requested'),
      job('en-route', 'en_route'),
      job('completion', 'completion_requested'),
      job('confirmed', 'confirmed', 'proposal'),
      job('delivery', 'delivery_pending', 'proposal'),
      job('inspecting', 'inspecting'),
      job('in-progress', 'in_progress'),
      job('accepted', 'accepted'),
      job('awaiting-payment', 'awaiting_payment'),
      job('quote-sent', 'quote_sent'),
      job('disputed', 'disputed'),
      job('closed', 'closed'),
    ];

    const { incoming, next, rest } = selectDashboardWork(jobs);
    const activeIds = [next?.booking_id, ...rest.map((item) => item.booking_id)];

    expect(incoming.map((item) => item.booking_id)).toEqual(['request']);
    expect(activeIds).toEqual([
      'en-route',
      'completion',
      'confirmed',
      'delivery',
      'inspecting',
      'in-progress',
      'accepted',
      'awaiting-payment',
      'quote-sent',
      'disputed',
    ]);
    expect(activeIds.filter((id) => id === 'confirmed')).toHaveLength(1);
    expect(activeIds.filter((id) => id === 'delivery')).toHaveLength(1);
  });

  it('ID-DASH-PRIORITY: preserves status priority and sorts equal-priority work by schedule', () => {
    const { next, rest } = selectDashboardWork([
      job('later-accepted', 'accepted', 'fixed', '2026-12-20T10:00:00.000Z'),
      job('earlier-accepted', 'accepted', 'fixed', '2026-12-19T10:00:00.000Z'),
      job('en-route', 'en_route'),
    ]);

    expect([next?.booking_id, ...rest.map((item) => item.booking_id)]).toEqual([
      'en-route',
      'earlier-accepted',
      'later-accepted',
    ]);
  });

  it('ID-DASH-PROPOSAL-CTA: confirmed and delivery actions open booking details', () => {
    const confirmed = job('proposal-confirmed', 'confirmed', 'proposal');
    const delivery = job('proposal-delivery', 'delivery_pending', 'proposal');

    expect(getDashboardNextStep(confirmed)?.label).toBe('View confirmed booking');
    expect(getPrimaryJobAction(confirmed)).toBe('booking_detail');
    expect(getDashboardNextStep(delivery)?.label).toBe('Manage delivery');
    expect(getPrimaryJobAction(delivery)).toBe('booking_detail');
  });
});
