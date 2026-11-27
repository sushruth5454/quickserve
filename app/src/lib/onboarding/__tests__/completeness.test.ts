import { stepDone } from '../completeness';
import type { OnboardingState, PayoutAccount } from '../types';

function stateFor(
  providerOverrides: Partial<NonNullable<OnboardingState['provider']>> = {},
  payout: PayoutAccount | null = null,
): OnboardingState {
  return {
    provider: {
      id: 'provider-1',
      bio: '',
      city: 'Test city',
      service_radius_km: 10,
      years_experience: 0,
      languages: [],
      kyc_status: 'pending',
      suspended: false,
      is_online: false,
      rating_avg: 0,
      rating_count: 0,
      jobs_completed: 0,
      commission_tier: 12,
      razorpay_account_id: null,
      created_at: '2026-11-20T10:00:00.000Z',
      gender: null,
      timezone: 'Asia/Kolkata',
      base_area: null,
      max_jobs_per_day: null,
      paused: false,
      deactivated_at: null,
      onboarding_step: 0,
      submitted_at: null,
      terms_version: null,
      kyc_reason: null,
      review_note: null,
      lat: null,
      lng: null,
      ...providerOverrides,
    },
    profile: null,
    payout,
    documents: [],
    availability: [],
    time_off: [],
    portfolio: [],
    checks: [],
    go_live: { state: 'draft', reasons: [], paused: false },
    terms_version: '',
  };
}

describe('payout setup completion', () => {
  it('recognizes a legacy provider account identifier without a payout row', () => {
    const state = stateFor({ razorpay_account_id: 'acc_legacy' });

    expect(stepDone('payouts', state)).toBe(true);
    expect(state.payout).toBeNull();
    expect(state.provider?.kyc_status).toBe('pending');
  });

  it('keeps gateway-unavailable setup continuation', () => {
    const payout: PayoutAccount = {
      rail: 'payouts',
      activation_status: 'not_started',
      beneficiary_name: null,
      account_type: 'individual',
      gstin: null,
      registered_address: null,
      bank_last4: null,
      ifsc: null,
      last_error: 'gateway_unavailable',
      requirements: [],
    };

    expect(stepDone('payouts', stateFor({}, payout))).toBe(true);
  });

  it('does not infer payout setup from verified KYC alone', () => {
    expect(stepDone('payouts', stateFor({ kyc_status: 'verified' }))).toBe(false);
  });
});
