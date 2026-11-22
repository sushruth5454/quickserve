import type { TopRatedService } from '../lib/apiTypes';
import { formatINR } from '../lib/money';

export interface ProviderCardModelProps {
  services?: readonly TopRatedService[];
  visitFeeLabel?: string;
  isOnline: boolean;
  onLeaveUntil?: string | null;
  mode?: 'visit' | 'proposal';
}

export interface ProviderCardModel {
  lead: TopRatedService | null;
  otherServiceCount: number;
  categoryLabel: string | null;
  priceLabel: string;
  ctaLabel: string;
  isOnline: boolean;
}

function compareOrder(a: { sort_order: number; id: string }, b: { sort_order: number; id: string }) {
  return a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function packageLabel(service: TopRatedService): string | null {
  const pkg = [...service.service_packages].sort(compareOrder)[0];
  if (!pkg) return null;

  switch (pkg.price_type) {
    case 'fixed':
      return pkg.price == null ? null : `Fixed ${formatINR(pkg.price)} per ${pkg.unit}`;
    case 'range':
      return pkg.price_min == null || pkg.price_max == null
        ? null
        : `Range ${formatINR(pkg.price_min)}–${formatINR(pkg.price_max)} per ${pkg.unit}`;
    case 'from':
      return pkg.price_min == null ? null : `From ${formatINR(pkg.price_min)} per ${pkg.unit}`;
    case 'quote':
      return `Quote per ${pkg.unit}`;
  }
}

export function providerCardModel({
  services = [],
  visitFeeLabel,
  isOnline,
  onLeaveUntil = null,
  mode = 'visit',
}: ProviderCardModelProps): ProviderCardModel {
  const active = services.filter((service) => service.active);
  const ordered = [...active].sort((a, b) =>
    (a.categories?.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.categories?.sort_order ?? Number.MAX_SAFE_INTEGER)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const lead = ordered[0] ?? null;
  const otherServiceCount = Math.max(0, ordered.length - 1);
  const categoryLabel = lead?.categories?.name
    ? `${lead.categories.name}${otherServiceCount > 0 ? ` +${otherServiceCount}` : ''}`
    : null;
  const isEffectivelyOnline = isOnline && onLeaveUntil == null;
  const archetype = lead?.categories?.archetype;
  const usesPackages = archetype === 'fixed' || archetype === 'time_based' || archetype === 'remote';
  const packagePriceLabel = lead && usesPackages ? packageLabel(lead) : null;
  const priceLabel = services.length === 0 && visitFeeLabel !== undefined
    ? mode === 'proposal'
      ? 'Quote per brief'
      : `Visit fee ${visitFeeLabel} · adjusted in bill`
    : !lead
      ? 'No packages listed'
      : archetype === 'proposal'
        ? 'Quote per brief'
        : archetype === 'inspect_quote'
          ? `Visit fee ${formatINR(lead.visit_fee)}`
          : packagePriceLabel ?? 'No packages listed';
  const ctaLabel = services.length === 0 && visitFeeLabel !== undefined
    ? mode === 'proposal'
      ? 'Request proposal'
      : isEffectivelyOnline
        ? 'Book'
        : 'Schedule'
    : !lead
      ? 'View profile'
      : archetype === 'proposal'
        ? 'Request proposal'
        : archetype !== 'inspect_quote' && packagePriceLabel == null
          ? 'View profile'
          : isEffectivelyOnline
            ? 'Book'
            : 'Schedule';

  return {
    lead,
    otherServiceCount,
    categoryLabel,
    priceLabel,
    ctaLabel,
    isOnline: isEffectivelyOnline,
  };
}

export function topRatedHeaderModel(city: string | null | undefined, count: number | null): { title: string; subtitle: string } {
  const selectedCity = city?.trim();
  const countLabel = count == null ? null : `${count} verified ${count === 1 ? 'pro' : 'pros'}`;
  return {
    title: selectedCity ? `Top rated in ${selectedCity}` : 'Top rated professionals',
    subtitle: [countLabel, 'ranked by average rating, then review count'].filter(Boolean).join(' · '),
  };
}
