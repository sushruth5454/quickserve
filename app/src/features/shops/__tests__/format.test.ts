import { formatIndicativePrice, UNIT_LABELS } from '../format';

describe('indicative product prices', () => {
  it('uses a clear ask-the-shop message when no price is listed', () => {
    const actual = formatIndicativePrice(null, 'piece');
    expect(JSON.stringify(actual)).toBe(JSON.stringify('Ask shop for price'));
  });

  it('includes the sale unit beside the formatted price', () => {
    const actual = formatIndicativePrice(45000, 'sqft');
    expect(JSON.stringify(actual)).toBe(JSON.stringify('₹450 / sq ft'));
  });

  it('labels every supported product unit', () => {
    const actual = UNIT_LABELS;
    expect(JSON.stringify(actual)).toBe(JSON.stringify({
      piece: 'piece',
      sqft: 'sq ft',
      box: 'box',
      kg: 'kg',
      litre: 'litre',
      bag: 'bag',
      metre: 'metre',
      set: 'set',
    }));
  });
});
