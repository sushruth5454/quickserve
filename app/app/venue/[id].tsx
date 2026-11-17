import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../src/components/ui';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { formatINR } from '../../src/lib/money';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

interface Resource {
  id: string;
  name: string;
  activity_name: string;
  slot_minutes: number;
}

interface SportsVenue {
  id: string;
  name: string;
  description: string;
  address_line: string;
  city: string;
  area: string;
  amenities: string[];
  photos: string[];
  resources: Resource[];
}

interface SportsSlot {
  starts_at: string;
  ends_at: string;
  state: 'free' | 'taken' | 'blocked' | 'past';
  price_paise: number | null;
}

function indiaDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function formatSlot(value: string) {
  return new Date(value).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SportsVenueScreen() {
  const t = useTheme();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const { id } = useLocalSearchParams<{ id: string }>();
  const [venue, setVenue] = useState<SportsVenue | null>(null);
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState(() => indiaDate(1));
  const [slots, setSlots] = useState<SportsSlot[] | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resource = useMemo(() => venue?.resources.find((item) => item.id === resourceId) ?? venue?.resources[0], [resourceId, venue]);

  const loadVenue = useCallback(async () => {
    if (!enabled || !id) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_sports_venue', { p_id: id });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (!data) {
      setVenue(null);
      setError('This venue is not available.');
      return;
    }
    const next = data as SportsVenue;
    setVenue(next);
    setResourceId((current) => next.resources.some((item) => item.id === current) ? current : next.resources[0]?.id ?? '');
  }, [enabled, id]);

  const loadSlots = useCallback(async () => {
    if (!enabled || !resource?.id || !date) return;
    setError(null);
    setSlots(null);
    setSelectedStart(null);
    const { data, error: rpcError } = await supabase.rpc('get_sports_slots', {
      p_resource_id: resource.id,
      p_date: date,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSlots((data ?? []) as SportsSlot[]);
  }, [date, enabled, resource?.id]);

  useFocusEffect(useCallback(() => { void loadVenue(); }, [loadVenue]));
  useEffect(() => { void loadSlots(); }, [loadSlots]);

  const request = async () => {
    if (!resource || !selectedStart || loading) return;
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('request_sports_slot', {
      p_resource_id: resource.id,
      p_starts_at: selectedStart,
      p_slots: 1,
      p_note: note.trim(),
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast({ message: 'Request sent. The venue owner will respond shortly.', tone: 'success' });
    router.replace(`/sports-booking/${data as string}` as Href);
  };

  return (
    <Screen header={<Header title={venue?.name ?? 'Sports venue'} subtitle={venue ? `${venue.area}, ${venue.city}` : undefined} onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error && !venue ? (
        <ErrorState message={error} onRetry={() => void loadVenue()} />
      ) : !venue ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          {venue.photos?.length ? (
            <View style={{ gap: t.spacing.sm }}>
              {venue.photos.map((uri) => (
                <Image key={uri} source={{ uri }} contentFit="cover" style={{ height: 190, borderRadius: t.radii.lg }} />
              ))}
            </View>
          ) : null}
          <Card gap={t.spacing.sm}>
            <Text variant="title3">{venue.name}</Text>
            <Text variant="footnote" color="muted">{venue.address_line} · {venue.area}, {venue.city}</Text>
            {venue.description ? <Text variant="callout" color="textSecondary">{venue.description}</Text> : null}
            {venue.amenities?.length ? <Text variant="footnote">Amenities · {venue.amenities.join(' · ')}</Text> : null}
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Choose an activity and slot</Text>
            {venue.resources.length ? (
              <View style={{ gap: t.spacing.sm }}>
                {venue.resources.map((item) => {
                  const selected = item.id === resource?.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setResourceId(item.id)}
                      style={{
                        padding: t.spacing.md,
                        borderRadius: t.radii.md,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? t.colors.primary : t.colors.border,
                        backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
                      }}
                    >
                      <Text variant="calloutStrong">{item.activity_name} · {item.name}</Text>
                      <Text variant="caption" color="muted">{item.slot_minutes}-minute slots</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <EmptyState icon="calendar-outline" title="No active courts" message="This venue is not taking requests right now." compact />
            )}
            {resource ? (
              <>
                <Input
                  label="Date"
                  value={date}
                  onChangeText={(value) => setDate(value.trim())}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  helper="Choose a date within the next 30 days."
                />
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Button title="Today" variant="outline" size="sm" onPress={() => setDate(indiaDate())} />
                  <Button title="Tomorrow" variant="outline" size="sm" onPress={() => setDate(indiaDate(1))} />
                  <Button title="Next day" variant="outline" size="sm" onPress={() => setDate(indiaDate(2))} />
                </View>
                {!slots ? (
                  <Skeleton height={88} radius={t.radii.md} />
                ) : slots.filter((slot) => slot.state === 'free').length === 0 ? (
                  <EmptyState icon="time-outline" title="No free slots" message="Choose another date or court." compact />
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                    {slots.filter((slot) => slot.state === 'free').map((slot) => {
                      const selected = slot.starts_at === selectedStart;
                      return (
                        <Pressable
                          key={slot.starts_at}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          onPress={() => setSelectedStart(slot.starts_at)}
                          style={{
                            minWidth: 112,
                            padding: t.spacing.sm,
                            borderRadius: t.radii.md,
                            borderWidth: selected ? 2 : 1,
                            borderColor: selected ? t.colors.primary : t.colors.border,
                            backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
                          }}
                        >
                          <Text variant="footnoteStrong">{formatSlot(slot.starts_at)}</Text>
                          {slot.price_paise != null ? <Text variant="caption" color="muted">{formatINR(slot.price_paise)}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            ) : null}
            <TextArea label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} placeholder="Anything the venue should know?" />
            <InlineAlert message={error && venue ? error : null} />
            <InlineAlert
              tone="info"
              title="Pay at the venue"
              message="This is a booking request only. No online payment is collected by QuickServe."
            />
            <Button
              title="Request booking"
              onPress={() => void request()}
              loading={loading}
              disabled={!resource || !selectedStart || loading}
              fullWidth
              leftIcon="calendar-outline"
            />
          </Card>
        </>
      )}
    </Screen>
  );
}
