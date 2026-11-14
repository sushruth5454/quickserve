import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { Coords } from './apiTypes';
import { useAuth } from './auth';
import { forceTestLocation, isDemoMode } from './config';
import { DEFAULT_LOCATION, LAUNCH_CITY, LOCATION_STORAGE_KEY, parseStoredLocation, type SelectedLocation } from './locationModel';

export type GpsResult =
  | { ok: true; location: SelectedLocation }
  | { ok: false; reason: 'denied' | 'unavailable'; canAskAgain: boolean; message: string };

export interface PlaceResult {
  title: string;
  subtitle: string;
  location: SelectedLocation;
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

/** Address search uses the OS geocoder, which expo-location only provides on iOS/Android. */
export const placeSearchSupported = Platform.OS !== 'web';

export async function searchPlaces(query: string, city = LAUNCH_CITY): Promise<PlaceResult[]> {
  if (!placeSearchSupported) throw new Error('Address search is available in the mobile app.');
  const q = query.trim();
  if (q.length < 3) return [];
  const hits = await Location.geocodeAsync(q.toLowerCase().includes(city.toLowerCase()) ? q : `${q}, ${city}`);
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

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLoc] = useState<SelectedLocation>(DEFAULT_LOCATION);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = parseStoredLocation(await AsyncStorage.getItem(LOCATION_STORAGE_KEY).catch(() => null));
      if (!alive) return;
      if (stored) {
        setLoc(stored);
        setReady(true);
        return;
      }
      // First run: demo data and EXPO_PUBLIC_FORCE_TEST_LOCATION start at the launch-city default; otherwise try GPS.
      // Either way the user can change it from the picker.
      setReady(true);
      if (isDemoMode || forceTestLocation) return;
      const gps = await locateWithGps();
      if (alive && gps.ok) setLoc(gps.location);
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
