import { parseAssistantReply, parseSlot } from '../assistant/parse';
import { composeDescription, draftToBookParams, readBookPrefill, slotParam } from '../assistant/prefill';
import { monthsBetween, starterPrompts } from '../assistant/suggestions';
import type { DraftCard } from '../assistant/types';
import { nextDays } from '../schedule';
import type { Booking } from '../types';

const draft = (over: Partial<DraftCard> = {}): DraftCard => ({
  type: 'draft',
  category_slug: 'ac-repair',
  category_name: 'AC Repair',
  provider: { provider_id: 'p1', provider_service_id: 'ps1', name: 'Ravi Kumar', visit_fee: 19900, rating_avg: 4.8, rating_count: 12 },
  description_en: 'Split AC not cooling and making a rattling noise',
  description_original: 'AC not cooling, making noise, need tomorrow evening',
  problem_chips: ['Not cooling', 'Making noise'],
  slot: { type: 'window', date: '2026-11-15', start_hour: 18, starts_at: '2026-11-15T12:30:00.000Z', label: 'Sun, 15 Nov · 6–8 pm' },
  address: { address_id: 'addr-home', label: 'Home', area: 'Benz Circle', city: 'Vijayawada', needs_full_address: false },
  ...over,
});

describe('parseAssistantReply', () => {
  it('keeps valid cards, drops malformed ones and puts safety first', () => {
    const r = parseAssistantReply({
      conversation_id: 'c1',
      reply_text: 'Here you go',
      language: 'te',
      quick_replies: ['Change time', 42, 'Other pros', 'a', 'b'],
      cards: [
        draft(),
        { type: 'providers', category_slug: 'ac-repair', providers: [{ provider_id: 'p1' }] }, // no service id / fee
        { type: 'estimate', category_slug: 'ac-repair', category_name: 'AC Repair', visit_fee: { min: 9900, median: 19900, max: 24900, count: 5 }, typical_total: null, note: 'n' },
        { type: 'safety', title: 'Sparks', steps: ['Switch off the MCB'], emergency: [{ label: 'Emergency', number: '112' }, { label: 'Fake', number: 'call me' }] },
        { type: 'invented', foo: 1 },
      ],
    });
    expect(r.cards.map((c) => c.type)).toEqual(['safety', 'estimate', 'draft']);
    expect(r.language).toBe('te');
    expect(r.quick_replies).toEqual(['Change time', 'Other pros', 'a', 'b']);
    const safety = r.cards[0];
    expect(safety?.type === 'safety' && safety.emergency).toEqual([{ label: 'Emergency', number: '112' }]);
  });

  it('degrades to a plain message for garbage input', () => {
    const r = parseAssistantReply('oops');
    expect(r.cards).toEqual([]);
    expect(r.reply_text).toMatch(/something went wrong/i);
    expect(r.language).toBe('en');
  });

  it('rejects a draft whose slot is not a Book screen window', () => {
    const bad = { ...draft(), slot: { type: 'window', date: '2026-11-15', start_hour: 19, label: 'x' } };
    expect(parseAssistantReply({ reply_text: 'x', cards: [bad] }).cards).toEqual([]);
    expect(parseSlot({ type: 'asap' })).toEqual({ type: 'asap', label: 'As soon as possible' });
    expect(parseSlot({ type: 'window', date: '15-11-2026', start_hour: 18 })).toBeNull();
  });
});

describe('draft → Book screen prefill', () => {
  it('maps chips, description, slot and address to route params', () => {
    const p = draftToBookParams(draft());
    expect(p).toEqual({
      providerServiceId: 'ps1',
      from: 'assistant',
      description:
        'Not cooling, Making noise, Split AC not cooling and making a rattling noise\nCustomer\'s words: "AC not cooling, making noise, need tomorrow evening"',
      slot: '2026-11-15@18',
      addressId: 'addr-home',
    });
    expect(slotParam({ type: 'asap', label: 'ASAP' })).toBe('asap');
    expect(draftToBookParams(draft({ address: { address_id: null, label: null, area: 'Patamata', city: 'Vijayawada', needs_full_address: true } })).addressId).toBeUndefined();
  });

  it('skips the original text when it equals the English one and caps the length', () => {
    expect(composeDescription({ problem_chips: [], description_en: 'Tap leaking', description_original: 'tap leaking' })).toBe('Tap leaking');
    const long = composeDescription({ problem_chips: ['Tap leaking'], description_en: 'Kitchen tap is leaking', description_original: 'नल '.repeat(300) });
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.endsWith('…"')).toBe(true);
  });

  it('reads params back into the Book screen state (day + window)', () => {
    const now = new Date(2026, 10, 14, 9, 30); // Sat 14 Nov, 09:30 local
    const days = nextDays(now, 7);
    const p = readBookPrefill({ from: 'assistant', description: 'Not cooling, Noise', slot: '2026-11-15@18', addressId: 'a1' }, days, now);
    expect(p).toEqual({ fromAssistant: true, description: 'Not cooling, Noise', mode: 'schedule', dayIndex: 1, hour: 18, addressId: 'a1' });
  });

  it('keeps the day but drops a window that is no longer bookable; ignores bad slots', () => {
    const now = new Date(2026, 10, 14, 17, 30); // 17:30: today's 6–8 pm starts in 30 min (< 60 min lead)
    const days = nextDays(now, 7);
    expect(readBookPrefill({ slot: '2026-11-14@18' }, days, now)).toMatchObject({ mode: 'schedule', dayIndex: 0, hour: null });
    expect(readBookPrefill({ slot: 'asap' }, days, now)).toMatchObject({ mode: 'asap', dayIndex: null });
    expect(readBookPrefill({ slot: '2026-12-30@10' }, days, now)).toMatchObject({ mode: null, dayIndex: null });
    expect(readBookPrefill({ slot: '2026-11-15@19' }, days, now)).toMatchObject({ mode: 'schedule', dayIndex: 1, hour: null });
    expect(readBookPrefill({}, days, now)).toEqual({ fromAssistant: false, description: null, mode: null, dayIndex: null, hour: null, addressId: null });
  });
});

describe('starterPrompts', () => {
  const booking = (over: Partial<Booking>): Booking =>
    ({
      id: 'b',
      customer_id: 'me',
      provider_id: 'p1',
      category_id: 'c',
      provider_service_id: 'ps',
      status: 'closed',
      created_at: '2026-04-02T10:00:00Z',
      completed_at: '2026-04-02T12:00:00Z',
      categories: { name: 'AC Repair', slug: 'ac-repair' },
      providers: { rating_avg: 4.8, rating_count: 10, profiles: { full_name: 'Ravi Kumar' } },
      ...over,
    }) as Booking;

  it('suggests a due service and rebooking a past pro, then fills with defaults', () => {
    const now = new Date(2026, 10, 14);
    const list = starterPrompts([booking({})], now);
    expect(list[0]?.label).toBe('Your AC was serviced 7 months ago. Book a service?');
    expect(list[1]?.label).toBe('Book Ravi again (AC Repair)');
    expect(list).toHaveLength(4);
  });

  it('has only defaults without history and counts whole months', () => {
    expect(starterPrompts([], new Date()).every((p) => p.icon !== 'refresh')).toBe(true);
    expect(monthsBetween('2026-04-20T00:00:00Z', new Date(2026, 10, 14))).toBe(6);
  });
});
