import type { Category } from '../../../lib/types';
import { groupCatalogueFamilies, groupVerticals, normaliseCatalogue, packagePrice } from '../model';
import { validateSchema, validateValues } from '../schema';
import { canPayInstantly, packageDuration, packageTotal } from '../../booking/packages/packageModel';

const category = (id: string, vertical: string, sort_order: number, patch: Partial<Category> = {}): Category => ({
  id, slug: id, name: id, icon: 'construct', pricing_mode: 'quote', sort_order, vertical, ...patch,
});

test('normalises flat and vertical catalogue payloads without a fixed category count', () => {
  const result = normaliseCatalogue([
    { vertical: 'beauty', slug: 'beauty', categories: [category('salon', 'beauty', 2)] },
    category('plumber', 'home-repairs', 1),
    category('inactive', 'home-repairs', 0, { active: false }),
  ]);
  expect(result.categories.map((item) => item.slug)).toEqual(['plumber', 'salon']);
  expect(result.verticals.map((item) => item.slug)).toEqual(['home-repairs', 'beauty']);
});

test('groups server-returned categories by vertical', () => {
  const groups = groupVerticals([category('one', 'events', 2), category('two', 'events', 3), category('three', 'care', 1)]);
  expect(groups.map((group) => [group.slug, group.categories.length])).toEqual([['care', 1], ['events', 2]]);
});

test('maps existing verticals to customer-facing service families without dropping unknown verticals', () => {
  const verticals = groupVerticals([
    category('plumber', 'home-repairs', 1),
    category('mechanic', 'auto', 2),
    category('creator', 'creators', 3),
    category('photographer', 'photo-video', 4),
    category('tutor', 'learning', 5),
    category('specialist', 'new-market', 6),
  ]);

  expect(groupCatalogueFamilies(verticals).map((family) => [family.slug, family.label, family.verticalSlugs])).toEqual([
    ['home', 'Home & vehicle services', ['home-repairs', 'auto']],
    ['creative-events', 'Creators & events', ['creators', 'photo-video']],
    ['learning', 'Learning & sessions', ['learning']],
    ['more', 'More services', ['new-market']],
  ]);
});

test('unsupported schema keywords block rather than silently hide fields', () => {
  expect(validateSchema({ type: 'object', properties: {}, oneOf: [] })).toEqual([
    { path: '$', message: 'Unsupported keyword: oneOf' },
  ]);
});

test('validates server grammar and required values including multi-select bounds', () => {
  const schema = {
    type: 'object',
    properties: {
      guests: { type: 'integer', minimum: 10, maximum: 100 },
      cuisines: { type: 'array', items: { type: 'string', enum: ['veg', 'vegan'] }, minItems: 1, maxItems: 2, uniqueItems: true },
    },
    required: ['guests', 'cuisines'],
  };
  expect(validateValues(schema, { guests: 5, cuisines: [] })).toEqual(expect.arrayContaining([
    { path: 'guests', message: 'Minimum is 10' },
    { path: 'cuisines', message: 'Required' },
  ]));
  expect(validateValues(schema, { guests: 50, cuisines: ['veg', 'unknown'] })).toEqual([
    { path: 'cuisines', message: 'Contains an unsupported value' },
  ]);
});

test('fixed packages expose server price and exact quantity duration', () => {
  const item = {
    price_type: 'fixed' as const, price: 25000, price_min: 25000, price_max: 25000,
    unit: 'session' as const, duration_min: 45,
  };
  expect(canPayInstantly(item as never)).toBe(true);
  expect(packageTotal(item as never, 4)).toBe(100000);
  expect(packageDuration(item as never, 4)).toBe(180);
  expect(packagePrice(item)).toEqual({ type: 'fixed', amount: 25000, label: 'fixed' });
});

test('quote and range packages never become instant payments', () => {
  expect(canPayInstantly({ price_type: 'quote', price: null, price_min: null } as never)).toBe(false);
  expect(packagePrice({ price_type: 'range', price: null, price_min: 10000, price_max: 20000 })).toEqual({
    type: 'range', amount: 10000, label: 'range',
  });
});
