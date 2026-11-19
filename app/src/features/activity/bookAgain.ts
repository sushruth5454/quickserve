import type { BookingArchetype, BookingStatus, LocationMode } from '../../lib/types';

type BookAgainBooking = {
  archetype?: BookingArchetype;
  status?: BookingStatus;
  provider_service_id: string;
  provider_id?: string;
  recurring_schedule_id?: string | null;
  location_mode?: LocationMode;
  proposal_id?: string | null;
  service_package_id?: string | null;
  categories?: { slug: string; name: string } | null;
};

const ONE_TIME_ARCHETYPES: BookingArchetype[] = ['fixed', 'inspect_quote', 'time_based'];

export function canBookAgain(booking: BookAgainBooking): boolean {
  if (
    booking.status !== 'completed' ||
    booking.recurring_schedule_id ||
    booking.proposal_id ||
    booking.archetype === 'proposal' ||
    booking.archetype === 'remote' ||
    booking.location_mode === 'remote'
  ) return false;

  return booking.archetype === undefined || ONE_TIME_ARCHETYPES.includes(booking.archetype);
}

export function shouldShowBookAgain(booking: BookAgainBooking, enabled: boolean): boolean {
  return enabled && canBookAgain(booking);
}

export function bookAgainRoute(booking: BookAgainBooking, serviceActive = true) {
  if (!serviceActive) {
    return booking.provider_id
      ? {
          pathname: '/provider/[id]',
          params: { id: booking.provider_id },
        } as const
      : null;
  }

  if (booking.archetype === 'fixed') {
    return {
      pathname: '/book-fixed/[providerServiceId]',
      params: { providerServiceId: booking.provider_service_id },
    } as const;
  }

  if (booking.archetype === 'time_based' && booking.service_package_id) {
    return {
      pathname: '/book/[providerServiceId]',
      params: {
        providerServiceId: booking.provider_service_id,
        packageId: booking.service_package_id,
        archetype: 'time_based',
      },
    } as const;
  }

  if (!booking.archetype || booking.archetype === 'inspect_quote') {
    return {
      pathname: '/book/[providerServiceId]',
      params: { providerServiceId: booking.provider_service_id },
    } as const;
  }

  if (!booking.categories?.slug) return null;

  return {
    pathname: '/category/[slug]',
    params: { slug: booking.categories.slug, name: booking.categories.name },
  } as const;
}
