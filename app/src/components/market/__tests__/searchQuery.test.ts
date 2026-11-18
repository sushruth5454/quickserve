import { isSearchable, normalizeQuery } from '../searchQuery';

describe('search query helpers', () => {
  it('trims surrounding whitespace and collapses internal whitespace', () => {
    expect(normalizeQuery('  home   repair \n services  ')).toBe('home repair services');
  });

  it('normalizes whitespace-only queries to an empty string', () => {
    expect(normalizeQuery(' \t\n ')).toBe('');
  });

  it('requires at least two normalized characters to search', () => {
    expect(isSearchable('')).toBe(false);
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('ac')).toBe(true);
  });
});
