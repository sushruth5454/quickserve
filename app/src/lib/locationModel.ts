/**
 * Pure model for the customer's selected service location (no React / native imports, so it is unit-testable).
 * The selection is app-wide state persisted in AsyncStorage under {@link LOCATION_STORAGE_KEY}.
 */
import type { SavedAddress } from './types';
import { demoSeedCity } from './config';

export const LOCATION_STORAGE_KEY = 'quickserve.location.v1';

export type LocationSource = 'default' | 'gps' | 'saved' | 'area' | 'search';

export interface SelectedLocation {
  source: LocationSource;
  /** Short name for the header ("Benz Circle"). */
  area: string;
  city: string;
  lat: number;
  lng: number;
  /** Full street line when known (saved address, GPS reverse-geocode or search result). */
  line1: string | null;
  /** Set when the selection is one of the user's saved addresses. */
  addressId: string | null;
  /** Saved-address label ("Home", "Work"…) for the header and the Book screen. */
  label: string | null;
}

export interface ManagedArea {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  sort_order: number;
}

export const LAUNCH_CITY = demoSeedCity || 'Vijayawada';

/**
 * The text sent to the geocoder: what the user typed, optionally narrowed by a real city, always scoped to India.
 * Test labels such as "Vijayawada Demo" are not places, so the " Demo" suffix is dropped; appending it made every
 * search ("Sangareddy, Vijayawada Demo") return nothing.
 */
export function geocodeQuery(query: string, city?: string | null): string {
  const q = query.trim();
  const c = (city ?? '').replace(/\s+demo$/i, '').trim();
  const parts = [q];
  if (c && !q.toLowerCase().includes(c.toLowerCase())) parts.push(c);
  if (!/\bindia\b/i.test(q)) parts.push('India');
  return parts.join(', ');
}

/** Initial location before the user picks one (and the EXPO_PUBLIC_FORCE_TEST_LOCATION default). */
export const DEFAULT_LOCATION: SelectedLocation = {
  source: 'default',
  area: 'Benz Circle',
  city: LAUNCH_CITY,
  lat: 16.4995,
  lng: 80.656,
  line1: null,
  addressId: null,
  label: null,
};

export function fromManagedArea(a: ManagedArea): SelectedLocation {
  return {
    source: 'area',
    area: a.name,
    city: a.city,
    lat: a.lat,
    lng: a.lng,
    line1: null,
    addressId: null,
    label: null,
  };
}

/** Neighbourhood guess from a free-text address line: the last comma part that is not the city. */
export function areaFromLine(line1: string, city: string): string {
  const parts = line1
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && p.toLowerCase() !== city.trim().toLowerCase());
  return parts[parts.length - 1] ?? city;
}

export function fromSavedAddress(a: SavedAddress): SelectedLocation {
  return {
    source: 'saved',
    area: areaFromLine(a.line1, a.city),
    city: a.city,
    lat: a.lat,
    lng: a.lng,
    line1: a.line1,
    addressId: a.id,
    label: a.label,
  };
}

/** Saved addresses first by default flag, then oldest first (matches the server's default-address order). */
export function sortAddresses(list: SavedAddress[]): SavedAddress[] {
  return [...list].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.created_at.localeCompare(b.created_at));
}

const SOURCES: LocationSource[] = ['default', 'gps', 'saved', 'area', 'search'];
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Validates persisted JSON; returns null for anything malformed so the app falls back to the default. */
export function parseStoredLocation(raw: string | null | undefined): SelectedLocation | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!SOURCES.includes(o.source as LocationSource) || !str(o.area) || !str(o.city)) return null;
  if (!num(o.lat, -90, 90) || !num(o.lng, -180, 180)) return null;
  return {
    source: o.source as LocationSource,
    area: o.area,
    city: o.city,
    lat: o.lat,
    lng: o.lng,
    line1: str(o.line1) ? o.line1 : null,
    addressId: str(o.addressId) ? o.addressId : null,
    label: str(o.label) ? o.label : null,
  };
}

/** Header text: "Home · Benz Circle" for saved addresses, the area otherwise. */
export function locationTitle(l: SelectedLocation): string {
  return l.label ? `${l.label} · ${l.area}` : l.area;
}

/** Two locations point at the same place (used to show the selected check in the picker). */
export function sameLocation(a: SelectedLocation | null, b: SelectedLocation): boolean {
  if (!a) return false;
  if (a.addressId || b.addressId) return a.addressId === b.addressId;
  return a.source === b.source && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}
