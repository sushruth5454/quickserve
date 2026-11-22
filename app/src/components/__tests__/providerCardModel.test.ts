import type { TopRatedService } from '../../lib/apiTypes';
import { providerCardModel, topRatedHeaderModel } from '../providerCardModel';

const service = (
  id: string,
  archetype: NonNullable<NonNullable<TopRatedService['categories']>['archetype']>,
  sortOrder: number,
  visitFee: number,
  servicePackages: TopRatedService['service_packages'] = [],
): TopRatedService => ({
  id,
  visit_fee: visitFee,
  skill_level: 'skilled',
  active: true,
  categories: { name: id, slug: id, archetype, sort_order: sortOrder },
  service_packages: servicePackages,
});

describe('provider card model', () => {
  it('keeps proposal cards quote-per-brief instead of treating visit fees as package prices', () => {
    const model = providerCardModel({
      services: [
        service('inspect', 'inspect_quote', 2, 0, [
          { id: 'inspect-package', sort_order: 0, price_type: 'fixed', price: 25000, price_min: 25000, price_max: 25000, unit: 'job' },
        ]),
        service('proposal', 'proposal', 1, 0, [
          { id: 'proposal-package', sort_order: 0, price_type: 'quote', price: null, price_min: null, price_max: null, unit: 'event' },
        ]),
      ],
      isOnline: true,
    });

    expect(model.lead?.id).toBe('proposal');
    expect(model.priceLabel).toBe('Quote per brief');
    expect(model.priceLabel).not.toContain('₹0');
    expect(model.ctaLabel).toBe('Request proposal');
  });

  it('uses the visit fee for inspect and the first ordered package for fixed/time services', () => {
    const inspect = providerCardModel({
      services: [service('inspection', 'inspect_quote', 1, 50000, [
        { id: 'unrelated-package', sort_order: 0, price_type: 'fixed', price: 10000, price_min: 10000, price_max: 10000, unit: 'hour' },
      ])],
      isOnline: false,
    });
    const fixed = providerCardModel({
      services: [service('fixed', 'fixed', 1, 500, [
        { id: 'z-hourly', sort_order: 2, price_type: 'range', price: null, price_min: 30000, price_max: 50000, unit: 'hour' },
        { id: 'a-job', sort_order: 1, price_type: 'fixed', price: 90000, price_min: 90000, price_max: 90000, unit: 'job' },
      ])],
      isOnline: true,
    });

    expect(inspect.priceLabel).toBe('Visit fee ₹500');
    expect(fixed.priceLabel).toBe('Fixed ₹900 per job');
  });

  it('orders service and package headlines deterministically without comparing unlike units', () => {
    const model = providerCardModel({
      services: [
        service('b-hour', 'time_based', 4, 1, [
          { id: 'z-hour', sort_order: 0, price_type: 'fixed', price: 5000, price_min: 5000, price_max: 5000, unit: 'hour' },
          { id: 'a-hour', sort_order: 0, price_type: 'from', price: null, price_min: 9000, price_max: null, unit: 'hour' },
        ]),
        service('a-fixed', 'fixed', 4, 1, [
          { id: 'job', sort_order: 0, price_type: 'fixed', price: 99000, price_min: 99000, price_max: 99000, unit: 'job' },
        ]),
      ],
      isOnline: true,
    });
    const ranged = providerCardModel({
      services: [service('time', 'time_based', 1, 0, [
        { id: 'range', sort_order: 0, price_type: 'range', price: null, price_min: 30000, price_max: 50000, unit: 'hour' },
      ])],
      isOnline: true,
    });
    const from = providerCardModel({
      services: [service('remote', 'remote', 1, 0, [
        { id: 'from', sort_order: 0, price_type: 'from', price: null, price_min: 45000, price_max: null, unit: 'event' },
      ])],
      isOnline: true,
    });

    expect(model.lead?.id).toBe('a-fixed');
    expect(model.priceLabel).toBe('Fixed ₹990 per job');
    expect(ranged.priceLabel).toBe('Range ₹300–₹500 per hour');
    expect(from.priceLabel).toBe('From ₹450 per event');
  });

  it('shows no packages and a profile action instead of implying a free offer', () => {
    const model = providerCardModel({
      services: [service('fixed', 'fixed', 1, 0)],
      isOnline: true,
    });

    expect(model.priceLabel).toBe('No packages listed');
    expect(model.ctaLabel).toBe('View profile');
  });

  it('suppresses Online during current leave without changing trust metrics', () => {
    const model = providerCardModel({
      services: [service('inspection', 'inspect_quote', 1, 10000)],
      isOnline: true,
      onLeaveUntil: '2026-11-22T00:00:00.000Z',
    });

    expect(model.isOnline).toBe(false);
    expect(model.ctaLabel).toBe('Schedule');
  });

  it('labels the selected city and rating order without claiming distance ranking', () => {
    expect(topRatedHeaderModel('Mysuru', 3)).toEqual({
      title: 'Top rated in Mysuru',
      subtitle: '3 verified pros · ranked by average rating, then review count',
    });
  });
});
