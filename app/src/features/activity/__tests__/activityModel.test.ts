import { bookAgainTarget, parseActivityUnreadCounts, totalVisibleActivityUnread, visibleActivitySegments, visibleActivityUnreadCounts } from '../model';

const counts = { services: 5, requests: 3, shop: 7, sports: 11 };

describe('customer activity model', () => {
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

  it('totals only unread counts from visible segments', () => {
    expect(totalVisibleActivityUnread(counts, { products: false, sports: false })).toBe(8);
    expect(totalVisibleActivityUnread(counts, { products: true, sports: false })).toBe(15);
    expect(visibleActivityUnreadCounts(counts, { products: false, sports: true })).toEqual({
      services: 5,
      requests: 3,
      shop: 0,
      sports: 11,
    });
  });
});
