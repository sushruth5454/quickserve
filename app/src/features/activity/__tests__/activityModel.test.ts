import {
  bookAgainTarget,
  fmtDate,
  parseActivityPlans,
  parseActivityUnreadCounts,
  planFrequencyLabel,
  slotLabel,
  totalVisibleActivityUnread,
  visibleActivitySegments,
  visibleActivityUnreadCounts,
} from '../model';

const counts = { services: 5, requests: 3, shop: 7, sports: 11 };

describe('customer activity model', () => {
  it('keeps only valid activity plans and valid occurrences', () => {
    const actual = parseActivityPlans([
      null,
      {
        plan: {
          id: 'plan-1',
          status: 'active',
          provider_acceptance: 'accepted',
          frequency: 'weekly',
          weekdays: [1, 3],
        },
        occurrences: [
          { id: 'visit-1', scheduled_at: '2026-12-01T10:00:00Z', status: 'scheduled' },
          { id: 2, scheduled_at: '2026-12-02T10:00:00Z', status: 'scheduled' },
        ],
      },
      {
        plan: { id: 'plan-2', status: 'unknown', provider_acceptance: 'pending' },
        occurrences: [],
      },
    ]);

    expect(JSON.stringify(actual)).toBe(JSON.stringify([{
      plan: {
        id: 'plan-1',
        status: 'active',
        provider_acceptance: 'accepted',
        frequency: 'weekly',
        weekdays: [1, 3],
      },
      occurrences: [{ id: 'visit-1', scheduled_at: '2026-12-01T10:00:00Z', status: 'scheduled' }],
    }]));
  });

  it('formats repeat plan frequencies and weekly weekdays', () => {
    expect(planFrequencyLabel({
      id: 'plan-1',
      status: 'active',
      provider_acceptance: 'accepted',
      frequency: 'weekly',
      weekdays: [1, 3, 5],
    })).toBe('Weekly · Mon, Wed, Fri');
    expect(planFrequencyLabel({
      id: 'plan-2',
      status: 'active',
      provider_acceptance: 'accepted',
      frequency: 'daily',
    })).toBe('Every day');
  });

  it('formats activity dates and sports slots in their existing locales', () => {
    expect(fmtDate('2026-11-19T12:00:00Z')).toContain('Nov');
    expect(slotLabel('2026-11-19T18:30:00Z')).toContain('20');
    expect(slotLabel('2026-11-19T18:30:00Z')).toContain('Nov');
  });

  it('routes book again for non-inspect archetypes to their category', () => {
    const actual = bookAgainTarget({
      archetype: 'proposal',
      provider_service_id: 'service-1',
      categories: { slug: 'photography', name: 'Photography' },
    });
    expect(JSON.stringify(actual)).toBe(JSON.stringify({
      pathname: '/category/[slug]',
      params: { slug: 'photography', name: 'Photography' },
    }));
  });

  it('accepts only complete, non-negative integer unread counts from the server', () => {
    expect(parseActivityUnreadCounts([{ services: 2, requests: 1, shop: 3, sports: 0 }])).toEqual({
      services: 2,
      requests: 1,
      shop: 3,
      sports: 0,
    });
    expect(() => parseActivityUnreadCounts(null)).toThrow('The server returned invalid activity unread counts.');
    expect(() => parseActivityUnreadCounts({ services: -1, requests: 0, shop: 0, sports: 0 })).toThrow(
      'The server returned invalid activity unread counts.',
    );
    expect(() => parseActivityUnreadCounts({ services: 0, requests: 0, shop: '0', sports: 0 })).toThrow(
      'The server returned invalid activity unread counts.',
    );
  });

  it('always shows Services and Requests and gates Shop and Sports independently', () => {
    expect(visibleActivitySegments({ products: false, sports: false })).toEqual(['services', 'requests']);
    expect(visibleActivitySegments({ products: true, sports: false })).toEqual(['services', 'requests', 'shop']);
    expect(visibleActivitySegments({ products: false, sports: true })).toEqual(['services', 'requests', 'sports']);
  });

  it('keeps Sports visible when the feature is off but the customer has existing bookings', () => {
    expect(visibleActivitySegments({
      products: false,
      sports: false,
      hasSportsBookings: true,
    })).toEqual(['services', 'requests', 'sports']);
  });

  it('totals only unread counts from visible segments', () => {
    expect(totalVisibleActivityUnread(counts, { products: false, sports: false })).toBe(8);
    expect(totalVisibleActivityUnread(counts, { products: true, sports: false })).toBe(15);
    expect(visibleActivityUnreadCounts(counts, {
      products: false,
      sports: false,
      hasSportsBookings: true,
    })).toEqual({ services: 5, requests: 3, shop: 0, sports: 11 });
    expect(visibleActivityUnreadCounts(counts, { products: false, sports: true })).toEqual({
      services: 5,
      requests: 3,
      shop: 0,
      sports: 11,
    });
  });
});
