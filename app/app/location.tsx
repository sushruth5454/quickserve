import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { AddressEditorSheet, addressIcon } from '../src/components/AddressEditor';
import { Card, Divider, Header, InlineAlert, Input, LIST_INSET, Screen, Section, Skeleton, Text, useToast } from '../src/components/ui';
import { listMyAddresses } from '../src/lib/api';
import { placeSearchSupported, searchPlaces, useSelectedLocation, type PlaceResult } from '../src/lib/locationContext';
import {
  fromArea,
  fromSavedAddress,
  LAUNCH_CITY,
  POPULAR_AREAS,
  sameLocation,
  sortAddresses,
  type SelectedLocation,
} from '../src/lib/locationModel';
import type { SavedAddress } from '../src/lib/types';
import { useTheme } from '../src/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Swiggy / Urban Company style "Select location": search, GPS, saved addresses, popular areas. */
export default function LocationPicker() {
  const t = useTheme();
  const toast = useToast();
  const { location, setLocation, locateWithGps } = useSelectedLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [addrError, setAddrError] = useState<string | null>(null);
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
  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  // Debounced OS geocoder search (native only).
  useEffect(() => {
    const q = query.trim();
    setSearchError(null);
    if (!placeSearchSupported || q.length < 3) {
      setResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchPlaces(q)
        .then(setResults)
        .catch((e: Error) => setSearchError(e.message))
        .finally(() => setSearching(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [query]);

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
  const areas = q ? POPULAR_AREAS.filter((a) => a.name.toLowerCase().includes(q)) : POPULAR_AREAS;
  const savedMatches = (addresses ?? []).filter((a) => !q || `${a.label} ${a.line1} ${a.city}`.toLowerCase().includes(q));

  return (
    <Screen header={<Header title="Select location" subtitle="Where do you need the service?" />} gap={t.spacing.section}>
      <View style={{ gap: t.spacing.md }}>
        <Input
          leftIcon="search"
          placeholder="Search area, street or landmark"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for an area or address"
          right={
            query ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={20} color={t.colors.muted} />
              </Pressable>
            ) : null
          }
        />
        {q && !placeSearchSupported ? (
          <InlineAlert tone="neutral" icon="phone-portrait-outline" message="Street search works in the QuickServe app. Here, pick an area or a saved address." />
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
                <Text variant="calloutStrong">No matches for “{query.trim()}”</Text>
                <Text variant="footnote" color="muted">
                  Try a nearby landmark or pick an area below.
                </Text>
              </View>
            ) : (
              (results ?? []).map((r, i) => (
                <Fragment key={`${r.location.lat},${r.location.lng},${i}`}>
                  {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                  <Row icon="location-outline" title={r.title} subtitle={r.subtitle} onPress={() => choose(r.location)} />
                </Fragment>
              ))
            )}
          </Card>
        ) : null}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Card padding={0} gap={0}>
          <Row
            icon="locate"
            accent
            title="Use current location"
            subtitle={locating ? 'Finding you…' : 'Using GPS'}
            right={locating ? <ActivityIndicator color={t.colors.primary} /> : null}
            selected={location.source === 'gps'}
            onPress={() => void useGps()}
          />
        </Card>
        {gpsError ? (
          <InlineAlert
            tone="warning"
            message={gpsError.message}
            actionLabel={gpsError.settings ? 'Open Settings' : undefined}
            onAction={gpsError.settings ? () => void Linking.openSettings() : undefined}
          />
        ) : null}
      </View>

      <Section title="Saved addresses">
        <Card padding={0} gap={0}>
          {addrError && !addresses ? (
            <View style={{ padding: t.spacing.lg }}>
              <InlineAlert message={addrError} actionLabel="Retry" onAction={() => void loadAddresses()} />
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
                    badge={a.is_default ? 'Default' : undefined}
                    subtitle={`${a.line1}, ${a.city}`}
                    selected={sameLocation(location, l)}
                    onPress={() => choose(l)}
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
                title="Add new address"
                subtitle={addresses.length === 0 ? 'Save Home, Work and more for faster booking' : undefined}
                onPress={() => setEditorOpen(true)}
              />
            </>
          ) : null}
        </Card>
      </Section>

      <Section title={`Popular areas in ${LAUNCH_CITY}`}>
        <Card padding={0} gap={0}>
          {areas.length === 0 ? (
            <View style={{ padding: t.spacing.lg }}>
              <Text variant="footnote" color="muted">
                No popular area matches “{query.trim()}”.
              </Text>
            </View>
          ) : (
            areas.map((a, i) => {
              const l = fromArea(a);
              return (
                <Fragment key={a.name}>
                  {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                  <Row icon="business-outline" title={a.name} subtitle={LAUNCH_CITY} selected={sameLocation(location, l)} onPress={() => choose(l)} />
                </Fragment>
              );
            })
          )}
        </Card>
      </Section>

      <AddressEditorSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        pin={location}
        onSaved={(a) => {
          setEditorOpen(false);
          choose(fromSavedAddress(a), 'Address saved');
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!props.selected }}
      accessibilityLabel={[props.title, props.subtitle, props.selected ? 'selected' : null].filter(Boolean).join(', ')}
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        minHeight: 56,
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
      {props.right ?? (props.selected ? <Ionicons name="checkmark-circle" size={22} color={t.colors.primary} accessibilityElementsHidden /> : null)}
    </Pressable>
  );
}
