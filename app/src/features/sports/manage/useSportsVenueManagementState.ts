import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSportsVenueSettingsVisibility,
  isSportsCapacityValid,
  resolveSportsVenuePaymentModes,
  type SportsBookingMode,
} from '../model';
import { useAppFeatureFlags } from '../../../lib/featureFlags';
import { useAuth } from '../../../lib/auth';
import { useSelectedLocation } from '../../../lib/locationContext';
import { supabase } from '../../../lib/supabase';
import type { Activity, ManagementVenue, Resource, SportsBookingRow } from './types';

const localTomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400000));

export function useSportsVenueManagementState() {
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
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [blockDate, setBlockDate] = useState(localTomorrow);
  const [blockStart, setBlockStart] = useState('12:00');
  const [blockEnd, setBlockEnd] = useState('13:00');
  const [blockReason, setBlockReason] = useState('Maintenance');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => venues.find((item) => item.venue.id === selectedId) ?? null, [selectedId, venues]);
  const resources: Resource[] = selected?.resources ?? [];
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
    setError(null);
    try {
      if (!enabled) {
        const bookingResult = await supabase.rpc('get_my_business_sports_bookings');
        if (bookingResult.error) throw new Error(bookingResult.error.message);
        setBookings((bookingResult.data ?? []) as SportsBookingRow[]);
        setVenues([]);
        setActivities([]);
        setSelectedId('');
        return;
      }
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

  useEffect(() => {
    setClosed(false);
  }, [weekday]);

  return {
    enabled, instantBookingEnabled, capacitySlotsEnabled, onlinePaymentsEnabled, location, userId,
    venues, setVenues, activities, setActivities, bookings, setBookings, selectedId, setSelectedId,
    resourceId, setResourceId, activityId, setActivityId, resourceName, setResourceName, slotMinutes,
    setSlotMinutes, bookingMode, setBookingMode, capacity, setCapacity, name, setName, description,
    setDescription, address, setAddress, city, setCity, area, setArea, lat, setLat, lng, setLng,
    amenities, setAmenities, photos, setPhotos, paymentModes, setPaymentModes, weekday, setWeekday,
    opens, setOpens, closes, setCloses, closed, setClosed, priceDay, setPriceDay, priceStart,
    setPriceStart, priceEnd, setPriceEnd, priceRupees, setPriceRupees, priceLabel, setPriceLabel,
    editingPriceId, setEditingPriceId, blockDate, setBlockDate, blockStart, setBlockStart,
    blockEnd, setBlockEnd, blockReason, setBlockReason, error, setError, busy, setBusy,
    selected, resources, selectedResource, settingsVisibility, capacityValid, load,
  };
}
