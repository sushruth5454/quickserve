import { isDemoMode } from './config';
import { invokeFunction } from './invokeFunction';

export interface PlaceSuggestion {
  placeId: string;
  title: string;
  subtitle: string;
}

export interface PlaceDetail {
  lat: number;
  lng: number;
  title: string;
  area: string;
  city: string;
  line1: string | null;
}

/** Thrown when the server has no Google key (or demo mode): callers fall back to the phone's geocoder. */
export class PlacesUnavailable extends Error {}

/** One token per search session: the suggestions typed and the place finally picked are billed together. */
export function newPlacesSession(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (isDemoMode) throw new PlacesUnavailable('demo');
  const { data, error } = await invokeFunction<T>('places', { body });
  if (error) {
    const status = (error as { context?: Response }).context?.status;
    if (status === 503 || status === 404) throw new PlacesUnavailable('not configured');
    throw new Error('Address search is unavailable right now. Pick an area below.');
  }
  return data as T;
}

/** Google Places suggestions in India, biased to the given point (e.g. the current location). */
export async function placeSuggestions(input: string, sessionToken: string, near?: { lat: number; lng: number } | null): Promise<PlaceSuggestion[]> {
  const r = await call<{ suggestions: PlaceSuggestion[] }>({ action: 'autocomplete', input, sessionToken, lat: near?.lat, lng: near?.lng });
  return r.suggestions ?? [];
}

export async function placeDetail(placeId: string, sessionToken: string): Promise<PlaceDetail> {
  const r = await call<{ place: PlaceDetail }>({ action: 'details', placeId, sessionToken });
  return r.place;
}
