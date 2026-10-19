import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import type { Coords } from './api';

export interface LocationState {
  coords: Coords | null;
  city: string | null;
  addressLine: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCurrentLocation(auto = true): LocationState {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [addressLine, setAddressLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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

  return { coords, city, addressLine, loading, error, refresh };
}
