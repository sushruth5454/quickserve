import type { AdminProvider, ProviderReviewStatus } from '../../../lib/adminApi';
import { providerReviewActions } from '../model';

function provider(admin_review_status: ProviderReviewStatus, overrides: Partial<AdminProvider> = {}): AdminProvider {
  return {
    id: 'provider-1',
    full_name: 'Provider One',
    phone: '',
    city: '',
    kyc_status: 'pending',
    admin_review_status,
    has_payout_account: true,
    suspended: false,
    paused: false,
    is_online: false,
    rating_avg: 0,
    rating_count: 0,
    jobs_completed: 0,
    is_creator: false,
    categories: [],
    submitted_at: '2026-11-20T10:00:00.000Z',
    created_at: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('provider review actions', () => {
  it('ID-REVIEW-EACH-TARGET removes only the current submitted review target', () => {
    const actual = {
      pending: providerReviewActions(provider('pending')),
      approved: providerReviewActions(provider('approved')),
      rejected: providerReviewActions(provider('rejected')),
      needsClarification: providerReviewActions(provider('needs_clarification')),
      notSubmitted: providerReviewActions(provider('pending', { submitted_at: null })),
    };

    expect(actual).toEqual({
      pending: ['approve', 'reject', 'clarify'],
      approved: ['reject', 'clarify'],
      rejected: ['approve', 'clarify'],
      needsClarification: ['approve', 'reject'],
      notSubmitted: [],
    });
  });

  it('ID-REVIEW-NO-ACCOUNT keeps approval visible for server-side payout validation', () => {
    const actions = providerReviewActions(provider('pending', { has_payout_account: false }));

    expect(actions).toContain('approve');
  });

  it('ID-REVIEW-SUSPEND-INDEPENDENT preserves alternate reviews while suspended or paused', () => {
    const actions = providerReviewActions(provider('approved', { suspended: true, paused: true }));

    expect(actions).toEqual(['reject', 'clarify']);
  });
});
