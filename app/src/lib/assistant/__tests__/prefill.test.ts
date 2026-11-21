import { readBookPrefill, resolveServiceBookingEntry } from '../prefill';
import type { DayOption } from '../../schedule';

const service = (archetype: string) => ({
  id: 'service-1',
  provider_id: 'provider-1',
  category_id: 'category-1',
  categories: { name: 'Service', slug: 'service', archetype },
});

describe('assistant booking handoff', () => {
  it('nonInspectDestination resolves package and proposal families to their real bodies', () => {
    expect(resolveServiceBookingEntry(service('time_based'), {
      from: 'assistant',
      description: 'Keep the studio brief',
      slot: '2027-01-15@10',
      addressId: 'address-1',
    })).toMatchObject({
      kind: 'time-package',
      pathname: '/book/[providerServiceId]',
      params: {
        providerServiceId: 'service-1',
        archetype: 'time_based',
        description: 'Keep the studio brief',
        slot: '2027-01-15@10',
        addressId: 'address-1',
      },
    });

    expect(resolveServiceBookingEntry(service('proposal'), {
      from: 'assistant',
      description: 'Keep the proposal brief',
      slot: '2027-01-15@10',
      addressId: 'address-1',
    })).toMatchObject({
      kind: 'proposal-request',
      pathname: '/request/new',
      params: {
        categoryId: 'category-1',
        providerId: 'provider-1',
        description: 'Keep the proposal brief',
        slot: '2027-01-15@10',
        addressId: 'address-1',
      },
    });
  });

  it('stale assistant slots require reselection instead of defaulting to a new slot', () => {
    const days: DayOption[] = [{
      date: new Date('2027-01-15T00:00:00+05:30'),
      key: '2027-01-15',
      label: 'Fri',
      dayOfMonth: '15',
    }];

    expect(readBookPrefill(
      { from: 'assistant', description: 'Repair the tap', slot: '2026-11-20@10' },
      days,
      new Date('2026-11-21T00:00:00.000Z'),
    )).toMatchObject({ mode: 'schedule', dayIndex: null, hour: null, slotInvalid: true });
  });
});
