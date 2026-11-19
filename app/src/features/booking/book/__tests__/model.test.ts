import { readPaise } from '../model';

describe('booking price preview model', () => {
  it.each([[0, 0], ['2900', 2900], [102800, 102800]])('reads valid paise value %p', (value, expected) => {
    expect(readPaise(value)).toBe(expected);
  });

  it.each([null, undefined, true, false])('rejects incomplete price value %p', (value) => {
    expect(() => readPaise(value)).toThrow('The booking price preview is incomplete');
  });

  it.each(['not a number', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid price value %p',
    (value) => {
      expect(() => readPaise(value)).toThrow('The booking price preview is invalid');
    },
  );
});
