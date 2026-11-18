export interface ActivityUnreadCounts {
  services: number;
  requests: number;
  shop: number;
  sports: number;
}

export type ActivitySegment = 'services' | 'requests' | 'shop' | 'sports';

export interface ActivityFeatureVisibility {
  products: boolean;
  sports: boolean;
}

export { bookAgainRoute as bookAgainTarget } from './bookAgain';

export function parseActivityUnreadCounts(value: unknown): ActivityUnreadCounts {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('The server returned invalid activity unread counts.');
  }
  const counts = row as Record<keyof ActivityUnreadCounts, unknown>;
  for (const key of ['services', 'requests', 'shop', 'sports'] as const) {
    if (typeof counts[key] !== 'number' || !Number.isSafeInteger(counts[key]) || counts[key] < 0) {
      throw new Error('The server returned invalid activity unread counts.');
    }
  }
  return {
    services: counts.services as number,
    requests: counts.requests as number,
    shop: counts.shop as number,
    sports: counts.sports as number,
  };
}

export function visibleActivitySegments(features: ActivityFeatureVisibility): ActivitySegment[] {
  return [
    'services',
    'requests',
    ...(features.products ? (['shop'] as const) : []),
    ...(features.sports ? (['sports'] as const) : []),
  ];
}

export function visibleActivityUnreadCounts(
  counts: ActivityUnreadCounts,
  features: ActivityFeatureVisibility,
): ActivityUnreadCounts {
  return {
    services: counts.services,
    requests: counts.requests,
    shop: features.products ? counts.shop : 0,
    sports: features.sports ? counts.sports : 0,
  };
}

export function totalVisibleActivityUnread(
  counts: ActivityUnreadCounts,
  features: ActivityFeatureVisibility,
): number {
  const visible = visibleActivityUnreadCounts(counts, features);
  return visible.services + visible.requests + visible.shop + visible.sports;
}
