import type { Review } from '../../../lib/types';
import { avg } from '../model';

function review(values: Partial<Review>): Review {
  return {
    id: 'review-1',
    booking_id: 'booking-1',
    customer_id: 'customer-1',
    provider_id: 'provider-1',
    rating: 5,
    punctuality: null,
    quality: null,
    behaviour: null,
    pricing: null,
    comment: null,
    provider_reply: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...values,
  };
}

describe('provider profile model', () => {
  it('averages only present review values and returns null when none exist', () => {
    const actual = [
      avg([review({ punctuality: 2 }), review({ punctuality: null }), review({ punctuality: 4 })], 'punctuality'),
      avg([review({ punctuality: null })], 'punctuality'),
    ];
    expect(JSON.stringify(actual)).toBe(JSON.stringify([3, null]));
  });
});
