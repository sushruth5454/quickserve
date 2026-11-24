import type { ShopStatus } from './api';

export interface ReviewAction {
  id: ShopStatus;
  label: string;
  requiresReason: boolean;
  confirmation: 'none' | 'destructive';
}

export function shopReviewActions(status: ShopStatus): ReviewAction[] {
  const actions: ReviewAction[] = [];

  if (status !== 'under_review') {
    actions.push({
      id: 'under_review',
      label: 'Under review',
      requiresReason: false,
      confirmation: 'none',
    });
  }

  if (status === 'submitted' || status === 'under_review' || status === 'suspended') {
    actions.push({
      id: 'verified',
      label: status === 'suspended' ? 'Restore verification' : 'Verify',
      requiresReason: false,
      confirmation: 'none',
    });
  }

  if (status !== 'rejected') {
    actions.push({
      id: 'rejected',
      label: 'Reject',
      requiresReason: true,
      confirmation: 'destructive',
    });
  }

  if (status !== 'suspended') {
    actions.push({
      id: 'suspended',
      label: 'Suspend',
      requiresReason: true,
      confirmation: 'destructive',
    });
  }

  return actions;
}
