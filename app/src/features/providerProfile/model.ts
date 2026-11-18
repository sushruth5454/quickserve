import type { Review } from '../../lib/types';

export function avg(reviews: Review[], key: 'punctuality' | 'quality' | 'behaviour' | 'pricing') {
  const vals = reviews.map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
