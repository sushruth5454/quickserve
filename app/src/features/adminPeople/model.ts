import type { AdminProvider, ProviderReviewStatus } from '../../lib/adminApi';

export type ProviderReviewAction = 'approve' | 'reject' | 'clarify';

const ACTION_TARGETS: Record<ProviderReviewStatus, ProviderReviewAction[]> = {
  pending: ['approve', 'reject', 'clarify'],
  approved: ['reject', 'clarify'],
  rejected: ['approve', 'clarify'],
  needs_clarification: ['approve', 'reject'],
};

export function providerReviewActions(provider: Pick<AdminProvider, 'submitted_at' | 'admin_review_status'>): ProviderReviewAction[] {
  if (!provider.submitted_at) return [];
  return ACTION_TARGETS[provider.admin_review_status];
}
