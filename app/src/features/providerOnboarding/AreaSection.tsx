import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Button, Card, Chip, InlineAlert, Input, ListItem, Screen, Stepper, Text, useToast } from '../../components/ui';
import { locateWithGps, placeSearchSupported, searchPlaces, useSelectedLocation, type PlaceResult } from '../../lib/locationContext';
import { LAUNCH_CITY, POPULAR_AREAS } from '../../lib/locationModel';
import { onboardingApi } from '../../lib/onboarding';
import { useTheme } from '../../theme';
import { FieldLabel, Intro, SectionFooter, type SectionProps } from './parts';

const RADIUS_PRESETS = [3, 5, 8, 10, 15];

interface Pin {
  lat: number;
  lng: number;
  area: string | null;
  city: string;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function AreaSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const selected = useSelectedLocation();
  const p = data.state.provider;
  const [pin, setPin] = useState<Pin | null>(p?.lat != null && p?.lng != null ? { lat: p.lat, lng: p.lng, area: p.base_area, city: p.city } : null);
  const [city, setCity] = useState(p?.city ?? '');
  const [radius, setRadius] = useState(p?.service_radius_km ?? 8);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [busy, setBusy] = useState<'gps' | 'search' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPlace = (l: { lat: number; lng: number; area: string | null; city: string }) => {
    setPin(l);
    if (l.city) setCity(l.city);
    setResults([]);
    setError(null);
  };

  const gps = async () => {
    setBusy('gps');
    const r = await locateWithGps();
    setBusy(null);
    // Without a reverse-geocoded name (e.g. web) keep the area empty rather than showing "Current location" publicly.
    if (r.ok) applyPlace({ lat: r.location.lat, lng: r.location.lng, area: r.location.source === 'gps' && r.location.area === 'Current location' ? null : r.location.area, city: r.location.city });
    else setError(r.message);
  };

  const search = async () => {
    setBusy('search');
    try {
      const r = await searchPlaces(query, city || LAUNCH_CITY);
      setResults(r);
      if (!r.length) setError('No places found. Try a nearby landmark.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const nearby = useMemo(() => {
    if (!pin) return [];
    if (city && city.toLowerCase() !== LAUNCH_CITY.toLowerCase()) return [];
    return POPULAR_AREAS.filter((a) => km(pin, a) <= radius).map((a) => a.name);
  }, [pin, radius, city]);

  const save = async () => {
    if (!pin) return setError('Set your base location.');
    if (!city.trim()) return setError('Enter your city.');
    setBusy('save');
    setError(null);
    try {
      await onboardingApi.saveServiceArea({ city: city.trim(), lat: pin.lat, lng: pin.lng, radiusKm: radius, areaName: pin.area });
      await reload();
      if (mode === 'edit') toast({ message: 'Service area saved', tone: 'success' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const area = Math.round(Math.PI * radius * radius);
  const selectedIsReal = selected.location.source !== 'default';

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={<SectionFooter primary={mode === 'wizard' ? 'Save & continue' : 'Save'} onPrimary={() => void save()} loading={busy === 'save'} disabled={!pin} onBack={onBack} />}
    >
      <Intro title="Where do you work?" subtitle="Set your base (home or shop). Customers within your radius can book you. Your exact location is never shown." />
      <InlineAlert message={error} />

      <Card gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Ionicons name={pin ? 'location' : 'location-outline'} size={22} color={pin ? t.colors.primary : t.colors.muted} />
          <View style={{ flex: 1 }}>
            <Text variant="calloutStrong">Base location</Text>
            <Text variant="footnote" color="muted">
              {pin ? `${pin.area ?? 'Pinned'}${pin.city ? `, ${pin.city}` : ''}` : 'Not set yet'}
            </Text>
          </View>
        </View>
        <Button title="Use my current location" leftIcon="navigate" variant="outline" onPress={() => void gps()} loading={busy === 'gps'} />
        {placeSearchSupported ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-end' }}>
            <Input placeholder="Search area or landmark" value={query} onChangeText={setQuery} leftIcon="search" containerStyle={{ flex: 1 }} onSubmitEditing={() => void search()} returnKeyType="search" />
            <Button title="Search" onPress={() => void search()} loading={busy === 'search'} disabled={query.trim().length < 3} />
          </View>
        ) : selectedIsReal ? (
          <Button
            title={`Use ${selected.location.area}, ${selected.location.city}`}
            variant="ghost"
            leftIcon="pin-outline"
            onPress={() => applyPlace({ lat: selected.location.lat, lng: selected.location.lng, area: selected.location.area, city: selected.location.city })}
          />
        ) : null}
        {results.map((r) => (
          <ListItem key={`${r.location.lat},${r.location.lng}`} icon="location-outline" title={r.title} subtitle={r.subtitle} onPress={() => applyPlace({ ...r.location, area: r.location.area })} />
        ))}
        {!pin && (!city || city.toLowerCase() === LAUNCH_CITY.toLowerCase()) ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="footnote" color="muted">
              Or pick the nearest area in {LAUNCH_CITY}:
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {POPULAR_AREAS.map((a) => (
                <Chip key={a.name} label={a.name} onPress={() => applyPlace({ lat: a.lat, lng: a.lng, area: a.name, city: LAUNCH_CITY })} />
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      <Input label="City" value={city} onChangeText={setCity} leftIcon="business-outline" maxLength={60} />

      <View style={{ gap: t.spacing.md }}>
        <FieldLabel hint="Most pros in a city choose 5–10 km. A bigger radius means more requests but longer travel.">How far will you travel?</FieldLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Stepper value={radius} min={1} max={50} onChange={setRadius} label="Service radius in km" />
          <Text variant="title3" tabular>
            {radius} km
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {RADIUS_PRESETS.map((r) => (
            <Chip key={r} label={`${r} km`} selected={radius === r} onPress={() => setRadius(r)} />
          ))}
        </View>
        <CoveragePreview radiusKm={radius} pinned={!!pin} />
        <Text variant="footnote" color="muted" align="center">
          Covers about {area.toLocaleString('en-IN')} km² around your base
          {nearby.length ? ` — including ${nearby.slice(0, 5).join(', ')}${nearby.length > 5 ? ` and ${nearby.length - 5} more` : ''}` : ''}.
        </Text>
      </View>
    </Screen>
  );
}

/** Schematic coverage preview: the circle grows with the radius against a fixed 50 km scale. */
function CoveragePreview({ radiusKm, pinned }: { radiusKm: number; pinned: boolean }) {
  const t = useTheme();
  const size = 220;
  const scale = (size / 2 - 8) / 25;
  const r = Math.max(6, Math.min(size / 2 - 4, radiusKm * scale));
  return (
    <Pressable accessible accessibilityLabel={`Coverage circle of ${radiusKm} kilometres`} style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 2} fill={t.colors.surfaceAlt} />
        <Line x1={0} y1={size / 2} x2={size} y2={size / 2} stroke={t.colors.border} strokeDasharray="4 4" />
        <Line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke={t.colors.border} strokeDasharray="4 4" />
        <Circle cx={size / 2} cy={size / 2} r={r} fill={t.colors.primarySoft} stroke={t.colors.primary} strokeWidth={2} />
        <Circle cx={size / 2} cy={size / 2} r={6} fill={pinned ? t.colors.primary : t.colors.muted} />
      </Svg>
    </Pressable>
  );
}
