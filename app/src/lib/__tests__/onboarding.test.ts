import {
  asapAvailable,
  copyDay,
  label12,
  localParts,
  PRESETS,
  rangeLabel,
  summarizeHours,
  todayLabel,
  validateSlots,
  windowFits,
} from '../onboarding/availability';
import { completeness, resumeStep, stepDone } from '../onboarding/completeness';
import type { Check, OnboardingState, ProviderSchedule, WeeklySlot } from '../onboarding/types';
import { checkUpload, parseRupees, validateBasics, validateFees, validatePayoutForm, validateProfileAttributes } from '../onboarding/validation';
import { WINDOW_START_HOURS } from '../schedule';
import {
  configuredExpertiseCount,
  expertiseGroups,
  packageHasContactHint,
  sameExpertise,
  selectedExpertiseCount,
  selectServiceCategory,
  serviceEditorStateFromService,
  serviceExpertiseLabels,
  toggleExpertise,
  validateServiceEditor,
  type ServiceEditorState,
} from '../../features/providerOnboarding/serviceEditor';

/** An instant given as IST wall-clock time, independent of the test machine's timezone. */
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);
// 16 Nov 2026 is a Monday.
const MON = '2026-11-16';
const monSat9to7 = PRESETS.find((p) => p.key === 'mon-sat-9-7')!.slots;
const schedule = (over: Partial<ProviderSchedule> = {}): ProviderSchedule => ({
  timezone: 'Asia/Kolkata',
  paused: false,
  max_jobs_per_day: null,
  slots: monSat9to7,
  time_off: [],
  full_days: [],
  ...over,
});

describe('availability → customer slots', () => {
  it('reads weekday/minutes in IST regardless of device timezone', () => {
    expect(localParts(ist(`${MON}T09:30:00`))).toEqual({ dow: 1, minutes: 570, dateKey: MON });
    expect(localParts(new Date('2026-11-15T20:00:00Z'))).toEqual({ dow: 1, minutes: 90, dateKey: MON });
  });

  it('offers only 2-hour windows fully inside working hours (same rule as create_booking)', () => {
    const ok = [8, 10, 12, 14, 16, 18].filter((h) => windowFits(schedule(), ist(`${MON}T${String(h).padStart(2, '0')}:00:00`)));
    expect(ok).toEqual([10, 12, 14, 16]);
    expect(WINDOW_START_HOURS).toContain(18);
    expect(windowFits(schedule(), ist('2026-11-22T10:00:00'))).toBe(false); // Sunday
  });

  it('respects lunch breaks, time off, fully booked days and pause', () => {
    const split = PRESETS.find((p) => p.key === 'split')!.slots;
    expect(windowFits(schedule({ slots: split }), ist(`${MON}T12:00:00`))).toBe(false);
    expect(windowFits(schedule({ slots: split }), ist(`${MON}T15:00:00`))).toBe(true);
    const leave = { from: ist(`${MON}T00:00:00`).toISOString(), to: ist('2026-11-17T00:00:00').toISOString() };
    expect(windowFits(schedule({ time_off: [leave] }), ist(`${MON}T10:00:00`))).toBe(false);
    expect(windowFits(schedule({ time_off: [leave] }), ist('2026-11-17T10:00:00'))).toBe(true);
    expect(windowFits(schedule({ full_days: [MON] }), ist(`${MON}T10:00:00`))).toBe(false);
    expect(windowFits(schedule({ paused: true }), ist(`${MON}T10:00:00`))).toBe(false);
  });

  it('treats providers without weekly hours as always available (legacy accounts) and null schedule as unknown', () => {
    expect(windowFits(schedule({ slots: [] }), ist(`${MON}T06:00:00`))).toBe(true);
    expect(windowFits(null, ist(`${MON}T06:00:00`))).toBe(true);
  });

  it('offers ASAP only inside working hours', () => {
    expect(asapAvailable(schedule(), ist(`${MON}T18:59:00`))).toBe(true);
    expect(asapAvailable(schedule(), ist(`${MON}T19:00:00`))).toBe(false);
    expect(asapAvailable(schedule(), ist('2026-11-22T11:00:00'))).toBe(false);
  });
});

describe('availability editor', () => {
  it('validates slots like set_provider_availability', () => {
    expect(validateSlots([])).toMatch(/at least one/);
    expect(validateSlots([{ weekday: 1, start: '09:00', end: '09:30' }])).toMatch(/at least 1 hour/);
    expect(validateSlots([{ weekday: 1, start: '10:00', end: '09:00' }])).toMatch(/after start/);
    expect(validateSlots([{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 1, start: '12:00', end: '18:00' }])).toMatch(/overlap/);
    expect(validateSlots([{ weekday: 1, start: '20:00', end: '24:00' }])).toBeNull();
    for (const p of PRESETS) expect(validateSlots(p.slots)).toBeNull();
  });

  it('copies one day to others', () => {
    const base: WeeklySlot[] = [{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 1, start: '14:00', end: '19:00' }, { weekday: 3, start: '10:00', end: '11:00' }];
    const out = copyDay(base, 1, [1, 2, 3]);
    expect(out.filter((s) => s.weekday === 3)).toEqual([{ weekday: 3, start: '09:00', end: '13:00' }, { weekday: 3, start: '14:00', end: '19:00' }]);
    expect(out.filter((s) => s.weekday === 2)).toHaveLength(2);
  });

  it('formats hours for profiles', () => {
    expect(label12(0)).toBe('12 am');
    expect(label12(570)).toBe('9:30 am');
    expect(rangeLabel('09:00', '11:00')).toBe('9–11 am');
    expect(rangeLabel('09:00', '19:00')).toBe('9 am–7 pm');
    expect(summarizeHours(monSat9to7)).toEqual(['Mon–Sat · 9 am–7 pm']);
    expect(summarizeHours([...monSat9to7.filter((s) => s.weekday !== 6), { weekday: 6, start: '10:00', end: '14:00' }])).toEqual([
      'Mon–Fri · 9 am–7 pm',
      'Sat · 10 am–2 pm',
    ]);
    expect(todayLabel(monSat9to7, ist(`${MON}T08:00:00`))).toBe('Available today 9 am–7 pm');
    expect(todayLabel(monSat9to7, ist('2026-11-22T08:00:00'))).toBe('Not working today');
    expect(todayLabel(monSat9to7, ist(`${MON}T08:00:00`), { onLeaveUntil: ist('2026-11-20T00:00:00').toISOString() })).toBe('On leave until 19 Nov');
    expect(todayLabel([], ist(`${MON}T08:00:00`))).toBeNull();
  });
});

describe('completeness', () => {
  const all = (ok: boolean): Check[] => [
    ...(['name', 'photo', 'bio', 'languages', 'services', 'area', 'hours'] as const).map((key): Check => ({ key, required: true, ok })),
    ...(['specialisations', 'portfolio', 'payout'] as const).map((key): Check => ({ key, required: false, ok })),
  ];

  it('scores 0..100 and lists required items first', () => {
    expect(completeness(all(true)).score).toBe(100);
    const c = completeness(all(false));
    expect(c.score).toBe(0);
    expect(c.requiredDone).toBe(false);
    expect(c.tips[0]!.required).toBe(true);
    expect(c.tips.at(-1)!.required).toBe(false);
    const onlyOptionalMissing = completeness(all(true).map((x) => (x.required ? x : { ...x, ok: false })));
    expect(onlyOptionalMissing.requiredDone).toBe(true);
    expect(onlyOptionalMissing.score).toBe(70);
    expect(onlyOptionalMissing.tips.map((t) => t.key)).toEqual(['specialisations', 'portfolio', 'payout']);
  });

  it('resumes at the first incomplete required step', () => {
    const state = (checks: Check[], step = 0, submitted: string | null = null) =>
      ({ provider: { onboarding_step: step, submitted_at: submitted }, checks, payout: null } as unknown as OnboardingState);
    expect(resumeStep({ provider: null } as unknown as OnboardingState)).toBe(0);
    const c = all(true).map((x) => (x.key === 'area' ? { ...x, ok: false } : x));
    expect(resumeStep(state(c, 3))).toBe(2);
    expect(resumeStep(state(all(true), 5))).toBe(5);
    expect(resumeStep(state(all(true), 7, '2026-11-14'))).toBe(6);
    expect(stepDone('portfolio', state(all(false)))).toBe(true);
    expect(stepDone('payouts', state(all(true)))).toBe(false);
  });
});

describe('validation', () => {
  it('basics: name, photo, bio length and no phone numbers', () => {
    expect(validateBasics({ fullName: 'Ravi', hasPhoto: true, bio: 'AC technician with 6 years of experience.', languages: ['Telugu'] })).toEqual({});
    const e = validateBasics({ fullName: 'R', hasPhoto: false, bio: 'Good work', languages: [] });
    expect(Object.keys(e).sort()).toEqual(['bio', 'fullName', 'languages', 'photo']);
    expect(validateBasics({ fullName: 'Ravi', hasPhoto: true, bio: 'Call me on 98765 43210 for any AC work anytime', languages: ['Telugu'] }).bio).toMatch(/phone numbers/);
  });

  it('fees in rupees → paise', () => {
    expect(parseRupees('₹1,299.50')).toBe(129950);
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('12.345')).toBeNull();
    expect(validateFees('199', '300')).toEqual({});
    expect(validateFees('', '0')).toEqual({ visitFee: expect.any(String), labourRate: expect.any(String) });
  });

  it('validates provider attributes against the category profile schema', () => {
    const schema = { type: 'object' as const, properties: { skin_types: { type: 'array' as const, maxItems: 3, items: { type: 'string' as const, enum: ['oily', 'dry'] } } } };
    expect(validateProfileAttributes(schema, { skin_types: ['oily'] })).toBeNull();
    expect(validateProfileAttributes(schema, { skin_types: ['sensitive'] })).toMatch(/unsupported/);
    expect(validateProfileAttributes(schema, { skin_types: ['oily'], phone: 'secret' })).toMatch(/not configured/);
  });

  it('payout form mirrors the Edge Function rules', () => {
    const good = { legal_name: 'Ravi Kumar', pan: 'abcpk1234f', email: 'ravi@example.com', account_number: '1234 5678 9012', confirm_account_number: '123456789012', ifsc: 'hdfc0001234' };
    expect(validatePayoutForm(good, 'payouts')).toEqual({});
    expect(validatePayoutForm(good, 'route')).toEqual({ address: expect.any(String) });
    expect(validatePayoutForm({ ...good, pan: 'ABCDE1234F' }, 'payouts').pan).toBeDefined();
    expect(validatePayoutForm({ ...good, confirm_account_number: '1' }, 'payouts').confirm_account_number).toBeDefined();
    expect(validatePayoutForm({ ...good, ifsc: 'HDFC1001234' }, 'payouts').ifsc).toBeDefined();
  });

  it('upload limits match the storage buckets', () => {
    expect(checkUpload('avatar', 'image/jpeg', 1_000_000)).toBeNull();
    expect(checkUpload('avatar', 'image/jpeg', 3_000_000)).toMatch(/max 2 MB/);
    expect(checkUpload('document', 'application/pdf', 9_000_000)).toBeNull();
    expect(checkUpload('portfolio', 'application/pdf', 1)).toMatch(/JPG, PNG or WebP/);
  });

  it('hydrates every editable service field without mutating the saved service', () => {
    const service = {
      id: 'service-1',
      provider_id: 'provider-1',
      category_id: 'ac-category',
      skill_level: 'expert',
      visit_fee: 19900,
      labour_rate: 34900,
      rate_unit: 'job',
      active: true,
      specialisations: ['split', 'pcb'],
      brands: ['Daikin'],
      tools: ['Vacuum pump'],
      attributes: { equipment: ['split'] },
      max_travel_km: 25,
      travel_fee_mode: 'flat',
      travel_fee_flat: 5000,
      travel_fee_per_km: 0,
    } as const;
    const state = serviceEditorStateFromService(service as never);
    expect(state).toMatchObject({
      serviceId: 'service-1',
      categoryId: 'ac-category',
      level: 'expert',
      visitFee: '199',
      labour: '349',
      specialisations: ['split', 'pcb'],
      brands: ['Daikin'],
      tools: ['Vacuum pump'],
      attributes: { equipment: ['split'] },
      maxTravel: '25',
      travelFeeMode: 'flat',
      travelFlat: '50',
    });
    state.attributes.equipment = ['window'];
    expect(service.attributes).toEqual({ equipment: ['split'] });
  });

  it('clears category-specific expertise when a new service category changes', () => {
    const state = {
      ...serviceEditorStateFromService(),
      categoryId: 'old',
      specialisations: ['old-skill'],
      brands: ['Old brand'],
      tools: ['Old tool'],
      attributes: { old_field: true },
      visitFee: '199',
      labour: '299',
    };
    expect(selectServiceCategory(state, 'new')).toMatchObject({
      categoryId: 'new',
      specialisations: [],
      brands: [],
      tools: [],
      attributes: {},
      visitFee: '199',
      labour: '299',
    });
  });

  it('validates configured expertise, schema attributes, pricing and travel as one service', () => {
    const schema = {
      type: 'object' as const,
      properties: { equipment: { type: 'array' as const, items: { type: 'string' as const, enum: ['split'] } } },
    };
    const skills = [{ id: 'skill-1', category_id: 'ac', kind: 'skill' as const, slug: 'split', label: 'Split AC', sort_order: 1 }];
    const state = {
      ...serviceEditorStateFromService(),
      categoryId: 'ac',
      visitFee: '199',
      labour: '299',
      specialisations: ['split'],
      attributes: { equipment: ['split'] },
      travelFeeMode: 'flat' as const,
      maxTravel: '20',
      travelFlat: '50',
    };
    expect(configuredExpertiseCount(state, schema)).toBe(2);
    expect(validateServiceEditor(state, schema, skills, 10)).toEqual({});
    expect(validateServiceEditor({ ...state, specialisations: [], attributes: {} }, schema, skills, 10).expertise).toMatch(/at least one/);
  });

  it('groups configured jobs and expertise fields, and labels saved selections from both', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        equipment: { type: 'array' as const, items: { type: 'string' as const, enum: ['split', 'window', 'cassette'] } },
        pests: { type: 'array' as const, items: { type: 'string' as const, enum: ['bed_bugs', 'rats'] } },
        supplies_mode: { type: 'string' as const, enum: ['included', 'customer'] },
      },
    };
    const skills = [
      { id: 's1', category_id: 'ac', kind: 'skill' as const, slug: 'split', label: 'Split AC', sort_order: 1 },
      { id: 's2', category_id: 'ac', kind: 'skill' as const, slug: 'bugs', label: 'Bed bugs', sort_order: 2 },
      { id: 's3', category_id: 'ac', kind: 'brand' as const, slug: 'lg', label: 'LG', sort_order: 1 },
      { id: 's4', category_id: 'other', kind: 'skill' as const, slug: 'x', label: 'Window', sort_order: 1 },
    ];
    const groups = expertiseGroups(skills, 'ac', schema);
    // Duplicates (split ↔ Split AC, bed_bugs ↔ Bed bugs) fold into the job; other categories' jobs never link.
    expect(groups.map((group) => [group.title, group.options.map((option) => option.label)])).toEqual([
      ['Jobs you do', ['Split AC', 'Bed bugs']],
      ['Equipment', ['Window', 'Cassette']],
      ['Pests', ['Rats']],
    ]);

    const jobs = groups[0]!;
    let state: ServiceEditorState = { ...serviceEditorStateFromService(), categoryId: 'ac' };
    state = toggleExpertise(state, jobs, jobs.options[0]!);
    expect(state.specialisations).toEqual(['split']);
    expect(state.attributes).toEqual({ equipment: ['split'] });
    expect(selectedExpertiseCount(groups, state)).toBe(1);
    state = toggleExpertise(state, jobs, jobs.options[0]!);
    expect(state.specialisations).toEqual([]);
    expect(state.attributes).toEqual({});

    // A legacy attribute-only selection still shows the job as chosen.
    const legacy = { category_id: 'ac', specialisations: [], attributes: { equipment: ['split', 'window'] } };
    expect(serviceExpertiseLabels(legacy as never, skills, schema)).toEqual(['Split AC', 'Window']);
    expect(serviceExpertiseLabels({ category_id: 'ac', attributes: {} } as never, skills, schema)).toEqual([]);
  });

  it('matches profile-field values to job labels by word stems only', () => {
    expect(sameExpertise('drainage', 'Drain blockage')).toBe(true);
    expect(sameExpertise('mcb_db', 'MCB / DB board')).toBe(true);
    expect(sameExpertise('deep_service', 'Jet / deep servicing')).toBe(true);
    expect(sameExpertise('mosquitoes', 'Mosquito')).toBe(true);
    expect(sameExpertise('rats', 'Rodent')).toBe(false);
    expect(sameExpertise('bathroom', 'Toilet / flush tank')).toBe(false);
  });

  it('rejects off-platform contact details in package descriptions and deliverables', () => {
    expect(packageHasContactHint({ description: 'Call 98765 43210 after booking' })).toBe(true);
    expect(packageHasContactHint({ inclusions: ['Pay by UPI'] })).toBe(true);
    expect(packageHasContactHint({ deliverables: [{ type: 'video', spec: 'Email files@example.com' }] })).toBe(true);
    expect(packageHasContactHint({ description: 'Two-hour jet service with final inspection.' })).toBe(false);
  });
});
