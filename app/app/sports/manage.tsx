import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../src/components/ui';
import {
  getSportsVenueSettingsVisibility,
  isSportsCapacityValid,
  resolveSportsResourceSettings,
  resolveSportsVenuePaymentModes,
  resolveSportsVenuePaymentModesForSave,
  type SportsBookingMode,
  type SportsPaymentMode,
} from '../../src/features/sports/model';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { useAuth } from '../../src/lib/auth';
import { rupeesToPaise } from '../../src/lib/money';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

export {
  getSportsVenueSettingsVisibility,
  isSportsCapacityValid,
  resolveSportsResourceSettings,
  resolveSportsVenuePaymentModes,
  resolveSportsVenuePaymentModesForSave,
} from '../../src/features/sports/model';

interface Activity {
  id: string;
  name: string;
  slug: string;
}

interface Resource {
  id: string;
  name: string;
  activity_id: string;
  activity_name: string;
  slot_minutes: number;
  active: boolean;
  booking_mode?: SportsBookingMode;
  capacity?: number;
}

interface ManagementVenue {
  venue: {
    id: string;
    owner_id: string;
    business_role?: 'owner' | 'manager' | 'staff';
    name: string;
    description: string;
    address_line: string;
    city: string;
    area: string;
    lat: number;
    lng: number;
    amenities: string[];
    photos: string[];
    status: string;
    status_reason: string;
    payment_modes?: ('online' | 'pay_at_venue')[];
  };
  payout_account_status?: string | null;
  payout_account_ready?: boolean;
  resources: Resource[];
  hours: { weekday: number; opens: string; closes: string }[];
  price_rules: { id: string; resource_id: string; weekday: number | null; starts: string; ends: string; price_paise: number; label: string }[];
  blocks: { id: string; resource_id: string; starts_at: string; ends_at: string; reason: string }[];
}


interface SportsBookingRow {
  id: string;
  owner_id: string;
  venue_id: string;
  venue_name: string;
  resource_name: string;
  activity_name: string;
  customer_name: string;
  starts_at: string;
  status: string;
  price_paise: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const localTomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400000));

function slotLabel(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function toInstant(date: string, time: string): string | null {
  const parsed = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export default function SportsVenueManagementScreen() {
  const t = useTheme();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const instantBookingEnabled = flags.isOn('sports_instant_booking');
  const capacitySlotsEnabled = flags.isOn('sports_capacity_slots');
  const onlinePaymentsEnabled = flags.isOn('sports_online_payments');
  const { location } = useSelectedLocation();
  const { userId } = useAuth();
  const [venues, setVenues] = useState<ManagementVenue[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [bookings, setBookings] = useState<SportsBookingRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [resourceName, setResourceName] = useState('Court 1');
  const [slotMinutes, setSlotMinutes] = useState('60');
  const [bookingMode, setBookingMode] = useState<SportsBookingMode>('approval');
  const [capacity, setCapacity] = useState('1');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState(location.line1 ?? location.area);
  const [city, setCity] = useState(location.city);
  const [area, setArea] = useState(location.area);
  const [lat, setLat] = useState(String(location.lat));
  const [lng, setLng] = useState(String(location.lng));
  const [amenities, setAmenities] = useState('');
  const [photos, setPhotos] = useState('');
  const [paymentModes, setPaymentModes] = useState<('online' | 'pay_at_venue')[]>(['pay_at_venue']);
  const [weekday, setWeekday] = useState('1');
  const [opens, setOpens] = useState('08:00');
  const [closes, setCloses] = useState('20:00');
  const [closed, setClosed] = useState(false);
  const [priceDay, setPriceDay] = useState('all');
  const [priceStart, setPriceStart] = useState('08:00');
  const [priceEnd, setPriceEnd] = useState('20:00');
  const [priceRupees, setPriceRupees] = useState('');
  const [priceLabel, setPriceLabel] = useState('Standard');
  const [blockDate, setBlockDate] = useState(localTomorrow);
  const [blockStart, setBlockStart] = useState('12:00');
  const [blockEnd, setBlockEnd] = useState('13:00');
  const [blockReason, setBlockReason] = useState('Maintenance');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => venues.find((item) => item.venue.id === selectedId) ?? null, [selectedId, venues]);
  const resources = selected?.resources ?? [];
  const selectedResource = resources.find((item) => item.id === resourceId);
  const settingsVisibility = getSportsVenueSettingsVisibility({
    isVenueOwner: Boolean(selected && selected.venue.owner_id === userId),
    instantBookingEnabled,
    capacitySlotsEnabled,
    onlinePaymentsEnabled,
    payoutAccountReady: selected?.payout_account_ready === true,
  });
  const capacityValid = isSportsCapacityValid(capacity);

  const load = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    try {
      const [venueResult, activityResult, bookingResult] = await Promise.all([
        supabase.rpc('get_my_business_sports_venues'),
        supabase.rpc('list_sports_activities'),
        supabase.rpc('get_my_business_sports_bookings'),
      ]);
      if (venueResult.error) throw new Error(venueResult.error.message);
      if (activityResult.error) throw new Error(activityResult.error.message);
      if (bookingResult.error) throw new Error(bookingResult.error.message);
      const nextVenues = (venueResult.data ?? []) as ManagementVenue[];
      setVenues(nextVenues);
      setActivities((activityResult.data ?? []) as Activity[]);
      setBookings((bookingResult.data ?? []) as SportsBookingRow[]);
      setSelectedId((current) => nextVenues.some((item) => item.venue.id === current) ? current : nextVenues[0]?.venue.id ?? '');
      setActivityId((current) => activityResult.data?.some((item: Activity) => item.id === current) ? current : activityResult.data?.[0]?.id ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!selected) {
      setResourceId('');
      return;
    }
    setName(selected.venue.name);
    setDescription(selected.venue.description);
    setAddress(selected.venue.address_line);
    setCity(selected.venue.city);
    setArea(selected.venue.area);
    setLat(String(selected.venue.lat));
    setLng(String(selected.venue.lng));
    setAmenities(selected.venue.amenities.join(', '));
    setPhotos(selected.venue.photos.join('\n'));
    setResourceId((current) => selected.resources.some((item) => item.id === current) ? current : selected.resources[0]?.id ?? '');
  }, [selected]);

  useEffect(() => {
    const resource = selected?.resources.find((item) => item.id === resourceId);
    setBookingMode(resource?.booking_mode ?? 'approval');
    setCapacity(String(resource?.capacity ?? 1));
  }, [resourceId, selected]);

  useEffect(() => {
    setPaymentModes(resolveSportsVenuePaymentModes(
      selected?.venue.payment_modes,
    ));
  }, [selected, onlinePaymentsEnabled]);

  const saveVenue = async () => {
    const modesToSave = resolveSportsVenuePaymentModesForSave(
      selected?.venue.payment_modes,
      paymentModes,
      settingsVisibility.canSelectOnlinePayment,
    );
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('save_sports_venue', {
      p_id: selectedId || null,
      p_name: name.trim(),
      p_description: description.trim(),
      p_address_line: address.trim(),
      p_city: city.trim(),
      p_area: area.trim(),
      p_lat: Number(lat),
      p_lng: Number(lng),
      p_amenities: amenities.split(',').map((item) => item.trim()).filter(Boolean),
      p_photos: photos.split('\n').map((item) => item.trim()).filter(Boolean),
      p_payment_modes: modesToSave,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSelectedId(data as string);
    toast({ message: 'Venue details saved', tone: 'success' });
    await load();
  };

  const saveResource = async () => {
    if (!selectedId || !activityId) return;
    const resourceSettings = resolveSportsResourceSettings(
      bookingMode,
      capacity,
      instantBookingEnabled,
      capacitySlotsEnabled,
      selectedResource,
    );
    if (!isSportsCapacityValid(resourceSettings.capacity)) {
      setError('Capacity must be a whole number from 1 to 100.');
      return;
    }
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('save_sports_resource', {
      p_venue_id: selectedId,
      p_id: resourceId || null,
      p_activity_id: activityId,
      p_name: resourceName.trim(),
      p_slot_minutes: Number(slotMinutes),
      p_active: true,
      p_booking_mode: resourceSettings.bookingMode,
      p_capacity: resourceSettings.capacity,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setResourceId(data as string);
    toast({ message: 'Court/resource saved', tone: 'success' });
    await load();
  };

  const saveHours = async () => {
    if (!selectedId) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('set_sports_hours', {
      p_venue_id: selectedId,
      p_weekday: Number(weekday),
      p_opens: closed ? null : opens,
      p_closes: closed ? null : closes,
    });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else {
      toast({ message: 'Opening hours saved', tone: 'success' });
      await load();
    }
  };

  const savePrice = async () => {
    if (!resourceId) return;
    const price = rupeesToPaise(Number(priceRupees));
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('save_sports_price_rule', {
      p_resource_id: resourceId,
      p_id: null,
      p_weekday: priceDay === 'all' ? null : Number(priceDay),
      p_starts: priceStart,
      p_ends: priceEnd,
      p_price_paise: price,
      p_label: priceLabel.trim() || 'Standard',
    });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else {
      setPriceRupees('');
      toast({ message: 'Price rule added', tone: 'success' });
      await load();
    }
  };

  const addBlock = async () => {
    if (!resourceId) return;
    const startsAt = toInstant(blockDate, blockStart);
    const endsAt = toInstant(blockDate, blockEnd);
    if (!startsAt || !endsAt) {
      setError('Enter a valid block date and time.');
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('add_sports_block', {
      p_resource_id: resourceId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_reason: blockReason.trim(),
    });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else {
      toast({ message: 'Unavailable time added', tone: 'success' });
      await load();
    }
  };

  const removeBlock = async (id: string) => {
    const { error: rpcError } = await supabase.rpc('remove_sports_block', { p_id: id });
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const submitVenue = async () => {
    if (!selectedId) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('submit_sports_venue', { p_id: selectedId });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else {
      toast({ message: 'Venue submitted for review', tone: 'success' });
      await load();
    }
  };

  const togglePaymentMode = (mode: 'online' | 'pay_at_venue') => {
    setPaymentModes((current) => {
      if (current.includes(mode)) {
        const next = current.filter((item) => item !== mode);
        return next.length > 0 ? next : current;
      }
      return [...current, mode];
    });
  };

  const venueBookings = bookings.filter((booking) => booking.owner_id === selected?.venue.owner_id && booking.venue_id === selectedId);
  const myRequests = venueBookings.filter((booking) => booking.status === 'requested');

  if (selected && selected.venue.owner_id !== userId) {
    return (
      <Screen header={<Header title="Assigned sports bookings" subtitle={`${selected.venue.name} · read-only`} onBack={() => router.back()} />}>
        <Text variant="footnote" color="muted">Staff can view sports bookings. Only the venue owner can edit venue details, prices, hours, or respond to requests.</Text>
        <Button title="All assigned business work" variant="outline" onPress={() => router.push('/merchant-work')} />
        <Card gap={t.spacing.sm}>
          <Text variant="title3">Bookings</Text>
          {venueBookings.length === 0 ? (
            <EmptyState icon="calendar-outline" title="No bookings" message="Bookings for this venue will appear here." compact />
          ) : venueBookings.map((booking) => (
            <Pressable key={booking.id} onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
              <Text variant="footnoteStrong">{booking.customer_name || 'Customer'} · {booking.activity_name} / {booking.resource_name}</Text>
              <Text variant="caption" color="muted">{slotLabel(booking.starts_at)} · {booking.status.toUpperCase()}</Text>
            </Pressable>
          ))}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen header={<Header title="My sports venues" subtitle="Manage courts, hours, prices and requests" onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error && venues.length === 0 ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          {error ? <InlineAlert message={error} /> : null}
          {venues.length > 0 ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="subheadStrong">Your venues</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {venues.map((item) => (
                  <Pressable key={item.venue.id} onPress={() => setSelectedId(item.venue.id)}>
                    <Card padding={t.spacing.md} variant={item.venue.id === selectedId ? 'tinted' : 'outlined'}>
                      <Text variant="footnoteStrong">{item.venue.name}</Text>
                      <Text variant="caption" color="muted">{item.venue.status.toUpperCase()}</Text>
                    </Card>
                  </Pressable>
                ))}
              </View>
              <Button title="Create another venue" variant="outline" onPress={() => {
                setSelectedId('');
                setName('');
                setDescription('');
                setAddress(location.line1 ?? location.area);
                setCity(location.city);
                setArea(location.area);
                setLat(String(location.lat));
                setLng(String(location.lng));
                setAmenities('');
                setPhotos('');
                setResourceId('');
              }} />
              {selected?.venue.owner_id === userId ? (
                <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} />
              ) : null}
            </View>
          ) : null}

          <Card gap={t.spacing.sm}>
            <Text variant="title3">{selected ? 'Venue details' : 'Create a venue'}</Text>
            {selected ? (
              <Text variant="footnoteStrong" color={selected.venue.status === 'verified' ? 'successText' : 'muted'}>
                Status: {selected.venue.status.toUpperCase()}{selected.venue.status_reason ? ` · ${selected.venue.status_reason}` : ''}
              </Text>
            ) : null}
            <Input label="Venue name" value={name} onChangeText={setName} maxLength={120} />
            <TextArea label="Description" value={description} onChangeText={setDescription} maxLength={2000} />
            <Input label="Address" value={address} onChangeText={setAddress} maxLength={300} />
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Input label="City" value={city} onChangeText={setCity} maxLength={80} containerStyle={{ flex: 1 }} />
              <Input label="Area" value={area} onChangeText={setArea} maxLength={80} containerStyle={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Input label="Latitude" value={lat} onChangeText={setLat} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
              <Input label="Longitude" value={lng} onChangeText={setLng} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
            </View>
            <Input label="Amenities (comma separated)" value={amenities} onChangeText={setAmenities} placeholder="Parking, changing room" />
            <TextArea label="Photo URLs (one HTTPS URL per line)" value={photos} onChangeText={setPhotos} maxLength={3000} />
            {selected && settingsVisibility.showPaymentModes ? (
              <View style={{ gap: t.spacing.sm }}>
                <Text variant="subheadStrong">Accepted payment modes</Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: paymentModes.includes('pay_at_venue') }}
                  onPress={() => togglePaymentMode('pay_at_venue')}
                >
                  <Card padding={t.spacing.md} variant={paymentModes.includes('pay_at_venue') ? 'tinted' : 'outlined'}>
                    <Text variant="footnoteStrong">Pay at venue</Text>
                  </Card>
                </Pressable>
                {!settingsVisibility.showOnlinePaymentOption ? (
                  <View style={{ gap: t.spacing.xs }}>
                    <Text variant="footnoteStrong">Online payment (read-only)</Text>
                    <Text variant="caption" color="muted">
                      {selected.venue.payment_modes?.includes('online')
                        ? 'Online payment is configured but unavailable to edit right now. Saving venue details preserves this setting.'
                        : 'Online payment cannot be selected while the feature is unavailable.'}
                    </Text>
                  </View>
                ) : null}
                {settingsVisibility.showOnlinePaymentOption ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: paymentModes.includes('online'), disabled: !settingsVisibility.canSelectOnlinePayment }}
                    disabled={!settingsVisibility.canSelectOnlinePayment}
                    onPress={() => togglePaymentMode('online')}
                  >
                    <Card padding={t.spacing.md} variant={paymentModes.includes('online') ? 'tinted' : 'outlined'}>
                      <Text variant="footnoteStrong">Pay online</Text>
                      {!settingsVisibility.canSelectOnlinePayment ? (
                        <Text variant="caption" color="muted">Available after the venue owner’s payout account is verified.</Text>
                      ) : null}
                    </Card>
                  </Pressable>
                ) : null}
                {settingsVisibility.showPayoutStatus ? (
                  <View style={{ gap: t.spacing.xs }}>
                    <Text variant="caption" color={selected?.payout_account_ready ? 'successText' : 'muted'}>
                      Payout account: {selected?.payout_account_ready ? 'Ready' : 'Not ready'}
                    </Text>
                    {settingsVisibility.showPayoutSetup ? (
                      <Button
                        title="Set up payout account"
                        variant="outline"
                        onPress={() => router.push({
                          pathname: '/provider-profile/[section]',
                          params: { section: 'payouts', returnTo: 'hub' },
                        })}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Button
              title={selected && settingsVisibility.showPaymentModes ? 'Save venue & payment settings' : 'Save venue details'}
              onPress={() => void saveVenue()}
              loading={busy}
              disabled={busy || name.trim().length < 2}
            />
            {selected && selected.venue.status !== 'suspended' ? (
              <Button title="Submit for verification" variant="outline" onPress={() => void submitVenue()} loading={busy} disabled={busy} />
            ) : null}
          </Card>

          {selectedId ? (
            <>
              <Card gap={t.spacing.sm}>
                <Text variant="title3">Courts and resources</Text>
                {resources.map((item) => (
                  <Pressable key={item.id} onPress={() => {
                    setResourceId(item.id);
                    setActivityId(item.activity_id);
                    setResourceName(item.name);
                    setSlotMinutes(String(item.slot_minutes));
                  }}>
                    <Text variant="footnoteStrong" color={item.id === resourceId ? 'primaryText' : 'text'}>
                      {item.activity_name} · {item.name} · {item.slot_minutes} min
                    </Text>
                  </Pressable>
                ))}
                <Text variant="subheadStrong">{resourceId ? 'Edit selected resource' : 'Add a resource'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                  {activities.map((item) => (
                    <Pressable key={item.id} onPress={() => setActivityId(item.id)}>
                      <Card padding={t.spacing.sm} variant={item.id === activityId ? 'tinted' : 'outlined'}>
                        <Text variant="captionStrong">{item.name}</Text>
                      </Card>
                    </Pressable>
                  ))}
                </View>
                <Input label="Court/resource name" value={resourceName} onChangeText={setResourceName} maxLength={80} />
                <Input label="Slot length (30, 60, 90 or 120 minutes)" value={slotMinutes} onChangeText={setSlotMinutes} keyboardType="number-pad" />
                {settingsVisibility.canEditBookingMode ? (
                  <View style={{ gap: t.spacing.xs }}>
                    <Text variant="footnoteStrong">Booking mode</Text>
                    <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                      {(['approval', 'instant'] as const).map((mode) => (
                        <Pressable
                          key={mode}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: bookingMode === mode }}
                          onPress={() => setBookingMode(mode)}
                          style={{ flex: 1 }}
                        >
                          <Card padding={t.spacing.md} variant={bookingMode === mode ? 'tinted' : 'outlined'}>
                            <Text variant="footnoteStrong">{mode === 'instant' ? 'Instant booking' : 'Venue approval'}</Text>
                            <Text variant="caption" color="muted">
                              {mode === 'instant' ? 'Confirm available bookings right away.' : 'Review each request before confirming.'}
                            </Text>
                          </Card>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={{ gap: t.spacing.xs }}>
                    <Text variant="footnoteStrong">Booking mode (read-only)</Text>
                    <Text variant="caption" color="muted">
                      Current setting: {selectedResource?.booking_mode === 'instant' ? 'Instant booking' : 'Venue approval'}.
                      {' '}{selectedResource
                        ? 'Instant booking is unavailable right now; saving other resource details preserves this setting.'
                        : 'New resources use venue approval until instant booking is available.'}
                    </Text>
                  </View>
                )}
                {settingsVisibility.canEditCapacity ? (
                  <Input
                    label="Participant capacity (1–100)"
                    value={capacity}
                    onChangeText={setCapacity}
                    keyboardType="number-pad"
                  />
                ) : (
                  <View style={{ gap: t.spacing.xs }}>
                    <Text variant="footnoteStrong">Participant capacity (read-only)</Text>
                    <Text variant="caption" color="muted">
                      Current setting: {selectedResource?.capacity ?? 1}.
                      {' '}{selectedResource
                        ? 'Capacity editing is unavailable right now; saving other resource details preserves this setting.'
                        : 'New resources use capacity 1 until capacity editing is available.'}
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Button title="Save resource" onPress={() => void saveResource()} loading={busy} disabled={busy || !activityId || (capacitySlotsEnabled && !capacityValid)} style={{ flex: 1 }} />
                  <Button title="Add new" variant="outline" onPress={() => {
                    setResourceId('');
                    setResourceName('Court');
                    setSlotMinutes('60');
                    setBookingMode('approval');
                    setCapacity('1');
                  }} style={{ flex: 1 }} />
                </View>
              </Card>

              {resourceId ? (
                <>
                  <Card gap={t.spacing.sm}>
                    <Text variant="title3">Opening hours</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                      {WEEKDAYS.map((day, index) => (
                        <Button key={day} title={day.slice(0, 3)} size="sm" variant={weekday === String(index) ? 'secondary' : 'outline'} onPress={() => setWeekday(String(index))} />
                      ))}
                    </View>
                    {closed ? (
                      <Button title="Closed — tap to set hours" variant="outline" onPress={() => setClosed(false)} />
                    ) : (
                      <>
                        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                          <Input label="Opens (24-hour time)" value={opens} onChangeText={setOpens} containerStyle={{ flex: 1 }} />
                          <Input label="Closes (24-hour time)" value={closes} onChangeText={setCloses} containerStyle={{ flex: 1 }} />
                        </View>
                        <Button title="Set closed for this day" variant="ghost" onPress={() => {
                          setClosed(true);
                          void supabase.rpc('set_sports_hours', { p_venue_id: selectedId, p_weekday: Number(weekday), p_opens: null, p_closes: null }).then(({ error: rpcError }) => {
                            if (rpcError) setError(rpcError.message);
                            else void load();
                          });
                        }} />
                      </>
                    )}
                    <Button title="Save opening hours" onPress={() => void saveHours()} loading={busy} disabled={busy || closed} />
                    <View style={{ gap: 4 }}>
                      {selected?.hours.map((row) => (
                        <Text key={row.weekday} variant="caption" color="muted">{WEEKDAYS[row.weekday]} · {row.opens.slice(0, 5)}–{row.closes.slice(0, 5)}</Text>
                      ))}
                    </View>
                  </Card>

                  <Card gap={t.spacing.sm}>
                    <Text variant="title3">Prices (₹ per slot)</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                      <Button title="Every day" size="sm" variant={priceDay === 'all' ? 'secondary' : 'outline'} onPress={() => setPriceDay('all')} />
                      {WEEKDAYS.map((day, index) => (
                        <Button key={day} title={day.slice(0, 3)} size="sm" variant={priceDay === String(index) ? 'secondary' : 'outline'} onPress={() => setPriceDay(String(index))} />
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                      <Input label="From" value={priceStart} onChangeText={setPriceStart} containerStyle={{ flex: 1 }} />
                      <Input label="Until" value={priceEnd} onChangeText={setPriceEnd} containerStyle={{ flex: 1 }} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                      <Input label="Price" prefix="₹" value={priceRupees} onChangeText={setPriceRupees} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
                      <Input label="Label" value={priceLabel} onChangeText={setPriceLabel} containerStyle={{ flex: 1 }} />
                    </View>
                    <Button title="Add price rule" onPress={() => void savePrice()} loading={busy} disabled={busy || rupeesToPaise(Number(priceRupees)) <= 0} />
                    <View style={{ gap: 4 }}>
                      {selected?.price_rules.filter((row) => row.resource_id === resourceId).map((row) => (
                        <Text key={row.id} variant="caption" color="muted">
                          {row.label} · {row.weekday == null ? 'Every day' : WEEKDAYS[row.weekday]} · {row.starts.slice(0, 5)}–{row.ends.slice(0, 5)} · ₹{(row.price_paise / 100).toFixed(2)}
                        </Text>
                      ))}
                    </View>
                  </Card>

                  <Card gap={t.spacing.sm}>
                    <Text variant="title3">Unavailable times</Text>
                    <Input label="Date (YYYY-MM-DD)" value={blockDate} onChangeText={setBlockDate} autoCapitalize="none" />
                    <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                      <Input label="From" value={blockStart} onChangeText={setBlockStart} containerStyle={{ flex: 1 }} />
                      <Input label="Until" value={blockEnd} onChangeText={setBlockEnd} containerStyle={{ flex: 1 }} />
                    </View>
                    <Input label="Reason" value={blockReason} onChangeText={setBlockReason} maxLength={200} />
                    <Button title="Block time" variant="outline" onPress={() => void addBlock()} loading={busy} disabled={busy || blockEnd <= blockStart} />
                    {selected?.blocks.filter((row) => row.resource_id === resourceId).map((row) => (
                      <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                        <Text variant="caption" color="muted" style={{ flex: 1 }}>{slotLabel(row.starts_at)} · {row.reason || 'Unavailable'}</Text>
                        <Button title="Remove" variant="ghost" size="sm" onPress={() => void removeBlock(row.id)} />
                      </View>
                    ))}
                  </Card>
                </>
              ) : null}

              <Card gap={t.spacing.sm}>
                <Text variant="title3">Booking requests</Text>
                {myRequests.length === 0 ? (
                  <EmptyState icon="mail-outline" title="No pending requests" message="New customer requests will appear here." compact />
                ) : myRequests.map((booking) => (
                  <Pressable key={booking.id} onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
                    <Text variant="footnoteStrong">{booking.customer_name || 'Customer'} · {booking.activity_name} / {booking.resource_name}</Text>
                    <Text variant="caption" color="muted">{slotLabel(booking.starts_at)} · ₹{(booking.price_paise / 100).toFixed(2)} · Respond by opening request</Text>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
