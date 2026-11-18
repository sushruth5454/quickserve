import { bookAgainRoute } from '../bookAgain';

function expectRoute(booking: Parameters<typeof bookAgainRoute>[0], expected: ReturnType<typeof bookAgainRoute>) {
  expect(JSON.stringify(bookAgainRoute(booking))).toBe(JSON.stringify(expected));
}

describe('book again route', () => {
  it('keeps bookings without an archetype on the legacy inspect-quote screen', () => {
    expectRoute({
      provider_service_id: 'service-0',
    }, {
      pathname: '/book/[providerServiceId]',
      params: { providerServiceId: 'service-0' },
    });
  });

  it('keeps inspect-quote bookings on the current booking screen', () => {
    expectRoute({
      archetype: 'inspect_quote',
      provider_service_id: 'service-1',
    }, {
      pathname: '/book/[providerServiceId]',
      params: { providerServiceId: 'service-1' },
    });
  });

  it('routes fixed bookings to fixed package checkout', () => {
    expectRoute({
      archetype: 'fixed',
      provider_service_id: 'service-2',
    }, {
      pathname: '/book-fixed/[providerServiceId]',
      params: { providerServiceId: 'service-2' },
    });
  });

  it('restores a time-based booking package selection', () => {
    expectRoute({
      archetype: 'time_based',
      provider_service_id: 'service-3',
      service_package_id: 'package-3',
    }, {
      pathname: '/book/[providerServiceId]',
      params: { providerServiceId: 'service-3', packageId: 'package-3', archetype: 'time_based' },
    });
  });

  it('routes a time-based booking without a package to its category', () => {
    expectRoute({
      archetype: 'time_based',
      provider_service_id: 'service-4',
      categories: { slug: 'home-tutor', name: 'Home Tutor' },
    }, {
      pathname: '/category/[slug]',
      params: { slug: 'home-tutor', name: 'Home Tutor' },
    });
  });
});
