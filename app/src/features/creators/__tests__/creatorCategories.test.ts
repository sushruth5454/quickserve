import type { Catalogue, CatalogueCategory } from '../../catalogue/model';
import { creatorCategories } from '../creatorCategories';

const category = (slug: string, vertical: string, sort_order: number): CatalogueCategory => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  icon: 'sparkles-outline',
  pricing_mode: 'quote',
  sort_order,
  vertical,
});

test('creatorCategories returns categories from the creative-events family in catalogue order', () => {
  const photo = category('photography', 'photo-video', 2);
  const home = category('plumbing', 'home-repairs', 1);
  const wedding = category('wedding-planning', 'weddings-events', 3);
  const catalogue: Catalogue = {
    categories: [photo, home, wedding],
    verticals: [
      { slug: 'home-repairs', label: 'Home repairs', categories: [home] },
      { slug: 'photo-video', label: 'Photo & video', categories: [photo] },
      { slug: 'weddings-events', label: 'Weddings & events', categories: [wedding] },
    ],
  };

  expect(creatorCategories(catalogue).map(({ slug }) => slug)).toEqual(['photography', 'wedding-planning']);
});

test('creatorCategories returns an empty list when the catalogue has no creative-events family', () => {
  const home = category('plumbing', 'home-repairs', 1);
  const catalogue: Catalogue = {
    categories: [home],
    verticals: [{ slug: 'home-repairs', label: 'Home repairs', categories: [home] }],
  };

  expect(creatorCategories(catalogue)).toEqual([]);
});
