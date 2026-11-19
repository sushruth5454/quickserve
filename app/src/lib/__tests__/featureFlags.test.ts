import { isFeatureOn } from '../featureFlagModel';

describe('feature flags', () => {
  it('keeps unknown flags off', () => {
    expect(isFeatureOn({ ai_assistant: true, archetypes: { fixed: true } }, 'future_feature')).toBe(false);
    expect(isFeatureOn({}, 'business_payout_identity')).toBe(false);
  });

  it('reads the explicit business payout feature switch', () => {
    expect(isFeatureOn({ business_payout_identity: false }, 'business_payout_identity')).toBe(false);
    expect(isFeatureOn({ business_payout_identity: true }, 'business_payout_identity')).toBe(true);
  });

  it('fails child features closed when a parent is off', () => {
    expect(isFeatureOn({ recurring_bookings: false, recurring_skip_pause: true }, 'recurring_skip_pause')).toBe(false);
    expect(isFeatureOn({ sports: false, sports_online_payments: true }, 'sports_online_payments')).toBe(false);
  });

  it('enables a child only when both the child and its parent are on', () => {
    expect(isFeatureOn({ recurring_bookings: true, recurring_skip_pause: true }, 'recurring_skip_pause')).toBe(true);
    expect(isFeatureOn({ recurring_bookings: true, recurring_skip_pause: false }, 'recurring_skip_pause')).toBe(false);
  });
});
