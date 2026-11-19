import { PILLAR_ORDER, pillarAccent, visiblePillars } from '../pillars';

describe('marketplace pillars', () => {
  it('returns all pillars in the documented order when all are visible', () => {
    expect(visiblePillars({
      hasHome: true,
      hasCreators: true,
      productsOn: true,
      sportsOn: true,
    })).toEqual(['home', 'shops', 'sports', 'creators']);
    expect(PILLAR_ORDER).toEqual(['home', 'shops', 'sports', 'creators']);
  });

  it('omits Shops when the products feature is off', () => {
    expect(visiblePillars({
      hasHome: true,
      hasCreators: true,
      productsOn: false,
      sportsOn: true,
    })).toEqual(['home', 'sports', 'creators']);
  });

  it('returns no pillars when no content exists and product and sports features are off', () => {
    expect(visiblePillars({
      hasHome: false,
      hasCreators: false,
      productsOn: false,
      sportsOn: false,
    })).toEqual([]);
  });

  it('maps every pillar to its foreground and soft accent tokens', () => {
    const colors = {
      catHome: 'home-foreground',
      catHomeSoft: 'home-soft',
      catShops: 'shops-foreground',
      catShopsSoft: 'shops-soft',
      catSports: 'sports-foreground',
      catSportsSoft: 'sports-soft',
      catCreators: 'creators-foreground',
      catCreatorsSoft: 'creators-soft',
    } as unknown as Parameters<typeof pillarAccent>[1];

    expect([
      pillarAccent('home', colors),
      pillarAccent('shops', colors),
      pillarAccent('sports', colors),
      pillarAccent('creators', colors),
    ]).toEqual([
      { fg: 'home-foreground', soft: 'home-soft' },
      { fg: 'shops-foreground', soft: 'shops-soft' },
      { fg: 'sports-foreground', soft: 'sports-soft' },
      { fg: 'creators-foreground', soft: 'creators-soft' },
    ]);
  });
});
