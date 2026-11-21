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

export interface LocationAddressState {
  actorId: string | null;
  requestId: number;
  loading: boolean;
  addresses: SavedAddress[] | null;
  error: string | null;
}

export type LocationAddressAction =
  | { type: 'actor-change'; actorId: string | null; requestId: number }
  | { type: 'load-start'; actorId: string; requestId: number }
  | { type: 'load-success'; actorId: string; requestId: number; addresses: SavedAddress[] }
  | { type: 'load-error'; actorId: string; requestId: number; error: string }
  | { type: 'delete'; actorId: string; addressId: string; requestId: number }
  | { type: 'address-added'; actorId: string; address: SavedAddress };

export const initialLocationAddressState: LocationAddressState = {
  actorId: null,
  requestId: 0,
  loading: false,
  addresses: null,
  error: null,
};

const STORED_LOCATION_VERSION = 2;

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

/** Initial location before the user picks one. */
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

export function needsLocationPrompt(location: SelectedLocation): boolean {
  return location.source === 'default';
}

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

export function confirmedLocationActor(authLoading: boolean, userId: string | null): string | null {
  return authLoading || !userId?.trim() ? null : userId;
}

export async function runPrivateLocationRequest<T>(actorId: string | null, request: () => Promise<T>): Promise<T | null> {
  if (!actorId) return null;
  return request();
}

export function locationAddressReducer(state: LocationAddressState, action: LocationAddressAction): LocationAddressState {
  if (action.type === 'actor-change') {
    return {
      actorId: action.actorId,
      requestId: action.requestId,
      loading: false,
      addresses: null,
      error: null,
    };
  }
  if (action.type === 'load-start') {
    if (state.actorId !== action.actorId || action.requestId <= state.requestId) return state;
    return { ...state, requestId: action.requestId, loading: true, error: null };
  }
  if (action.type === 'load-success') {
    if (state.actorId !== action.actorId || state.requestId !== action.requestId) return state;
    return { ...state, loading: false, addresses: sortAddresses(action.addresses), error: null };
  }
  if (action.type === 'load-error') {
    if (state.actorId !== action.actorId || state.requestId !== action.requestId) return state;
    return { ...state, loading: false, error: action.error };
  }
  if (action.type === 'delete') {
    if (state.actorId !== action.actorId || action.requestId <= state.requestId) return state;
    return {
      ...state,
      requestId: action.requestId,
      loading: false,
      addresses: state.addresses?.filter((address) => address.id !== action.addressId) ?? null,
      error: null,
    };
  }
  if (state.actorId !== action.actorId || !state.addresses) return state;
  return {
    ...state,
    addresses: sortAddresses([...state.addresses.filter((address) => address.id !== action.address.id), action.address]),
  };
}

export function formatSavedAddress(address: SavedAddress): string {
  return `${address.line1}, ${address.city}`;
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

export type StoredLocationResolution =
  | { status: 'pending' | 'empty' | 'discard' }
  | { status: 'restore'; location: SelectedLocation; ownerUserId: string | null; needsMigration: boolean };

export function serializeStoredLocation(location: SelectedLocation, ownerUserId: string | null): string {
  const owner = location.source === 'saved' && str(ownerUserId) ? ownerUserId.trim() : null;
  return JSON.stringify({ version: STORED_LOCATION_VERSION, ownerUserId: owner, location });
}

export function resolveStoredLocation(
  raw: string | null | undefined,
  authLoading: boolean,
  userId: string | null,
): StoredLocationResolution {
  if (authLoading) return { status: 'pending' };
  if (!raw) return { status: 'empty' };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'discard' };
  }
  if (!value || typeof value !== 'object') return { status: 'discard' };

  const record = value as Record<string, unknown>;
  const isVersioned = Object.prototype.hasOwnProperty.call(record, 'version');
  let location: SelectedLocation | null;
  let ownerUserId: string | null = null;
  let needsMigration = true;

  if (isVersioned) {
    if (record.version !== STORED_LOCATION_VERSION || !record.location || typeof record.location !== 'object') {
      return { status: 'discard' };
    }
    const storedOwner = record.ownerUserId;
    if (storedOwner !== null && !str(storedOwner)) return { status: 'discard' };
    ownerUserId = typeof storedOwner === 'string' ? storedOwner.trim() : null;
    location = parseStoredLocation(JSON.stringify(record.location));
    needsMigration = false;
  } else {
    location = parseStoredLocation(raw);
  }

  if (!location) return { status: 'discard' };
  if (location.source === 'saved' && (!userId || ownerUserId !== userId)) return { status: 'discard' };
  return {
    status: 'restore',
    location,
    ownerUserId: location.source === 'saved' ? ownerUserId : null,
    needsMigration,
  };
}

export function locationForConfirmedActor(
  location: SelectedLocation,
  ownerUserId: string | null,
  authLoading: boolean,
  userId: string | null,
): SelectedLocation {
  if (location.source !== 'saved') return location;
  if (authLoading || !userId || ownerUserId !== userId) return DEFAULT_LOCATION;
  return location;
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
