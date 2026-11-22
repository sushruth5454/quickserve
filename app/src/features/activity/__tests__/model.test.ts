import { visibleActivitySegments, visibleActivityUnreadCounts } from '../model';

describe('MK-OFF-read-history-keeps-shop-segment', () => {
  it('keeps authorized shop history visible after the product capability is turned off', () => {
    const features = { products: false, sports: false, hasShopHistory: true };
    const segments = visibleActivitySegments(features);
    const unread = visibleActivityUnreadCounts(
      { services: 0, requests: 0, shop: 3, sports: 0 },
      features,
    );

    expect(JSON.stringify(segments)).toBe(JSON.stringify(['services', 'requests', 'shop']));
    expect(JSON.stringify(unread)).toBe(JSON.stringify({ services: 0, requests: 0, shop: 3, sports: 0 }));
  });
});
