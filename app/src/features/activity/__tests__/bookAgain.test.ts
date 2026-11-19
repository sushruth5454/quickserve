import { bookAgainRoute, canBookAgain, shouldShowBookAgain } from '../bookAgain';

const completedBooking = {
  status: 'completed' as const,
  provider_service_id: 'service-1',
  provider_id: 'provider-1',
  recurring_schedule_id: null,
  location_mode: 'at_customer' as const,
  proposal_id: null,
};

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

  it('routes to the provider when the booked service is inactive', () => {
    expect(bookAgainRoute({
      ...completedBooking,
      archetype: 'fixed',
    }, false)).toEqual({
      pathname: '/provider/[id]',
      params: { id: 'provider-1' },
    });
  });
});

describe('canBookAgain', () => {
  it.each(['fixed', 'inspect_quote', 'time_based'] as const)(
    'allows completed one-time %s bookings',
    (archetype) => {
      expect(canBookAgain({ ...completedBooking, archetype })).toBe(true);
    },
  );

  it('keeps the legacy missing-archetype booking eligible', () => {
    expect(canBookAgain(completedBooking)).toBe(true);
  });

  it.each(['requested', 'in_progress', 'cancelled', 'closed', 'closed_no_work'] as const)(
    'rejects %s bookings',
    (status) => {
      expect(canBookAgain({ ...completedBooking, status })).toBe(false);
    },
  );

  it('rejects recurring bookings', () => {
    expect(canBookAgain({
      ...completedBooking,
      archetype: 'fixed',
      recurring_schedule_id: 'recurring-schedule-1',
    })).toBe(false);
  });

  it.each([
    { archetype: 'proposal' as const },
    { archetype: 'remote' as const },
    { location_mode: 'remote' as const },
    { proposal_id: 'proposal-1' },
  ])('rejects proposal or remote bookings: %o', (bookingFields) => {
    expect(canBookAgain({ ...completedBooking, ...bookingFields })).toBe(false);
  });
});

describe('book again feature flag', () => {
  it('hides an eligible booking when the flag is off', () => {
    expect(shouldShowBookAgain({ ...completedBooking, archetype: 'fixed' }, false)).toBe(false);
  });

  it('shows an eligible booking when the flag is on', () => {
    expect(shouldShowBookAgain({ ...completedBooking, archetype: 'fixed' }, true)).toBe(true);
  });

  it('still hides an ineligible booking when the flag is on', () => {
    expect(shouldShowBookAgain({ ...completedBooking, status: 'closed', archetype: 'fixed' }, true)).toBe(false);
  });
});
