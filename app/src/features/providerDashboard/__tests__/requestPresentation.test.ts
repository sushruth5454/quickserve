import { getNextStep, getRequestActionState, getPrimaryJobAction, isActiveProviderJob } from '../DashboardWidgets';
import type { ProviderJob } from '../../../lib/types';

const request = (overrides: Partial<ProviderJob> = {}): ProviderJob => ({
  booking_id: 'booking-a',
  status: 'requested',
  category_name: 'Repair',
  customer_name: 'Customer',
  description: '',
  scheduled_at: null,
  created_at: '2026-11-26T10:00:00.000Z',
  visit_fee: 0,
  area: 'Central',
  distance_km: null,
  address_line: null,
  lat: null,
  lng: null,
  ...overrides,
});

describe('provider request and next-job presentation', () => {
  it('uses the server deadline for an old booking funded recently', () => {
    const now = Date.parse('2026-11-27T18:00:00.000Z');
    const job = request({
      created_at: '2026-11-26T10:00:00.000Z',
      request_expires_at: '2026-11-27T18:12:00.000Z',
      can_accept: true,
      can_decline: true,
    });

    expect(getRequestActionState(job, now)).toEqual({
      leftMs: 12 * 60 * 1000,
      canAccept: true,
      canDecline: true,
    });
  });

  it('does not invent a response timer for a recurring occurrence', () => {
    const job = request({
      recurring_schedule_id: 'schedule-a',
      request_expires_at: null,
      can_accept: true,
      can_decline: true,
    });

    expect(getRequestActionState(job, Date.now())).toEqual({
      leftMs: null,
      canAccept: true,
      canDecline: true,
    });
  });

  it('does not expose request actions when the server flags deny them', () => {
    const job = request({ request_expires_at: '2026-11-27T18:12:00.000Z', can_accept: false, can_decline: false });

    expect(getRequestActionState(job, Date.parse('2026-11-27T18:00:00.000Z'))).toEqual({
      leftMs: 12 * 60 * 1000,
      canAccept: false,
      canDecline: false,
    });
  });

  it('disables ordinary acceptance at the server deadline without hiding decline', () => {
    const job = request({
      request_expires_at: '2026-11-27T17:59:59.999Z',
      can_accept: true,
      can_decline: true,
    });

    expect(getRequestActionState(job, Date.parse('2026-11-27T18:00:00.000Z'))).toEqual({
      leftMs: 0,
      canAccept: false,
      canDecline: true,
    });
  });

  it('routes an accepted time-based session into the start-code workflow', () => {
    const job = request({ status: 'accepted', archetype: 'time_based' });

    expect(getNextStep(job)?.label).toBe('Enter session start code');
    expect(getPrimaryJobAction(job)).toBe('booking_detail');
  });

  it('keeps confirmed and delivery-pending proposals active with their actual actions', () => {
    const confirmed = request({ status: 'confirmed', archetype: 'proposal' });
    const deliveryPending = request({ status: 'delivery_pending', archetype: 'proposal' });

    expect(isActiveProviderJob(confirmed)).toBe(true);
    expect(isActiveProviderJob(deliveryPending)).toBe(true);
    expect(getNextStep(confirmed)?.label).toBe('Enter start code');
    expect(getNextStep(deliveryPending)?.label).toBe('Submit delivery');
    expect(getPrimaryJobAction(deliveryPending)).toBe('booking_detail');
  });
});
