import type { Category, PackagePriceType, ServicePackage } from '../../lib/types';

export interface Catalogue {
  categories: Category[];
  verticals: CatalogueVertical[];
}

export interface CatalogueVertical {
  slug: string;
  label: string;
  categories: Category[];
}

export interface CatalogueFamily {
  slug: string;
  label: string;
  verticalSlugs: string[];
}

const FAMILY_DEFINITIONS: Array<Pick<CatalogueFamily, 'slug' | 'label'> & { verticalSlugs: string[] }> = [
  { slug: 'home', label: 'Home & vehicle services', verticalSlugs: ['home-repairs', 'home-services', 'cleaning', 'auto'] },
  { slug: 'creative-events', label: 'Creators & events', verticalSlugs: ['creators', 'photo-video', 'weddings-events'] },
  { slug: 'beauty-wellness', label: 'Beauty & wellness', verticalSlugs: ['beauty-wellness', 'beauty', 'wellness'] },
  { slug: 'learning', label: 'Learning & sessions', verticalSlugs: ['learning', 'education', 'tutoring'] },
];

const LABELS: Record<string, string> = {
  'home-repairs': 'Home repairs',
  'home-services': 'Home services',
  'photo-video': 'Photo & video',
  'weddings-events': 'Weddings & events',
  'beauty-wellness': 'Beauty & wellness',
};

export function normaliseCatalogue(payload: unknown): Catalogue {
  const source = Array.isArray(payload) ? payload : objectValue(payload);
  const flat: Category[] = [];

  for (const row of source) {
    if (!row || typeof row !== 'object') continue;
    const value = row as Record<string, unknown>;
    if (Array.isArray(value.categories)) {
      for (const child of value.categories) {
        if (isCategory(child)) flat.push({ ...child, vertical: child.vertical ?? String(value.slug ?? value.vertical ?? 'other') });
      }
    } else if (isCategory(value)) {
      flat.push(value);
    }
  }

  const categories = flat
    .filter((category) => category.active !== false && category.live !== false)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return { categories, verticals: groupVerticals(categories) };
}

function objectValue(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as Record<string, unknown>;
  for (const key of ['verticals', 'data', 'categories']) {
    if (Array.isArray(value[key])) return value[key] as Array<Record<string, unknown>>;
  }
  return [value];
}

function isCategory(value: unknown): value is Category {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.slug === 'string' && typeof row.name === 'string';
}

export function groupVerticals(categories: Category[]): CatalogueVertical[] {
  const bySlug = new Map<string, CatalogueVertical>();
  for (const category of categories) {
    const slug = category.vertical?.trim() || 'other';
    const group = bySlug.get(slug) ?? { slug, label: LABELS[slug] ?? titleCase(slug), categories: [] };
    group.categories.push(category);
    bySlug.set(slug, group);
  }
  return [...bySlug.values()].sort((a, b) => {
    const first = Math.min(...a.categories.map((item) => item.sort_order));
    const second = Math.min(...b.categories.map((item) => item.sort_order));
    return first - second || a.label.localeCompare(b.label);
  });
}

export function groupCatalogueFamilies(verticals: CatalogueVertical[]): CatalogueFamily[] {
  const assigned = new Set<string>();
  const families = FAMILY_DEFINITIONS.flatMap((definition) => {
    const members = verticals.filter((vertical) => definition.verticalSlugs.includes(vertical.slug));
    if (members.length === 0) return [];
    members.forEach((vertical) => assigned.add(vertical.slug));
    return [{ slug: definition.slug, label: definition.label, verticalSlugs: members.map((vertical) => vertical.slug) }];
  });
  const remaining = verticals.filter((vertical) => !assigned.has(vertical.slug));
  if (remaining.length > 0) {
    families.push({ slug: 'more', label: 'More services', verticalSlugs: remaining.map((vertical) => vertical.slug) });
  }
  return families;
}

export function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isInstantPackage(category: Category): boolean {
  return category.archetype === 'fixed' && (category.pricing_units ?? []).every((unit) => unit !== 'month');
}

export function packagePrice(category: Pick<ServicePackage, 'price_type' | 'price' | 'price_min' | 'price_max'>): {
  type: PackagePriceType;
  amount: number | null;
  label: 'fixed' | 'from' | 'range' | 'quote';
} {
  if (category.price_type === 'quote' || category.price == null && category.price_min == null) {
    return { type: 'quote', amount: null, label: 'quote' };
  }
  if (category.price_type === 'range') return { type: 'range', amount: category.price_min, label: 'range' };
  return { type: category.price_type, amount: category.price ?? category.price_min ?? null, label: category.price_type === 'from' ? 'from' : 'fixed' };
}
