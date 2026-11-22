import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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

export interface VenueDraftValues {
  name: string;
  description: string;
  address: string;
  city: string;
  area: string;
  lat: string;
  lng: string;
  amenities: string;
  photos: string;
}

export interface ResourceDraftValues {
  activityId: string;
  resourceName: string;
  slotMinutes: string;
  bookingMode: SportsBookingMode;
  capacity: string;
}

export interface HoursDraftValues {
  opens: string;
  closes: string;
  closed: boolean;
}

export function getVenueDraftFromRecord(
  venue: ManagementVenue['venue'] | null,
  fallback: VenueDraftValues,
): VenueDraftValues {
  if (!venue) return fallback;
  return {
    name: venue.name,
    description: venue.description,
    address: venue.address_line,
    city: venue.city,
    area: venue.area,
    lat: String(venue.lat),
    lng: String(venue.lng),
    amenities: venue.amenities.join(', '),
    photos: venue.photos.join('\n'),
  };
}

export function mergeVenueDraftWithBaseline(
  baseline: VenueDraftValues,
  draft: VenueDraftValues,
  dirtyFields: ReadonlySet<keyof VenueDraftValues>,
): VenueDraftValues {
  const merged = { ...draft };
  (Object.keys(baseline) as (keyof VenueDraftValues)[]).forEach((field) => {
    if (!dirtyFields.has(field)) Object.assign(merged, { [field]: baseline[field] });
  });
  return merged;
}

export function getResourceDraftFromRecord(
  resource: Resource | null,
  fallbackActivityId: string,
  defaultName = 'Court 1',
): ResourceDraftValues {
  return resource
    ? {
        activityId: resource.activity_id,
        resourceName: resource.name,
        slotMinutes: String(resource.slot_minutes),
        bookingMode: resource.booking_mode ?? 'approval',
        capacity: String(resource.capacity ?? 1),
      }
    : {
        activityId: fallbackActivityId,
        resourceName: defaultName,
        slotMinutes: '60',
        bookingMode: 'approval',
        capacity: '1',
      };
}

export function mergeResourceDraftWithBaseline(
  baseline: ResourceDraftValues,
  draft: ResourceDraftValues,
  dirtyFields: ReadonlySet<keyof ResourceDraftValues>,
): ResourceDraftValues {
  const merged = { ...draft };
  (Object.keys(baseline) as (keyof ResourceDraftValues)[]).forEach((field) => {
    if (!dirtyFields.has(field)) Object.assign(merged, { [field]: baseline[field] });
  });
  return merged;
}

export function getHoursDraftFromRows(
  hours: readonly { weekday: number; opens: string; closes: string }[],
  weekday: number,
  hasLoaded: boolean,
  fallback: HoursDraftValues,
): HoursDraftValues {
  if (!hasLoaded) return fallback;
  const row = hours.find((item) => item.weekday === weekday);
  return row
    ? { opens: row.opens.slice(0, 5), closes: row.closes.slice(0, 5), closed: false }
    : { ...fallback, closed: true };
}

export function resolveSelectedVenueId(venues: readonly ManagementVenue[], currentId: string, preserveEmpty: boolean): string {
  if (preserveEmpty && currentId === '') return '';
  return venues.some((item) => item.venue.id === currentId) ? currentId : venues[0]?.venue.id ?? '';
}

export function isActualVenueOwner(venue: ManagementVenue['venue'] | null, userId: string | null): boolean {
  return Boolean(venue && userId && venue.owner_id === userId);
}

export function getManagementScreenMode(
  enabled: boolean,
  venue: ManagementVenue['venue'] | null,
  userId: string | null,
): 'existing-bookings' | 'owner' | 'assigned' | 'empty' {
  if (!enabled) return 'existing-bookings';
  if (!venue) return 'empty';
  return isActualVenueOwner(venue, userId) ? 'owner' : 'assigned';
}

export function getResourceSelectionContext(venueId: string, resourceId: string): string {
  return `${venueId}:${resourceId}`;
}

export function getBookingsForVenue(bookings: readonly SportsBookingRow[], venueId: string): SportsBookingRow[] {
  return venueId ? bookings.filter((booking) => booking.venue_id === venueId) : [];
}

export function getManagementLoadPresentation(
  initialLoading: boolean,
  hasLoaded: boolean,
  error: string | null,
): 'loading' | 'error' | 'ready' {
  if (initialLoading || (!hasLoaded && !error)) return 'loading';
  return hasLoaded ? 'ready' : 'error';
}

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
  const [selectedIdState, setSelectedIdState] = useState('');
  const selectedIdRef = useRef('');
  const [isCreatingVenue, setIsCreatingVenue] = useState(false);
  const isCreatingVenueRef = useRef(false);
  const [resourceId, setResourceIdState] = useState('');
  const newResourceDraftRef = useRef(false);
  const [venueDraft, setVenueDraft] = useState<VenueDraftValues>(() => ({
    name: '',
    description: '',
    address: location.line1 ?? location.area,
    city: location.city,
    area: location.area,
    lat: String(location.lat),
    lng: String(location.lng),
    amenities: '',
    photos: '',
  }));
  const [venueBaseline, setVenueBaseline] = useState<ManagementVenue['venue'] | null>(null);
  const venueDirtyFields = useRef(new Set<keyof VenueDraftValues>());
  const venueContext = useRef<string | null>(null);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraftValues>(() => ({
    activityId: '',
    resourceName: 'Court 1',
    slotMinutes: '60',
    bookingMode: 'approval',
    capacity: '1',
  }));
  const [resourceBaseline, setResourceBaseline] = useState<Resource | null>(null);
  const resourceDirtyFields = useRef(new Set<keyof ResourceDraftValues>());
  const resourceContext = useRef<string | null>(null);
  const [paymentModesState, setPaymentModesState] = useState<('online' | 'pay_at_venue')[]>(['pay_at_venue']);
  const paymentModesDirty = useRef(false);
  const paymentContext = useRef<string | null>(null);
  const [weekday, setWeekdayState] = useState('1');
  const [hoursDraft, setHoursDraft] = useState<HoursDraftValues>({ opens: '08:00', closes: '20:00', closed: false });
  const hoursDraftRef = useRef(hoursDraft);
  const [hoursBaseline, setHoursBaseline] = useState<{ weekday: number; opens: string; closes: string } | null>(null);
  const hoursDirtyFields = useRef(new Set<keyof HoursDraftValues>());
  const hoursContext = useRef<string | null>(null);
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadPromise = useRef<Promise<boolean> | null>(null);

  const selectedId = selectedIdState;
  const selected = useMemo(() => venues.find((item) => item.venue.id === selectedId) ?? null, [selectedId, venues]);
  const resources: Resource[] = selected?.resources ?? [];
  const selectedResource = resources.find((item) => item.id === resourceId) ?? null;

  const emptyVenueDraft = useCallback((): VenueDraftValues => ({
    name: '',
    description: '',
    address: location.line1 ?? location.area,
    city: location.city,
    area: location.area,
    lat: String(location.lat),
    lng: String(location.lng),
    amenities: '',
    photos: '',
  }), [location.area, location.city, location.lat, location.line1, location.lng]);

  const setVenueField = useCallback(<K extends keyof VenueDraftValues>(field: K, value: VenueDraftValues[K]) => {
    venueDirtyFields.current.add(field);
    setVenueDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const setResourceField = useCallback(<K extends keyof ResourceDraftValues>(field: K, value: ResourceDraftValues[K]) => {
    resourceDirtyFields.current.add(field);
    setResourceDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const setHoursField = useCallback(<K extends keyof HoursDraftValues>(field: K, value: HoursDraftValues[K]) => {
    hoursDirtyFields.current.add(field);
    const next = { ...hoursDraftRef.current, [field]: value };
    hoursDraftRef.current = next;
    setHoursDraft(next);
  }, []);

  const commitHoursDraft = useCallback((draft: HoursDraftValues) => {
    hoursDraftRef.current = draft;
    setHoursDraft(draft);
  }, []);

  const setSelectedId = useCallback((id: string) => {
    selectedIdRef.current = id;
    isCreatingVenueRef.current = false;
    setIsCreatingVenue(false);
    setSelectedIdState(id);
    newResourceDraftRef.current = false;
  }, []);

  const setResourceId = useCallback((id: string) => {
    newResourceDraftRef.current = false;
    setResourceIdState(id);
  }, []);

  const startNewVenue = useCallback(() => {
    const canCreate = isActualVenueOwner(selected?.venue ?? null, userId) || (hasLoaded && venues.length === 0);
    if (!canCreate) return;
    selectedIdRef.current = '';
    isCreatingVenueRef.current = true;
    venueContext.current = '__new__';
    venueDirtyFields.current.clear();
    setVenueBaseline(null);
    setVenueDraft(emptyVenueDraft());
    setSelectedIdState('');
    setIsCreatingVenue(true);
    newResourceDraftRef.current = false;
    setResourceIdState('');
  }, [emptyVenueDraft, hasLoaded, selected?.venue, userId, venues.length]);

  const startNewResource = useCallback(() => {
    if (!selectedId) return;
    newResourceDraftRef.current = true;
    const activity = resourceDraft.activityId || activities[0]?.id || '';
    const nextDraft: ResourceDraftValues = {
      activityId: activity,
      resourceName: 'Court',
      slotMinutes: '60',
      bookingMode: 'approval',
      capacity: '1',
    };
    resourceContext.current = `${selectedId}:`;
    resourceDirtyFields.current.clear();
    setResourceBaseline(null);
    setResourceDraft(nextDraft);
    setResourceIdState('');
  }, [activities, resourceDraft.activityId, selectedId]);

  const clearVenueDraftDirty = useCallback(() => {
    venueDirtyFields.current.clear();
    paymentModesDirty.current = false;
  }, []);
  const clearResourceDraftDirty = useCallback(() => resourceDirtyFields.current.clear(), []);
  const clearHoursDraftDirty = useCallback(() => hoursDirtyFields.current.clear(), []);

  const load = useCallback((): Promise<boolean> => {
    if (loadPromise.current) return loadPromise.current;
    if (!hasLoadedRef.current) setInitialLoading(true);
    setError(null);
    const request = (async () => {
      try {
        if (!enabled) {
          const bookingResult = await supabase.rpc('get_my_business_sports_bookings');
          if (bookingResult.error) throw new Error(bookingResult.error.message);
          setBookings((bookingResult.data ?? []) as SportsBookingRow[]);
          setVenues([]);
          setActivities([]);
          selectedIdRef.current = '';
          setSelectedIdState('');
          isCreatingVenueRef.current = false;
          setIsCreatingVenue(false);
          hasLoadedRef.current = true;
          setHasLoaded(true);
          return true;
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
        const nextSelectedId = resolveSelectedVenueId(nextVenues, selectedIdRef.current, isCreatingVenueRef.current);
        setVenues(nextVenues);
        setActivities((activityResult.data ?? []) as Activity[]);
        setBookings((bookingResult.data ?? []) as SportsBookingRow[]);
        selectedIdRef.current = nextSelectedId;
        setSelectedIdState(nextSelectedId);
        isCreatingVenueRef.current = isCreatingVenueRef.current && nextSelectedId === '';
        setIsCreatingVenue(isCreatingVenueRef.current);
        hasLoadedRef.current = true;
        setHasLoaded(true);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setInitialLoading(false);
      }
    })();
    loadPromise.current = request;
    void request.then(() => {
      if (loadPromise.current === request) loadPromise.current = null;
    });
    return request;
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!enabled) return;
    if (!selected && (!hasLoaded || selectedId !== '')) return;
    const nextContext = selected?.venue.id ?? '__new__';
    const changed = venueContext.current !== nextContext;
    const baseline = getVenueDraftFromRecord(selected?.venue ?? null, emptyVenueDraft());
    venueContext.current = nextContext;
    setVenueBaseline(selected?.venue ?? null);
    if (changed) {
      venueDirtyFields.current.clear();
      setVenueDraft(baseline);
    } else if (selected) {
      setVenueDraft((current) => mergeVenueDraftWithBaseline(baseline, current, venueDirtyFields.current));
    }
  }, [emptyVenueDraft, enabled, hasLoaded, selected, selectedId]);

  useEffect(() => {
    if (!selected || newResourceDraftRef.current) return;
    if (!resources.some((item) => item.id === resourceId)) {
      const nextId = resources[0]?.id ?? '';
      if (nextId !== resourceId) {
        setResourceIdState(nextId);
        return;
      }
    }
  }, [resourceId, resources, selected]);

  useEffect(() => {
    const nextContext = getResourceSelectionContext(selectedId, resourceId);
    const changed = resourceContext.current !== nextContext;
    const fallbackActivityId = resourceDraft.activityId || activities[0]?.id || '';
    const baseline = getResourceDraftFromRecord(selectedResource, fallbackActivityId);
    resourceContext.current = nextContext;
    setResourceBaseline(selectedResource);
    if (changed) {
      resourceDirtyFields.current.clear();
      if (selectedResource) setResourceDraft(baseline);
      else if (!newResourceDraftRef.current) {
        setResourceDraft(getResourceDraftFromRecord(null, fallbackActivityId));
      }
    } else if (selectedResource) {
      setResourceDraft((current) => mergeResourceDraftWithBaseline(baseline, current, resourceDirtyFields.current));
    } else if (!resourceDraft.activityId && activities[0]) {
      const firstActivity = activities[0];
      setResourceDraft((current) => ({ ...current, activityId: firstActivity.id }));
    }
  }, [activities, resourceDraft.activityId, resourceId, selectedId, selectedResource]);

  useEffect(() => {
    if (!enabled) return;
    const nextContext = selected?.venue.id ?? (selectedId === '' ? '__new__' : null);
    if (!nextContext) return;
    const changed = paymentContext.current !== nextContext;
    const nextModes = resolveSportsVenuePaymentModes(selected?.venue.payment_modes);
    paymentContext.current = nextContext;
    if (changed) {
      paymentModesDirty.current = false;
      setPaymentModesState(nextModes);
    } else if (!paymentModesDirty.current && selected) {
      setPaymentModesState(nextModes);
    }
  }, [enabled, selected, selectedId]);

  useEffect(() => {
    const nextContext = `${selectedId}:${weekday}`;
    const changed = hoursContext.current !== nextContext;
    if (changed) hoursDirtyFields.current.clear();
    hoursContext.current = nextContext;
    const baseline = selected?.hours.find((row) => row.weekday === Number(weekday)) ?? null;
    setHoursBaseline(baseline);
    if (!selected || !hasLoaded) {
      if (changed) commitHoursDraft({ opens: '08:00', closes: '20:00', closed: false });
      return;
    }
    const serverDraft = getHoursDraftFromRows(
      selected.hours,
      Number(weekday),
      hasLoaded,
      { opens: '08:00', closes: '20:00', closed: true },
    );
    if (changed) commitHoursDraft(serverDraft);
    else {
      const merged = { ...serverDraft };
      (Object.keys(serverDraft) as (keyof HoursDraftValues)[]).forEach((field) => {
        if (hoursDirtyFields.current.has(field)) Object.assign(merged, { [field]: hoursDraftRef.current[field] });
      });
      commitHoursDraft(merged);
    }
  }, [commitHoursDraft, enabled, hasLoaded, selected, selectedId, weekday]);

  useEffect(() => {
    const nextContext = getResourceSelectionContext(selectedId, resourceId);
    if (resourceContext.current !== nextContext) return;
    setEditingPriceId(null);
    setPriceDay('all');
    setPriceStart('08:00');
    setPriceEnd('20:00');
    setPriceRupees('');
    setPriceLabel('Standard');
  }, [resourceId, selectedId]);

  const settingsVisibility = getSportsVenueSettingsVisibility({
    isVenueOwner: isActualVenueOwner(selected?.venue ?? null, userId),
    instantBookingEnabled,
    capacitySlotsEnabled,
    onlinePaymentsEnabled,
    payoutAccountReady: selected?.payout_account_ready === true,
  });
  const capacityValid = isSportsCapacityValid(resourceDraft.capacity);

  const setPaymentModes: Dispatch<SetStateAction<('online' | 'pay_at_venue')[]>> = (value) => {
    paymentModesDirty.current = true;
    setPaymentModesState(value);
  };
  const setWeekday = (value: string) => setWeekdayState(value);

  return {
    enabled, instantBookingEnabled, capacitySlotsEnabled, onlinePaymentsEnabled, location, userId,
    venues, setVenues, activities, setActivities, bookings, setBookings, selectedId, setSelectedId,
    isCreatingVenue, startNewVenue, resourceId, setResourceId, startNewResource,
    activityId: resourceDraft.activityId, setActivityId: (value: string) => setResourceField('activityId', value),
    resourceName: resourceDraft.resourceName, setResourceName: (value: string) => setResourceField('resourceName', value),
    slotMinutes: resourceDraft.slotMinutes, setSlotMinutes: (value: string) => setResourceField('slotMinutes', value),
    bookingMode: resourceDraft.bookingMode, setBookingMode: (value: SportsBookingMode) => setResourceField('bookingMode', value),
    capacity: resourceDraft.capacity, setCapacity: (value: string) => setResourceField('capacity', value),
    resourceBaseline, clearResourceDraftDirty,
    name: venueDraft.name, setName: (value: string) => setVenueField('name', value),
    description: venueDraft.description, setDescription: (value: string) => setVenueField('description', value),
    address: venueDraft.address, setAddress: (value: string) => setVenueField('address', value),
    city: venueDraft.city, setCity: (value: string) => setVenueField('city', value),
    area: venueDraft.area, setArea: (value: string) => setVenueField('area', value),
    lat: venueDraft.lat, setLat: (value: string) => setVenueField('lat', value),
    lng: venueDraft.lng, setLng: (value: string) => setVenueField('lng', value),
    amenities: venueDraft.amenities, setAmenities: (value: string) => setVenueField('amenities', value),
    photos: venueDraft.photos, setPhotos: (value: string) => setVenueField('photos', value),
    venueBaseline, clearVenueDraftDirty,
    paymentModes: paymentModesState, setPaymentModes,
    weekday, setWeekday, opens: hoursDraft.opens, setOpens: (value: string) => setHoursField('opens', value),
    closes: hoursDraft.closes, setCloses: (value: string) => setHoursField('closes', value),
    closed: hoursDraft.closed, setClosed: (value: boolean) => setHoursField('closed', value),
    hoursBaseline, clearHoursDraftDirty,
    priceDay, setPriceDay, priceStart, setPriceStart, priceEnd, setPriceEnd, priceRupees, setPriceRupees,
    priceLabel, setPriceLabel, editingPriceId, setEditingPriceId, blockDate, setBlockDate, blockStart,
    setBlockStart, blockEnd, setBlockEnd, blockReason, setBlockReason, error, setError, busy, setBusy,
    initialLoading, hasLoaded,
    selected, resources, selectedResource, settingsVisibility, capacityValid, load,
  };
}
