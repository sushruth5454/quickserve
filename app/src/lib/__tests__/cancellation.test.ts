import fixtures from '../../../../supabase/tests/fixtures/cancellation-cases.json';
import { cancellationDisplayOutcome, type CancellationPolicySnapshot } from '../cancellation';

const policies: Record<string, CancellationPolicySnapshot> = {
  standard_visit: {
    key: 'standard_visit', label: 'Standard visit cancellation', version: 1,
    rules: [
      { name: 'provider_fault_full_refund', priority: 100, match: { reasons: ['provider_fault'] }, result: { principal_bp: 10000, platform_bp: 10000 } },
      { name: 'provider_cancels_full_refund_and_credit', priority: 95, match: { actors: ['provider'], reasons: ['provider_cancellation', 'provider_no_show'] }, result: { principal_bp: 10000, platform_bp: 10000, credit_paise: 5000 } },
      { name: 'platform_cancellation', priority: 90, match: { reasons: ['platform'] }, result: { principal_bp: 10000, platform_bp: 10000 } },
      { name: 'customer_before_trip', priority: 80, match: { actors: ['customer'], reasons: ['customer_choice'], statuses: ['pending_payment', 'requested', 'accepted'] }, result: { principal_bp: 10000, platform_bp: 0 } },
      { name: 'customer_after_trip_or_no_show', priority: 70, match: { reasons: ['customer_choice', 'customer_no_show', 'customer_payment_default'], statuses: ['en_route', 'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested', 'confirmed'] }, result: { principal_bp: 0, platform_bp: 0 } },
    ],
  },
  fixed: {
    key: 'fixed', label: 'Fixed service cancellation', version: 1,
    rules: [
      { name: 'provider_fault', priority: 100, match: { reasons: ['provider_fault'] }, result: { principal_bp: 10000, platform_bp: 10000 } },
      { name: 'full_at_three', priority: 80, match: { actors: ['customer'], min_hours_before_start: 3 }, result: { principal_bp: 10000, platform_bp: 10000 } },
      { name: 'arrival_or_no_show', priority: 75, match: { reasons: ['customer_no_show', 'customer_payment_default'] }, result: { principal_bp: 5000, platform_bp: 0 } },
      { name: 'arrival_status', priority: 74, match: { actors: ['customer'], statuses: ['inspecting', 'in_progress', 'completion_requested'] }, result: { principal_bp: 5000, platform_bp: 0 } },
      { name: 'late_fee', priority: 70, match: { actors: ['customer'], max_hours_before_start: 3 }, result: { principal_bp: 10000, platform_bp: 10000, retained_principal_bp: 2500, retained_paise_max: 9900 } },
    ],
  },
  event_moderate: {
    key: 'event_moderate', label: 'Event moderate cancellation', version: 1,
    rules: [
      { name: 'provider_fault', priority: 100, match: { reasons: ['provider_fault'] }, result: { principal_bp: 10000, platform_bp: 10000 } },
      { name: 'cooling', priority: 90, match: { max_hours_since_booking: 48, min_hours_before_start: 720 }, result: { advance_bp: 10000, milestone_bp: 10000, platform_bp: 10000 } },
      { name: 'thirty_days', priority: 80, match: { min_hours_before_start: 720 }, result: { advance_bp: 0, milestone_bp: 10000, platform_bp: 0 } },
      { name: 'seven_days', priority: 70, match: { min_hours_before_start: 168, max_hours_before_start: 720 }, result: { advance_bp: 0, milestone_bp: 5000, platform_bp: 0 } },
      { name: 'inside_seven', priority: 60, match: { max_hours_before_start: 168 }, result: { advance_bp: 0, milestone_bp: 0, platform_bp: 0 } },
    ],
  },
  event_strict: {
    key: 'event_strict', label: 'Event strict cancellation', version: 1,
    rules: [
      { name: 'provider_fault', priority: 100, match: { reasons: ['provider_fault'] }, result: { principal_bp: 10000, platform_bp: 10000 } },
      { name: 'cooling_far', priority: 95, match: { max_hours_since_booking: 48, min_hours_before_start: 360 }, result: { advance_bp: 10000, milestone_bp: 5000, platform_bp: 10000 } },
      { name: 'cooling_near', priority: 94, match: { max_hours_since_booking: 48, max_hours_before_start: 360 }, result: { advance_bp: 10000, milestone_bp: 0, platform_bp: 10000 } },
      { name: 'fifteen_days', priority: 80, match: { min_hours_before_start: 360 }, result: { advance_bp: 0, milestone_bp: 5000, platform_bp: 0 } },
      { name: 'inside_fifteen', priority: 70, match: { max_hours_before_start: 360 }, result: { advance_bp: 0, milestone_bp: 0, platform_bp: 0 } },
    ],
  },
};

describe('SQL-backed cancellation display fixtures', () => {
  test.each(fixtures)('$name', (fixture) => {
    const createdAt = new Date('2026-11-15T00:00:00Z');
    const at = new Date(createdAt.getTime() + (fixture.hoursSinceBooking ?? 0) * 3_600_000);
    const scheduledAt = new Date(at.getTime() + (fixture.hoursBefore ?? 24) * 3_600_000);
    const snapshot = policies[fixture.policy];
    if (!snapshot) throw new Error(`Missing display policy fixture: ${fixture.policy}`);
    const outcome = cancellationDisplayOutcome(snapshot, {
      actor: fixture.actor as never,
      reason: fixture.reason as never,
      status: fixture.status,
      createdAt,
      scheduledAt,
      at,
      principalPaid: fixture.principal,
      platformFeePaid: fixture.platform,
      advancePaid: fixture.advance,
    });
    expect(outcome.refundAmount).toBe(fixture.refund);
    expect(outcome.providerCompensation).toBe(fixture.provider);
    expect(outcome.customerCredit).toBe(fixture.credit ?? 0);
  });
});
