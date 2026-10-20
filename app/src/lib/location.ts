import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import type { Coords } from './api';
import { isDemoMode } from './config';

export interface LocationState {
  coords: Coords | null;
  city: string | null;
  /** Neighbourhood for the header ("Benz Circle"). */
  area: string | null;
  addressLine: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DEMO_LOCATION = {
  coords: { lat: 16.4995, lng: 80.656 },
  city: 'Vijayawada',
  area: 'Benz Circle',
  addressLine: 'Flat 302, Sai Residency, 4th Lane, Benz Circle',
};

export function useCurrentLocation(auto = true): LocationState {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [addressLine, setAddressLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        // Demo data is centred on Vijayawada; skip the OS permission prompt.
        setCoords(DEMO_LOCATION.coords);
        setCity(DEMO_LOCATION.city);
        setArea(DEMO_LOCATION.area);
        setAddressLine(DEMO_LOCATION.addressLine);
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Results are not sorted by distance.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(c);
      const [place] = await Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lng }).catch(() => []);
      if (place) {
        setCity(place.city ?? place.subregion ?? place.region ?? null);
        setArea(place.district ?? place.street ?? place.city ?? null);
        setAddressLine([place.name, place.street, place.district].filter(Boolean).join(', ') || null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  return { coords, city, area, addressLine, loading, error, refresh };
}
