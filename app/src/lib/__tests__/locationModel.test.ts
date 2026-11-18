import { DEFAULT_LOCATION, areaFromLine, fromSavedAddress, geocodeQuery, needsLocationPrompt, parseStoredLocation, sameLocation, sortAddresses } from '../locationModel';
import { bookingRef, firstAvailableDay, nextDays, relativeTimeLabel, scheduleLabel, urgentStartOptions, windowAvailable, windowLabel, windowStart } from '../schedule';
import type { SavedAddress } from '../types';

describe('geocodeQuery', () => {
  it('searches what was typed in India, never the test city label', () => {
    expect(geocodeQuery('Sangareddy')).toBe('Sangareddy, India');
    expect(geocodeQuery('Benz Circle', 'Vijayawada Demo')).toBe('Benz Circle, Vijayawada, India');
    expect(geocodeQuery('Pothireddypally, Sangareddy', 'Sangareddy')).toBe('Pothireddypally, Sangareddy, India');
    expect(geocodeQuery('MG Road, India')).toBe('MG Road, India');
  });
});

const addr = (over: Partial<SavedAddress>): SavedAddress => ({
  id: 'a1',
  label: 'Home',
  line1: 'Flat 302, Sri Sai Residency, Benz Circle',
  city: 'Vijayawada',
  lat: 16.5,
  lng: 80.651,
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('parseStoredLocation', () => {
  it('round-trips a valid selection', () => {
    const l = fromSavedAddress(addr({}));
    expect(parseStoredLocation(JSON.stringify(l))).toEqual(l);
  });

  it.each([
    null,
    '',
    'not json',
    '42',
    JSON.stringify({ ...DEFAULT_LOCATION, lat: 120 }),
    JSON.stringify({ ...DEFAULT_LOCATION, source: 'teleport' }),
    JSON.stringify({ ...DEFAULT_LOCATION, area: '  ' }),
  ])('rejects malformed input %p', (raw) => {
    expect(parseStoredLocation(raw)).toBeNull();
  });
});

describe('saved addresses', () => {
  it('derives the neighbourhood from the address line, skipping the city', () => {
    expect(areaFromLine('4th Floor, iHub Towers, MG Road, Labbipet, Vijayawada', 'Vijayawada')).toBe('Labbipet');
    expect(areaFromLine('Vijayawada', 'Vijayawada')).toBe('Vijayawada');
  });

  it('puts the default address first, then oldest first', () => {
    const list = sortAddresses([
      addr({ id: 'new', created_at: '2026-03-01T00:00:00Z' }),
      addr({ id: 'old', created_at: '2026-02-01T00:00:00Z' }),
      addr({ id: 'def', is_default: true, created_at: '2026-04-01T00:00:00Z' }),
    ]);
    expect(list.map((a) => a.id)).toEqual(['def', 'old', 'new']);
  });

  it('matches saved selections by address id only', () => {
    const a = fromSavedAddress(addr({ id: 'x' }));
    expect(sameLocation(a, fromSavedAddress(addr({ id: 'x', lat: 1 })))).toBe(true);
    expect(sameLocation(a, { ...a, addressId: null, source: 'area' })).toBe(false);
  });
});

describe('location prompt', () => {
  it('asks the customer to set a location only while the default is active', () => {
    expect(needsLocationPrompt(DEFAULT_LOCATION)).toBe(true);
    expect(needsLocationPrompt({ ...DEFAULT_LOCATION, source: 'gps' })).toBe(false);
    expect(needsLocationPrompt({ ...DEFAULT_LOCATION, source: 'saved' })).toBe(false);
  });
});

describe('schedule', () => {
  const now = new Date('2026-11-14T15:30:00+05:30'); // Sat 14 Nov, 3:30 pm IST

  it('labels the next 7 days', () => {
    const days = nextDays(now);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.label).slice(0, 3)).toEqual(['Today', 'Tomorrow', 'Mon']);
  });

  it('uses India time whatever the device timezone is', () => {
    // 11 pm on Fri 13 Nov in California is already 12:30 pm on Sat 14 Nov in India.
    const fromCalifornia = new Date('2026-11-13T23:00:00-08:00');
    const days = nextDays(fromCalifornia);
    expect(days[0]!.key).toBe('2026-11-14');
    expect(windowStart(days[0]!.date, 18).toISOString()).toBe('2026-11-14T12:30:00.000Z');
    expect(scheduleLabel('2026-11-14T12:30:00.000Z')).toBe('Sat, 14 Nov · 6–8 pm');
    expect(scheduleLabel('2026-11-14T05:00:00.000Z')).toBe('Sat, 14 Nov · 10:30 am');
  });

  it('needs an hour of lead time before a window starts', () => {
    expect(windowAvailable(now, 16, now)).toBe(false); // starts in 30 min
    expect(windowAvailable(now, 18, now)).toBe(true);
  });

  it('skips today when no window is left', () => {
    const late = new Date('2026-11-14T19:30:00+05:30');
    expect(firstAvailableDay(nextDays(late), late)).toBe(1);
  });

  it('formats windows and booking references', () => {
    expect(windowLabel(8)).toBe('8–10 am');
    expect(windowLabel(10)).toBe('10 am–12 pm');
    expect(windowLabel(18)).toBe('6–8 pm');
    expect(bookingRef('fc000006-5eed-5eed-8000-000000000000')).toBe('QS-FC000006');
    expect(bookingRef('QS1042')).toBe('QS-1042');
  });
});

describe('urgent start options', () => {
  it('offers India-time hours at least 2 hours away, 7 am to 9 pm, within a day', () => {
    const now = new Date('2026-11-16T13:10:00+05:30');
    const opts = urgentStartOptions(now, 20);
    expect(relativeTimeLabel(opts[0]!, now)).toBe('Today 4 pm');
    expect(opts.map((d) => relativeTimeLabel(d, now))).toContain('Tomorrow 7 am');
    expect(opts.map((d) => relativeTimeLabel(d, now))).not.toContain('Today 10 pm');
    expect(opts.every((d) => d.getTime() - now.getTime() >= 2 * 3_600_000 && d.getTime() - now.getTime() < 86_400_000)).toBe(true);
  });
});
