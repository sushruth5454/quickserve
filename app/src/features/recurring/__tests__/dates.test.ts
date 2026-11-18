import { calculateRecurringDates, type RecurrenceDateInput } from '../dates';

type DateFixture = {
  name: string;
  input: RecurrenceDateInput;
  from: string;
  through: string;
  maxPlanDays: number;
  expected: string[];
};

const rule = (patch: Partial<RecurrenceDateInput> = {}): RecurrenceDateInput => ({
  frequency: 'weekly',
  interval_count: 1,
  weekdays: [1, 2, 3, 4, 5, 6],
  month_day: null,
  custom_dates: [],
  start_date: '2026-12-07',
  end_date: null,
  ...patch,
});

const sharedVectors: DateFixture[] = [
  {
    name: 'weekly Monday through Saturday',
    input: rule(),
    from: '2026-12-07',
    through: '2026-12-14',
    maxPlanDays: 7,
    expected: ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-14'],
  },
  {
    name: 'alternate days',
    input: rule({ frequency: 'alternate_days', interval_count: 1, weekdays: [] }),
    from: '2026-12-07',
    through: '2026-12-13',
    maxPlanDays: 6,
    expected: ['2026-12-07', '2026-12-09', '2026-12-11', '2026-12-13'],
  },
  {
    name: 'weekly Sunday',
    input: rule({ frequency: 'weekly', weekdays: [7] }),
    from: '2026-12-07',
    through: '2026-12-27',
    maxPlanDays: 20,
    expected: ['2026-12-13', '2026-12-20', '2026-12-27'],
  },
  {
    name: 'monthly on day seven every six months',
    input: rule({
      frequency: 'monthly',
      interval_count: 6,
      weekdays: [],
      month_day: 7,
    }),
    from: '2026-12-07',
    through: '2027-12-07',
    maxPlanDays: 365,
    expected: ['2026-12-07', '2027-06-07', '2027-12-07'],
  },
  {
    name: 'daily across a year boundary with an inclusive end date',
    input: rule({
      frequency: 'daily',
      weekdays: [],
      start_date: '2026-12-30',
      end_date: '2027-01-02',
    }),
    from: '2026-12-30',
    through: '2027-01-05',
    maxPlanDays: 365,
    expected: ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'],
  },
  {
    name: 'custom dates',
    input: rule({
      frequency: 'custom',
      weekdays: [],
      start_date: '2026-12-25',
      custom_dates: ['2026-12-25', '2026-12-31'],
    }),
    from: '2026-12-25',
    through: '2026-12-31',
    maxPlanDays: 6,
    expected: ['2026-12-25', '2026-12-31'],
  },
];

test.each(sharedVectors)('matches the shared recurrence vector: $name', ({ input, from, through, maxPlanDays, expected }) => {
  expect(calculateRecurringDates(input, { from, through, maxPlanDays })).toEqual(expected);
});

test('weekly intervals are anchored to the Monday of the start week', () => {
  const input = rule({
    frequency: 'weekly',
    interval_count: 2,
    weekdays: [3],
    start_date: '2026-12-09',
  });

  expect(calculateRecurringDates(input, {
    from: '2026-12-07',
    through: '2027-01-06',
    maxPlanDays: 28,
  })).toEqual(['2026-12-09', '2026-12-23', '2027-01-06']);
});

test('alternate-day recurrence ignores interval_count', () => {
  const input = rule({
    frequency: 'alternate_days',
    interval_count: 12,
    weekdays: [],
  });

  expect(calculateRecurringDates(input, {
    from: '2026-12-07',
    through: '2026-12-13',
    maxPlanDays: 6,
  })).toEqual(['2026-12-07', '2026-12-09', '2026-12-11', '2026-12-13']);
});

test('clips dates to the requested range and configured maximum plan length', () => {
  const input = rule({
    frequency: 'daily',
    weekdays: [],
    start_date: '2026-12-30',
    end_date: '2027-01-10',
  });

  expect(calculateRecurringDates(input, {
    from: '2026-12-31',
    through: '2027-01-10',
    maxPlanDays: 2,
  })).toEqual(['2026-12-31', '2027-01-01']);
});

test('rejects invalid date rules instead of silently changing them', () => {
  expect(() => calculateRecurringDates(rule({ weekdays: [] }), {
    from: '2026-12-07',
    through: '2026-12-14',
    maxPlanDays: 7,
  })).toThrow();

  expect(() => calculateRecurringDates(rule({
    frequency: 'monthly',
    month_day: 29,
    weekdays: [],
  }), {
    from: '2026-12-07',
    through: '2027-12-07',
    maxPlanDays: 365,
  })).toThrow();

  expect(() => calculateRecurringDates(rule({
    frequency: 'custom',
    weekdays: [],
    custom_dates: ['2026-12-06'],
  }), {
    from: '2026-12-07',
    through: '2026-12-14',
    maxPlanDays: 7,
  })).toThrow();
});
