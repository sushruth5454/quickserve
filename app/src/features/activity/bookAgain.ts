import type { BookingArchetype } from '../../lib/types';

type BookAgainBooking = {
  archetype?: BookingArchetype;
  provider_service_id: string;
  service_package_id?: string | null;
  categories?: { slug: string; name: string } | null;
};

export function bookAgainRoute(booking: BookAgainBooking) {
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
