import type { PublicReview } from '../../lib/apiTypes';

export function avg(reviews: PublicReview[], key: 'punctuality' | 'quality' | 'behaviour' | 'pricing') {
  const vals = reviews.map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
