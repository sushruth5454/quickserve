import { listingA11yLabel, visibleTags } from '../listingModel';

describe('listing model', () => {
  it('joins the available listing details in accessible reading order', () => {
    const label = listingA11yLabel({
      title: 'Quick Fix',
      subtitle: 'Kondapur, Hyderabad',
      rating: 4.5,
      ratingCount: 12,
      verified: true,
      priceLabel: 'From ₹500',
    });

    expect(label).toBe('Quick Fix, Kondapur, Hyderabad, Rated 4.5 out of 5 from 12 reviews, verified, From ₹500');
  });

  it('omits unavailable optional listing details', () => {
    const label = listingA11yLabel({
      title: 'Quick Fix',
      rating: null,
      verified: false,
      priceLabel: null,
    });

    expect(label).toBe('Quick Fix');
  });

  it('shows no more than the first two tags', () => {
    expect(visibleTags(['Same day', 'Top rated', 'Budget friendly'])).toEqual(['Same day', 'Top rated']);
  });
});
