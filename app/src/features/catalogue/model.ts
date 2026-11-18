import type { Category, PackagePriceType, ServicePackage } from '../../lib/types';

export type CatalogueCategory = Category & {
  recurrence_allowed?: boolean;
  allowed_frequencies?: string[];
};

export interface Catalogue {
  categories: CatalogueCategory[];
  verticals: CatalogueVertical[];
}

export interface CatalogueVertical {
  slug: string;
  label: string;
  categories: CatalogueCategory[];
}

export interface CatalogueSection {
  slug: string;
  label: string;
  categories: CatalogueCategory[];
}

export interface CatalogueFamily {
  slug: string;
  label: string;
  verticalSlugs: string[];
}

const HOME_GROUP_VERTICALS = ['household-help', 'home-repairs', 'home-other'] as const;
const HOME_FAMILY_VERTICALS = [...HOME_GROUP_VERTICALS, 'cleaning', 'auto', 'home-services'];

const FAMILY_DEFINITIONS: Array<Pick<CatalogueFamily, 'slug' | 'label'> & { verticalSlugs: string[] }> = [
  { slug: 'home', label: 'Home & vehicle services', verticalSlugs: HOME_FAMILY_VERTICALS },
  { slug: 'creative-events', label: 'Creators & events', verticalSlugs: ['creators', 'photo-video', 'weddings-events'] },
  { slug: 'beauty-wellness', label: 'Beauty & wellness', verticalSlugs: ['beauty-wellness', 'beauty', 'wellness'] },
  { slug: 'learning', label: 'Learning & sessions', verticalSlugs: ['learning', 'education', 'tutoring'] },
];

const LABELS: Record<string, string> = {
  'home-repairs': 'Home repairs',
  'home-services': 'Home services',
  'household-help': 'Household help',
  'home-other': 'Other services',
  'photo-video': 'Photo & video',
  'weddings-events': 'Weddings & events',
  'beauty-wellness': 'Beauty & wellness',
};

export function normaliseCatalogue(payload: unknown): Catalogue {
  const source = Array.isArray(payload) ? payload : objectValue(payload);
  const flat: CatalogueCategory[] = [];

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

  const services = flat.filter((category) => !isCatalogueGroup(category) && isVisibleCategory(category));
  const serviceableParentIds = new Set(
    services.map((category) => category.parent_id).filter((parentId): parentId is string => Boolean(parentId)),
  );
  const groups = flat.filter((category) => isCatalogueGroup(category) && serviceableParentIds.has(category.id));
  const categories = [...groups, ...services]
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

function isCategory(value: unknown): value is CatalogueCategory {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.slug === 'string' && typeof row.name === 'string';
}

function isCatalogueGroup(category: CatalogueCategory): boolean {
  return (category as CatalogueCategory & { archetype?: Category['archetype'] | null }).archetype === null
    && category.parent_id == null;
}

function isVisibleCategory(category: CatalogueCategory): boolean {
  return category.active !== false && category.live !== false;
}

export function groupVerticals(categories: CatalogueCategory[]): CatalogueVertical[] {
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
  const hasHomeServiceGroups = verticals.some((vertical) =>
    HOME_GROUP_VERTICALS.includes(vertical.slug as typeof HOME_GROUP_VERTICALS[number])
      && vertical.categories.some(isCatalogueGroup));
  const families = FAMILY_DEFINITIONS.flatMap((definition) => {
    const members = verticals.filter((vertical) => definition.verticalSlugs.includes(vertical.slug));
    if (members.length === 0) return [];
    members.forEach((vertical) => assigned.add(vertical.slug));
    return [{
      slug: definition.slug,
      label: definition.slug === 'home' && hasHomeServiceGroups ? 'Home services' : definition.label,
      verticalSlugs: members.map((vertical) => vertical.slug),
    }];
  });
  const remaining = verticals.filter((vertical) => !assigned.has(vertical.slug));
  if (remaining.length > 0) {
    families.push({ slug: 'more', label: 'More services', verticalSlugs: remaining.map((vertical) => vertical.slug) });
  }
  return families;
}

export function buildCatalogueSections(
  verticals: CatalogueVertical[],
  catalogueV2Enabled: boolean,
  filter = '',
): CatalogueSection[] {
  const query = filter.trim().toLowerCase();
  const categories = verticals.flatMap((vertical) => vertical.categories);
  const matches = (category: CatalogueCategory) => !query || category.name.toLowerCase().includes(query);

  if (!catalogueV2Enabled) {
    return verticals.flatMap((vertical) => {
      const visible = vertical.categories.filter((category) =>
        !isCatalogueGroup(category) && isVisibleCategory(category) && matches(category));
      return visible.length > 0
        ? [{ slug: vertical.slug, label: vertical.label, categories: visible }]
        : [];
    });
  }

  const homeGroups = categories
    .filter((category) =>
      isCatalogueGroup(category)
      && HOME_GROUP_VERTICALS.includes(category.vertical as typeof HOME_GROUP_VERTICALS[number]))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const groupedSections = homeGroups.flatMap((group) => {
    const children = categories.filter((category) =>
      !isCatalogueGroup(category)
      && isVisibleCategory(category)
      && category.parent_id === group.id);
    if (children.length === 0) return [];
    const visibleChildren = group.name.toLowerCase().includes(query)
      ? children
      : children.filter(matches);
    return visibleChildren.length > 0
      ? [{ slug: group.id, label: group.name, categories: visibleChildren }]
      : [];
  });

  const otherSections = verticals
    .filter((vertical) => !HOME_GROUP_VERTICALS.includes(vertical.slug as typeof HOME_GROUP_VERTICALS[number]))
    .flatMap((vertical) => {
      const visible = vertical.categories.filter((category) =>
        !isCatalogueGroup(category) && isVisibleCategory(category) && matches(category));
      return visible.length > 0
        ? [{ slug: vertical.slug, label: vertical.label, categories: visible }]
        : [];
    });

  return [...groupedSections, ...otherSections];
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
