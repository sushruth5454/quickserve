import type { PublicReview } from '../../lib/apiTypes';
import type { ProviderService } from '../../lib/types';
import { canPayInstantly } from '../booking/packages/packageModel';

export function avg(reviews: PublicReview[], key: 'punctuality' | 'quality' | 'behaviour' | 'pricing') {
  const vals = reviews.map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export type ProviderProfileService = Pick<ProviderService, 'id' | 'provider_id' | 'category_id' | 'categories' | 'service_packages'>;

export interface ProviderProfileSelection {
  providerId: string;
  serviceId: string | null;
  packageId: string | null;
}

export type ProviderProfilePackageRoute =
  | {
      pathname: '/book/[providerServiceId]';
      params: { providerServiceId: string; packageId: string };
    }
  | {
      pathname: '/request/new';
      params: { categoryId: string; name: string; providerId: string; providerName: string; package: string };
    };

export function reconcileProviderProfileSelection(
  previous: ProviderProfileSelection | null,
  providerId: string,
  services: readonly ProviderProfileService[],
  requestedCategorySlug?: string,
): ProviderProfileSelection {
  const providerServices = services.filter((service) => service.provider_id === providerId);
  const retainedService = previous?.providerId === providerId
    ? providerServices.find((service) => service.id === previous.serviceId)
    : undefined;
  const service = retainedService
    ?? providerServices.find((item) => item.categories?.slug === requestedCategorySlug)
    ?? providerServices[0];
  const retainedPackage = retainedService && previous?.packageId
    ? retainedService.service_packages?.find((item) =>
        item.id === previous.packageId && item.provider_service_id === retainedService.id && item.active)
    : undefined;

  return {
    providerId,
    serviceId: service?.id ?? null,
    packageId: retainedPackage && service?.id === retainedService?.id ? retainedPackage.id : null,
  };
}

export function selectProviderProfileService(
  previous: ProviderProfileSelection | null,
  providerId: string,
  serviceId: string,
): ProviderProfileSelection {
  if (previous?.providerId === providerId && previous.serviceId === serviceId) return previous;
  return { providerId, serviceId, packageId: null };
}

export function selectProviderProfilePackage(
  providerId: string,
  serviceId: string,
  packageId: string,
): ProviderProfileSelection {
  return { providerId, serviceId, packageId };
}

export function providerProfilePackageRoute(input: {
  providerId: string;
  providerName: string;
  service: ProviderProfileService | undefined;
  packageId: string | null;
  canCommit: boolean;
}): ProviderProfilePackageRoute | null {
  const { providerId, providerName, service, packageId, canCommit } = input;
  if (!canCommit || !service || service.provider_id !== providerId || !service.category_id || !packageId) return null;

  const servicePackage = service.service_packages?.find((item) =>
    item.id === packageId && item.provider_service_id === service.id && item.active);
  if (!servicePackage) return null;

  if (servicePackage.price_type === 'fixed') {
    return canPayInstantly(servicePackage)
      ? {
          pathname: '/book/[providerServiceId]',
          params: { providerServiceId: service.id, packageId: servicePackage.id },
        }
      : null;
  }

  return {
    pathname: '/request/new',
    params: {
      categoryId: service.category_id,
      name: service.categories?.name ?? 'service',
      providerId,
      providerName,
      package: servicePackage.id,
    },
  };
}
