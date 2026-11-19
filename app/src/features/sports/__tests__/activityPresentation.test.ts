import { titleFromSlug } from '../activityPresentation';

describe('titleFromSlug', () => {
  it('title-cases each word in a hyphenated activity slug', () => {
    expect(titleFromSlug('table-tennis')).toBe('Table Tennis');
  });

  it('title-cases multiword sports activity slugs', () => {
    expect(titleFromSlug('five-a-side-football')).toBe('Five A Side Football');
  });
});
