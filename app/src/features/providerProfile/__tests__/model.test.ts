import type { Review, ServicePackage } from '../../../lib/types';
import { packageDisplayPrice } from '../../booking/packages/packageModel';
import {
  avg,
  providerProfilePackageRoute,
  reconcileProviderProfileSelection,
  selectProviderProfilePackage,
  selectProviderProfileService,
  type ProviderProfileService,
} from '../model';

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

function packageItem(values: Partial<ServicePackage> & Pick<ServicePackage, 'id' | 'provider_service_id'>): ServicePackage {
  return {
    package_template_id: null,
    title: values.id,
    description: '',
    price_type: 'fixed',
    price: 2500,
    price_min: null,
    price_max: null,
    unit: 'job',
    qty_min: 1,
    qty_max: 1,
    duration_min: 60,
    inclusions: [],
    exclusions: [],
    deliverables: [],
    turnaround_days: null,
    revisions_included: 0,
    raw_files_included: false,
    usage_rights: {},
    travel_included_km: 0,
    active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...values,
  };
}

function service(values: Partial<ProviderProfileService> & Pick<ProviderProfileService, 'id' | 'provider_id' | 'category_id'>): ProviderProfileService {
  return {
    categories: { name: 'Cleaning', slug: 'cleaning' },
    service_packages: [],
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

  it('MK-PROFILE-package-exact-route keeps a fixed package on the exact selected provider service', () => {
    const serviceA = service({
      id: 'service-a',
      provider_id: 'provider-a',
      category_id: 'category-a',
      service_packages: [packageItem({ id: 'package-a', provider_service_id: 'service-a' })],
    });
    const serviceB = service({
      id: 'service-b',
      provider_id: 'provider-b',
      category_id: 'category-a',
      service_packages: [packageItem({ id: 'package-b', provider_service_id: 'service-b' })],
    });

    const actual = providerProfilePackageRoute({
      providerId: 'provider-a',
      providerName: 'Provider A',
      service: serviceA,
      packageId: 'package-a',
      canCommit: true,
    });

    expect(actual).toEqual({
      pathname: '/book/[providerServiceId]',
      params: { providerServiceId: 'service-a', packageId: 'package-a' },
    });
    expect(packageDisplayPrice(serviceA.service_packages![0]!)).toBe('₹25');
    expect(providerProfilePackageRoute({
      providerId: 'provider-a',
      providerName: 'Provider A',
      service: serviceB,
      packageId: 'package-b',
      canCommit: true,
    })).toBeNull();
  });

  it('MK-PROFILE-nonfixed-targeted-brief routes each nonfixed price to the exact provider, category, and package', () => {
    const serviceA = service({
      id: 'service-a',
      provider_id: 'provider-a',
      category_id: 'category-a',
      service_packages: [
        packageItem({ id: 'range', provider_service_id: 'service-a', price_type: 'range', price: null, price_min: 4000, price_max: 7000 }),
        packageItem({ id: 'from', provider_service_id: 'service-a', price_type: 'from', price: null, price_min: 5000 }),
        packageItem({ id: 'quote', provider_service_id: 'service-a', price_type: 'quote', price: null, price_min: null }),
      ],
    });
    const actual = serviceA.service_packages!.map((item) => ({
      displayPrice: packageDisplayPrice(item),
      route: providerProfilePackageRoute({
        providerId: 'provider-a',
        providerName: 'Provider A',
        service: serviceA,
        packageId: item.id,
        canCommit: true,
      }),
    }));

    expect(actual).toEqual([
      {
        displayPrice: '₹40–₹70',
        route: {
          pathname: '/request/new',
          params: { categoryId: 'category-a', name: 'Cleaning', providerId: 'provider-a', providerName: 'Provider A', package: 'range' },
        },
      },
      {
        displayPrice: 'From ₹50',
        route: {
          pathname: '/request/new',
          params: { categoryId: 'category-a', name: 'Cleaning', providerId: 'provider-a', providerName: 'Provider A', package: 'from' },
        },
      },
      {
        displayPrice: 'Price on request',
        route: {
          pathname: '/request/new',
          params: { categoryId: 'category-a', name: 'Cleaning', providerId: 'provider-a', providerName: 'Provider A', package: 'quote' },
        },
      },
    ]);

    const invalidFixed = service({
      id: 'service-a',
      provider_id: 'provider-a',
      category_id: 'category-a',
      service_packages: [packageItem({ id: 'invalid-fixed', provider_service_id: 'service-a', price: 0 })],
    });
    expect(providerProfilePackageRoute({
      providerId: 'provider-a',
      providerName: 'Provider A',
      service: invalidFixed,
      packageId: 'invalid-fixed',
      canCommit: true,
    })).toBeNull();
  });

  it('MK-PROFILE-selection-reset clears package selection on service, provider, or invalidated readback changes', () => {
    const serviceA = service({
      id: 'service-a',
      provider_id: 'provider-a',
      category_id: 'category-a',
      service_packages: [packageItem({ id: 'package-a', provider_service_id: 'service-a' })],
    });
    const serviceB = service({
      id: 'service-b',
      provider_id: 'provider-a',
      category_id: 'category-b',
      service_packages: [packageItem({ id: 'package-b', provider_service_id: 'service-b' })],
    });
    const initial = reconcileProviderProfileSelection(null, 'provider-a', [serviceA, serviceB], 'cleaning');
    const selected = selectProviderProfilePackage('provider-a', 'service-a', 'package-a');
    const changedService = selectProviderProfileService(selected, 'provider-a', 'service-b');
    const changedProvider = reconcileProviderProfileSelection(selected, 'provider-b', [
      service({ id: 'service-c', provider_id: 'provider-b', category_id: 'category-c' }),
    ]);
    const changedReadback = reconcileProviderProfileSelection(selected, 'provider-a', [
      service({ ...serviceA, service_packages: [] }),
      serviceB,
    ]);
    const unchangedReadback = reconcileProviderProfileSelection(selected, 'provider-a', [serviceA, serviceB]);

    expect(initial).toEqual({ providerId: 'provider-a', serviceId: 'service-a', packageId: null });
    expect(changedService).toEqual({ providerId: 'provider-a', serviceId: 'service-b', packageId: null });
    expect(changedProvider).toEqual({ providerId: 'provider-b', serviceId: 'service-c', packageId: null });
    expect(changedReadback).toEqual({ providerId: 'provider-a', serviceId: 'service-a', packageId: null });
    expect(unchangedReadback).toEqual({ providerId: 'provider-a', serviceId: 'service-a', packageId: 'package-a' });
    expect(providerProfilePackageRoute({
      providerId: 'provider-a',
      providerName: 'Provider A',
      service: serviceA,
      packageId: 'package-a',
      canCommit: false,
    })).toBeNull();
  });
});
