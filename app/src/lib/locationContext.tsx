import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { Coords } from './apiTypes';
import { resolveServiceCity } from './api';
import { useAuth } from './auth';
import { demoSeedCity, isSeedDemoMode } from './config';
import { DEFAULT_LOCATION, geocodeQuery, LAUNCH_CITY, LOCATION_STORAGE_KEY, parseStoredLocation, type SelectedLocation } from './locationModel';
import { newPlacesSession, placeDetail, PlacesUnavailable, placeSuggestions } from './places';

export type GpsResult =
  | { ok: true; location: SelectedLocation }
  | { ok: false; reason: 'denied' | 'unavailable'; canAskAgain: boolean; message: string };

export interface PlaceResult {
  title: string;
  subtitle: string;
  /** Null for a Google suggestion until it is picked (resolvePlace fetches the coordinates). */
  location: SelectedLocation | null;
  placeId?: string;
}

interface LocationContextValue {
  location: SelectedLocation;
  coords: Coords;
  /** False until the persisted choice (or first-run default) has been resolved. */
  ready: boolean;
  /** Persists an explicit user choice. */
  setLocation: (l: SelectedLocation) => void;
  /** Reads the device position; does not change the selection by itself. */
  locateWithGps: () => Promise<GpsResult>;
}

const Ctx = createContext<LocationContextValue | null>(null);

function describePlace(place: Location.LocationGeocodedAddress | undefined) {
  const city = place?.city ?? place?.subregion ?? place?.region ?? LAUNCH_CITY;
  const area = place?.district ?? place?.street ?? place?.name ?? city;
  const line1 = [place?.name, place?.street, place?.district].filter((x, i, arr) => !!x && arr.indexOf(x) === i).join(', ') || null;
  return { city, area, line1 };
}

export async function locateWithGps(): Promise<GpsResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      return {
        ok: false,
        reason: 'denied',
        canAskAgain: perm.canAskAgain,
        message: 'Location permission is off. Allow it in Settings, or pick an area below.',
      };
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).catch(() => []);
    const d = describePlace(place);
    return {
      ok: true,
      location: { source: 'gps', area: place ? d.area : 'Current location', city: d.city, lat, lng, line1: d.line1, addressId: null, label: null },
    };
  } catch (e) {
    return { ok: false, reason: 'unavailable', canAskAgain: true, message: (e as Error).message || 'Could not get your location.' };
  }
}

/** Address search: Google Places on every platform; the phone's geocoder is the fallback on iOS/Android. */
export const placeSearchSupported = true;

/**
 * Suggestions for the search box. Google Places (live, India, biased to `near`) when the server has a key; otherwise
 * the OS geocoder (native only). Google results carry a placeId and no coordinates until picked: call resolvePlace.
 */
export async function searchPlaces(
  query: string,
  city: string | null = null,
  opts: { sessionToken?: string; near?: { lat: number; lng: number } | null } = {},
): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const hits = await placeSuggestions(city ? `${q}, ${city.replace(/\s+demo$/i, '')}` : q, opts.sessionToken ?? newPlacesSession(), opts.near);
    return hits.map((h) => ({ title: h.title, subtitle: h.subtitle, location: null, placeId: h.placeId }));
  } catch (e) {
    if (!(e instanceof PlacesUnavailable)) throw e;
  }
  if (Platform.OS === 'web') throw new Error('Address search is available in the mobile app.');
  // Android's geocoder can need the location permission; ask once if it has never been asked.
  if (Platform.OS === 'android') {
    const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (perm && perm.status === 'undetermined') await Location.requestForegroundPermissionsAsync().catch(() => undefined);
  }
  const hits = await Location.geocodeAsync(geocodeQuery(q, city));
  const top = hits.slice(0, 5);
  const places = await Promise.all(
    top.map((h) => Location.reverseGeocodeAsync({ latitude: h.latitude, longitude: h.longitude }).then((r) => r[0]).catch(() => undefined)),
  );
  return top.map((h, i) => {
    const d = describePlace(places[i]);
    const title = places[i] ? d.area : q;
    return {
      title,
      subtitle: [d.line1 && d.line1 !== title ? d.line1 : null, d.city].filter(Boolean).join(', '),
      location: { source: 'search', area: title, city: d.city, lat: h.latitude, lng: h.longitude, line1: d.line1, addressId: null, label: null },
    };
  });
}

/** The picked suggestion as a location (fetches coordinates for a Google suggestion, ending its billing session). */
export async function resolvePlace(r: PlaceResult, sessionToken?: string): Promise<SelectedLocation> {
  if (r.location) return r.location;
  if (!r.placeId) throw new Error('This place has no location. Try another result.');
  const p = await placeDetail(r.placeId, sessionToken ?? newPlacesSession());
  return { source: 'search', area: p.area || p.title, city: p.city || p.area, lat: p.lat, lng: p.lng, line1: p.line1, addressId: null, label: null };
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLoc] = useState<SelectedLocation>(DEFAULT_LOCATION);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = parseStoredLocation(await AsyncStorage.getItem(LOCATION_STORAGE_KEY).catch(() => null));
      // Demo-city builds only have seeded providers in that city. A location saved by an earlier build is dropped
      // once, on the first launch of the demo build; anything the user picks after that is kept.
      const resetKey = `${LOCATION_STORAGE_KEY}.demoReset.${demoSeedCity.toLowerCase()}`;
      const needsDemoReset = isSeedDemoMode && !(await AsyncStorage.getItem(resetKey).catch(() => '1'));
      if (!alive) return;
      if (needsDemoReset) void AsyncStorage.setItem(resetKey, '1').catch(() => undefined);
      if (stored && (!needsDemoReset || stored.city?.trim().toLowerCase() === demoSeedCity.toLowerCase())) {
        setLoc(stored);
        setReady(true);
        return;
      }
      // The reset drops the old selection for good, so it cannot come back on the next launch.
      if (stored) void AsyncStorage.removeItem(LOCATION_STORAGE_KEY).catch(() => undefined);
      // First run uses the default until the customer chooses a location from the picker.
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // A saved address belongs to the signed-in user: drop it on sign-out so the next user never sees it.
  const { userId } = useAuth();
  useEffect(() => {
    if (ready && !userId && location.source === 'saved') {
      setLoc(DEFAULT_LOCATION);
      void AsyncStorage.removeItem(LOCATION_STORAGE_KEY).catch(() => undefined);
    }
  }, [ready, userId, location.source]);

  const setLocation = useCallback((l: SelectedLocation) => {
    setLoc(l);
    void AsyncStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(l)).catch(() => undefined);
  }, []);

  // Geocoders name the village or suburb ("Pothireddypally") rather than the launch city ("Sangareddy") that the
  // catalogue and booking use. Map the coordinates to the live service city covering them; keep the geocoded name
  // when no live provider serves the area, so the home screen can say the area is not served yet.
  const { lat: curLat, lng: curLng, city: curCity } = location;
  useEffect(() => {
    if (!ready || !userId) return;
    let alive = true;
    resolveServiceCity(curLat, curLng, curCity)
      .then((city) => {
        if (!alive || !city || city.trim().toLowerCase() === curCity.trim().toLowerCase()) return;
        setLoc((prev) => {
          if (prev.lat !== curLat || prev.lng !== curLng || prev.city !== curCity) return prev;
          const next = { ...prev, city };
          void AsyncStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ready, userId, curLat, curLng, curCity]);

  const value = useMemo<LocationContextValue>(
    () => ({ location, coords: { lat: location.lat, lng: location.lng }, ready, setLocation, locateWithGps }),
    [location, ready, setLocation],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelectedLocation(): LocationContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSelectedLocation must be used inside LocationProvider');
  return v;
}
