import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { AddressEditorSheet, addressIcon } from '../src/components/AddressEditor';
import { Card, Divider, Header, IconButton, InlineAlert, Input, LIST_INSET, Screen, Section, Skeleton, Text, useConfirm, useToast } from '../src/components/ui';
import { deleteAddress, listMyAddresses } from '../src/lib/api';
import { isAreaPickerEnabled, listAreas } from '../src/lib/geographyApi';
import { placeSearchSupported, resolvePlace, searchPlaces, useSelectedLocation, type PlaceResult } from '../src/lib/locationContext';
import { newPlacesSession } from '../src/lib/places';
import {
  fromManagedArea,
  fromSavedAddress,
  sameLocation,
  sortAddresses,
  DEFAULT_LOCATION,
  type ManagedArea,
  type SelectedLocation,
} from '../src/lib/locationModel';
import type { SavedAddress } from '../src/lib/types';
import { useT } from '../src/i18n';
import { useTheme } from '../src/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Swiggy / Urban Company style "Select location": search, GPS, saved addresses, popular areas. */
export default function LocationPicker() {
  const t = useTheme();
  const tr = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { location, setLocation, locateWithGps } = useSelectedLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [areaPickerEnabled, setAreaPickerEnabled] = useState(false);
  const [managedAreas, setManagedAreas] = useState<ManagedArea[]>([]);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<{ message: string; settings: boolean } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadAddresses = useCallback(async () => {
    setAddrError(null);
    try {
      setAddresses(sortAddresses(await listMyAddresses()));
    } catch (e) {
      setAddrError((e as Error).message);
    }
  }, []);

  const removeAddress = async (address: SavedAddress) => {
    const confirmed = await confirm({
      title: 'Delete this address?',
      message: `Remove ${address.label} from saved addresses?`,
      confirmLabel: 'Delete',
      destructive: true,
      icon: 'trash-outline',
    });
    if (!confirmed) return;
    try {
      await deleteAddress(address.id);
      if (location.addressId === address.id) setLocation(DEFAULT_LOCATION);
      await loadAddresses();
      toast({ message: 'Address deleted', tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };
  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setAreasError(null);
      try {
        const enabled = await isAreaPickerEnabled();
        if (!alive) return;
        setAreaPickerEnabled(enabled);
        if (!enabled) {
          setManagedAreas([]);
          return;
        }
        const rows = await listAreas();
        if (alive) setManagedAreas(rows);
      } catch (e) {
        if (alive) setAreasError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Debounced place search (Google Places, falling back to the phone's geocoder). One session token covers the
  // suggestions typed and the place finally picked.
  const sessionRef = useRef(newPlacesSession());
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    setSearchError(null);
    if (!placeSearchSupported || q.length < 3) {
      setResults(null);
      return;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      searchPlaces(q, null, { sessionToken: sessionRef.current, near: { lat: location.lat, lng: location.lng } })
        .then((r) => alive && setResults(r))
        .catch((e: Error) => alive && setSearchError(e.message))
        .finally(() => alive && setSearching(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // The bias point is read when typing; re-searching on every location change is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pickResult = async (r: PlaceResult, key: string) => {
    setPicking(key);
    setSearchError(null);
    try {
      const l = await resolvePlace(r, sessionRef.current);
      sessionRef.current = newPlacesSession();
      choose(l);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setPicking(null);
    }
  };

  const choose = (l: SelectedLocation, message?: string) => {
    setLocation(l);
    if (message) toast({ message, tone: 'success' });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const useGps = async () => {
    setLocating(true);
    setGpsError(null);
    const r = await locateWithGps();
    setLocating(false);
    if (r.ok) choose(r.location);
    else setGpsError({ message: r.message, settings: r.reason === 'denied' && !r.canAskAgain });
  };

  const q = query.trim().toLowerCase();
  const areaGroups = managedAreas
    .filter((area) => !q || `${area.name} ${area.city}`.toLowerCase().includes(q))
    .reduce<Record<string, ManagedArea[]>>((groups, area) => {
      (groups[area.city] ??= []).push(area);
      return groups;
    }, {});
  const savedMatches = (addresses ?? []).filter((a) => !q || `${a.label} ${a.line1} ${a.city}`.toLowerCase().includes(q));

  return (
    <Screen header={<Header title={tr('location.title')} subtitle={tr('location.subtitle')} />} gap={t.spacing.section}>
      <View style={{ gap: t.spacing.md }}>
        <Input
          leftIcon="search"
          placeholder={tr('location.search.placeholder')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={tr('location.search.accessibility')}
          right={
            query ? (
              <Pressable accessibilityRole="button" accessibilityLabel={tr('location.search.clear')} hitSlop={10} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={20} color={t.colors.muted} />
              </Pressable>
            ) : null
          }
        />
        {q && !placeSearchSupported ? (
          <InlineAlert tone="neutral" icon="phone-portrait-outline" message={tr('location.search.unavailable')} />
        ) : null}
        {placeSearchSupported && q.length >= 3 ? (
          <Card padding={0} gap={0}>
            {searching ? (
              <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="50%" height={12} />
              </View>
            ) : searchError ? (
              <View style={{ padding: t.spacing.lg }}>
                <InlineAlert message={searchError} />
              </View>
            ) : results && results.length === 0 ? (
              <View style={{ padding: t.spacing.lg, gap: 2 }}>
                <Text variant="calloutStrong">{tr('location.search.noMatches', { query: query.trim() })}</Text>
                <Text variant="footnote" color="muted">
                  {tr('location.search.tryNearby')}
                </Text>
              </View>
            ) : (
              (results ?? []).map((r, i) => {
                const key = `${r.placeId ?? `${r.location?.lat},${r.location?.lng}`},${i}`;
                return (
                  <Fragment key={key}>
                    {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                    <Row
                      icon={picking === key ? 'hourglass-outline' : 'location-outline'}
                      title={r.title}
                      subtitle={r.subtitle}
                      onPress={() => void pickResult(r, key)}
                    />
                  </Fragment>
                );
              })
            )}
            {results?.some((r) => r.placeId) ? (
              <Text variant="caption" color="muted" style={{ textAlign: 'right', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm }}>
                {tr('location.search.poweredByGoogle')}
              </Text>
            ) : null}
          </Card>
        ) : null}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Card padding={0} gap={0}>
          <Row
            icon="locate"
            accent
            title={tr('location.current.title')}
            subtitle={locating ? tr('location.current.finding') : tr('location.current.usingGps')}
            right={locating ? <ActivityIndicator color={t.colors.primary} /> : null}
            selected={location.source === 'gps'}
            onPress={() => void useGps()}
          />
        </Card>
        {gpsError ? (
          <InlineAlert
            tone="warning"
            message={gpsError.message}
            actionLabel={gpsError.settings ? tr('location.openSettings') : undefined}
            onAction={gpsError.settings ? () => void Linking.openSettings() : undefined}
          />
        ) : null}
      </View>

      <Section title={tr('location.savedAddresses')}>
        <Card padding={0} gap={0}>
          {addrError && !addresses ? (
            <View style={{ padding: t.spacing.lg }}>
              <InlineAlert message={addrError} actionLabel={tr('location.retry')} onAction={() => void loadAddresses()} />
            </View>
          ) : !addresses ? (
            [0, 1].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: t.spacing.md, padding: t.spacing.lg, alignItems: 'center' }}>
                <Skeleton width={32} height={32} radius={t.radii.sm} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width="30%" height={14} />
                  <Skeleton width="80%" height={12} />
                </View>
              </View>
            ))
          ) : (
            savedMatches.map((a, i) => {
              const l = fromSavedAddress(a);
              return (
                <Fragment key={a.id}>
                  {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                  <Row
                    icon={addressIcon(a.label)}
                    title={a.label}
                    badge={a.is_default ? tr('location.default') : undefined}
                    subtitle={`${a.line1}, ${a.city}`}
                    selected={sameLocation(location, l)}
                    onPress={() => choose(l)}
                    right={
                      <IconButton
                        icon="trash-outline"
                        variant="neutral"
                        size={18}
                        accessibilityLabel={`Delete ${a.label} address`}
                        onPress={() => void removeAddress(a)}
                      />
                    }
                  />
                </Fragment>
              );
            })
          )}
          {addresses ? (
            <>
              {savedMatches.length > 0 ? <Divider inset={LIST_INSET} /> : null}
              <Row
                icon="add"
                accent
                title={tr('location.addAddress.title')}
                subtitle={addresses.length === 0 ? tr('location.addAddress.subtitle') : undefined}
                onPress={() => setEditorOpen(true)}
              />
            </>
          ) : null}
        </Card>
      </Section>

      {areasError ? <InlineAlert tone="warning" message={`Managed areas are unavailable: ${areasError}`} /> : null}
      {areaPickerEnabled
        ? Object.entries(areaGroups).sort(([a], [b]) => a.localeCompare(b)).map(([city, areas]) => (
          <Section key={city} title={tr('location.popularAreas', { city })}>
            <Card padding={0} gap={0}>
              {areas.map((area, i) => {
                const selectedArea = fromManagedArea(area);
                return (
                  <Fragment key={area.id}>
                    {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                    <Row
                      icon="business-outline"
                      title={area.name}
                      subtitle={city}
                      selected={sameLocation(location, selectedArea)}
                      onPress={() => choose(selectedArea)}
                    />
                  </Fragment>
                );
              })}
            </Card>
          </Section>
        ))
        : null}

      <AddressEditorSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        pin={location}
        onSaved={(a) => {
          setEditorOpen(false);
          choose(fromSavedAddress(a), tr('location.addressSaved'));
        }}
      />
    </Screen>
  );
}

function Row(props: {
  icon: IconName;
  title: string;
  subtitle?: string;
  badge?: string;
  selected?: boolean;
  accent?: boolean;
  right?: ReactNode;
  onPress: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        minHeight: 56,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: !!props.selected }}
        accessibilityLabel={[props.title, props.subtitle, props.selected ? tr('location.selected') : null].filter(Boolean).join(', ')}
        onPress={props.onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.md,
          minHeight: 32,
          backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
        })}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: t.radii.sm,
            backgroundColor: props.accent ? t.colors.primarySoft : t.colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={props.icon} size={18} color={props.accent ? t.colors.primaryText : t.colors.textSecondary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <Text variant="body" color={props.accent ? 'primaryText' : 'text'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {props.title}
            </Text>
            {props.badge ? (
              <Text variant="captionStrong" color="muted">
                {props.badge}
              </Text>
            ) : null}
          </View>
          {props.subtitle ? (
            <Text variant="footnote" color="muted" numberOfLines={2}>
              {props.subtitle}
            </Text>
          ) : null}
        </View>
        {props.selected ? <Ionicons name="checkmark-circle" size={22} color={t.colors.primary} accessibilityElementsHidden /> : null}
      </Pressable>
      {props.right ? (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          {props.right}
        </View>
      ) : null}
    </View>
  );
}
