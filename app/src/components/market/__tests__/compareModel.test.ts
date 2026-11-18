import { getLowestQuoteId, sortByPrice } from '../compareModel';

function row(id: string, pricePaise: number) {
  return { id, who: id, pricePaise };
}

describe('quote comparison model', () => {
  it('sorts by price while preserving the original order of ties', () => {
    const rows = [row('first-minimum', 1200), row('higher', 2400), row('second-minimum', 1200)];

    const actual = sortByPrice(rows).map(({ id }) => id);

    expect(actual).toEqual(['first-minimum', 'second-minimum', 'higher']);
  });

  it('assigns the lowest-price badge only to the first eligible row at the minimum', () => {
    const rows = [row('first-minimum', 1200), row('incomplete', 500), row('second-minimum', 1200)];

    const actual = getLowestQuoteId(sortByPrice(rows), (id) => id === 'incomplete');

    expect(actual).toBe('first-minimum');
  });

  it('returns no lowest row when every quote is excluded', () => {
    const actual = getLowestQuoteId([row('incomplete', 500)], () => true);

    expect(actual).toBeNull();
  });
});
