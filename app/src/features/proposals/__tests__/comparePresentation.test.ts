import { proposalCompareRows } from '../comparePresentation';

describe('proposal comparison presentation', () => {
  it('maps proposal totals, providers, payment counts, validity and ratings', () => {
    const proposals = [{
      id: 'proposal-1',
      total: 125000,
      valid_until: '2027-01-15T12:00:00.000Z',
      proposal_schedule: [{}, {}],
      providers: { rating_avg: 4.8, rating_count: 12, profiles: { full_name: 'Asha Studio' } },
    }];

    expect(proposalCompareRows(proposals)).toEqual([{
      id: 'proposal-1',
      who: 'Asha Studio',
      pricePaise: 125000,
      detail1: '2 payments',
      detail2: new Date('2027-01-15T12:00:00.000Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }),
      rating: 4.8,
    }]);
  });

  it('uses the existing provider fallback when the profile is unavailable', () => {
    const proposals = [{
      id: 'proposal-2',
      total: 90000,
      valid_until: '2027-02-01T12:00:00.000Z',
      proposal_schedule: [],
      providers: null,
    }];

    expect(proposalCompareRows(proposals)[0]).toMatchObject({
      id: 'proposal-2',
      who: 'Verified provider',
      pricePaise: 90000,
      detail1: '0 payments',
      rating: null,
    });
  });
});
