import { useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useToast } from '../../../components/ui';
import { createBooking, createTravelRequest, getProviderService, inspectTravelRequest, listMyAddresses, uploadJobPhoto, type ProviderServiceWithProvider } from '../../../lib/api';
import { track } from '../../../lib/analytics';
import { isServiceBookingEnabled, readBookPrefill, resolveServiceBookingEntry, selectedChips, toggleChip } from '../../../lib/assistant/prefill';
import { useSelectedLocation } from '../../../lib/locationContext';
import { fromSavedAddress } from '../../../lib/locationModel';
import { usePayment } from '../../../lib/payments';
import { supabase } from '../../../lib/supabase';
import { useAppFeatureFlags, useFeature } from '../../../lib/featureFlags';
import { firstAvailableDay, istDateKey, nextDays, WINDOW_START_HOURS, windowAvailable, windowStart } from '../../../lib/schedule';
import { useTheme } from '../../../theme';
import { onboardingApi, type ProviderSchedule } from '../../../lib/onboarding';
import { asapAvailable, windowFits } from '../../../lib/onboarding/availability';
import type { TravelPreview } from '../../../lib/types';
import { buildBookingPayload, readPaise, type BookingPricePreview } from './model';

export function useBookScreenController() {
  const t = useTheme();
  const toast = useToast();
  const pay = usePayment();
  const recurringEnabled = useFeature('recurring_bookings');
  const featureFlags = useAppFeatureFlags();
  const { providerServiceId, packageId, archetype, ...prefillParams } = useLocalSearchParams<{
    providerServiceId: string;
    packageId?: string;
    archetype?: 'fixed' | 'time_based';
    from?: string;
    description?: string;
    slot?: string;
    addressId?: string;
  }>();
  const { location, setLocation } = useSelectedLocation();
  const [service, setService] = useState<ProviderServiceWithProvider | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pricePreview, setPricePreview] = useState<BookingPricePreview | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceAttempt, setPriceAttempt] = useState(0);
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => nextDays(now, 7), [now]);
  // Draft hand-off from QuickServe AI (src/lib/assistant/prefill.ts); read once so the user's edits stick.
  const [prefill] = useState(() => readBookPrefill(prefillParams, days, now));
  const bookingEntry = useMemo(() => {
    if (!service) return null;
    const slot = prefill.slotInvalid
      ? 'invalid'
      : prefill.mode === 'asap'
        ? 'asap'
        : prefill.mode === 'schedule' && prefill.dayIndex !== null && prefill.hour !== null
          ? `${istDateKey(days[prefill.dayIndex]!.date)}@${prefill.hour}`
          : undefined;
    return resolveServiceBookingEntry(service, {
      fromAssistant: prefill.fromAssistant,
      description: prefill.description,
      slot,
      addressId: prefill.addressId,
    });
  }, [service, prefill, days]);
  const [description, setDescription] = useState(prefill.description ?? '');
  const [photos, setPhotos] = useState<{ uri: string; mimeType: string }[]>([]);
  const [mode, setMode] = useState<'asap' | 'schedule'>(() => (
    prefill.slotInvalid ? 'schedule' : prefill.mode ?? 'asap'
  ));
  const [dayIndex, setDayIndex] = useState(() => prefill.dayIndex ?? firstAvailableDay(days, now));
  const [hour, setHour] = useState<number | null>(prefill.hour);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Provider working hours / time off / full days (migration 0009). null = unknown or unrestricted.
  const [sched, setSched] = useState<ProviderSchedule | null>(null);
  const [travel, setTravel] = useState<TravelPreview | null>(null);
  const [travelChecking, setTravelChecking] = useState(false);

  const load = () => {
    if (!providerServiceId) return;
    setLoadError(null);
    getProviderService(providerServiceId)
      .then((s) => {
        setService(s);
        onboardingApi
          .getProviderSchedule(s.provider_id)
          .then(setSched)
          .catch(() => setSched(null));
      })
      .catch((e: Error) => setLoadError(e.message));
  };
  useEffect(load, [providerServiceId]);
  useEffect(() => {
    if (!service) return;
    if (bookingEntry?.kind !== 'inspect') {
      setPricePreview(null);
      setPriceError(null);
      return;
    }
    let active = true;
    setPricePreview(null);
    setPriceError(null);
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_booking_price_preview', {
          p_provider_service_id: service.id,
          p_quantity: 1,
        });
        if (error) throw new Error(error.message);
        if (!data || typeof data !== 'object') throw new Error('No booking price preview returned');
        const raw = data as Record<keyof BookingPricePreview, unknown>;
        const preview = {
          visit_fee: readPaise(raw.visit_fee),
          platform_fee: readPaise(raw.platform_fee),
          package_total: readPaise(raw.package_total),
          total: readPaise(raw.total),
          pay_now: readPaise(raw.pay_now),
        };
        if (active) setPricePreview(preview);
      } catch (caught) {
        if (active) setPriceError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      active = false;
    };
  }, [service?.id, bookingEntry?.kind, priceAttempt]);

  // The draft used a saved address that is not the current selection (e.g. changed since): switch to it.
  useEffect(() => {
    const id = prefill.addressId;
    if (!id || location.addressId === id) return;
    listMyAddresses()
      .then((list) => {
        const a = list.find((x) => x.id === id);
        if (a) setLocation(fromSavedAddress(a));
      })
      .catch(() => undefined);
    // Only on arrival from the assistant.
  }, []);

  const day = days[dayIndex] ?? days[0]!;
  // A window is offered only if it meets the lead time AND lies inside the provider's hours (create_booking re-checks).
  const slotOk = (date: Date, h: number) => windowAvailable(date, h, new Date()) && windowFits(sched, windowStart(date, h));
  const dayOk = (date: Date) => WINDOW_START_HOURS.some((h) => slotOk(date, h));
  const asapOk = !!service?.providers?.is_online && !service?.providers?.paused && asapAvailable(sched, new Date());
  // Drop a picked window that is no longer available on the newly selected day.
  useEffect(() => {
    if (hour != null && !slotOk(day.date, hour)) setHour(null);
  }, [day, hour, sched]);
  // Once the schedule loads: move off ASAP / an unavailable day.
  useEffect(() => {
    if (!service) return;
    if (!service.providers?.is_online || service.providers?.paused || !asapAvailable(sched, new Date())) setMode('schedule');
    if (!dayOk(day.date)) {
      const i = days.findIndex((d) => dayOk(d.date));
      if (i >= 0) setDayIndex(i);
    }
  }, [sched, service]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) setPhotos((p) => [...p, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' }].slice(0, 4));
  };

  // Chips live on the first line, so an AI job brief below it is never rewritten (src/lib/assistant/prefill.ts).
  const selectedIssues = selectedChips(description);
  const toggleIssue = (q: string) => setDescription((d) => toggleChip(d, q));

  const hasAddress = !!location.addressId && !!location.line1;
  const scheduledAt = mode === 'asap' ? null : hour != null ? windowStart(day.date, hour) : undefined;
  useEffect(() => {
    if (!service || !hasAddress || scheduledAt === undefined) {
      setTravel(null);
      return;
    }
    let cancelled = false;
    const check = () => {
      setTravelChecking(true);
      inspectTravelRequest(
        service.id,
        { lat: location.lat, lng: location.lng },
        scheduledAt,
      )
        .then((next) => {
          if (cancelled) return;
          setTravel(next);
          if (next.needs_approval && mode === 'asap') setMode('schedule');
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setTravelChecking(false));
    };
    check();
    const timer = setInterval(check, travel?.status === 'pending' ? 10000 : 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [service?.id, hasAddress, location.lat, location.lng, scheduledAt?.getTime(), mode, travel?.status]);

  const travelApproved =
    !!travel &&
    !travel.needs_approval ||
    (!!travel?.needs_approval &&
      travel.status === 'approved' &&
      !!travel.travel_request_id &&
      !!travel.expires_at &&
      new Date(travel.expires_at).getTime() > Date.now());
  const travelPending = !!travel?.needs_approval && travel.status === 'pending';
  const blocker = service?.providers?.paused
    ? 'This provider is on holiday and is not taking bookings'
    : !service?.providers?.is_online && mode === 'asap'
      ? 'This provider is offline now. Choose a future time.'
    : !description.trim()
    ? 'Describe the issue to continue'
    : !hasAddress
      ? 'Add your full address to continue'
      : scheduledAt === undefined
        ? 'Pick a time slot to continue'
        : travel?.needs_approval && mode === 'asap'
          ? 'Pick a future time for a travel request'
          : travel?.allowed === false
            ? 'This provider does not travel this far'
        : null;

  const submit = async () => {
    if (
      !service ||
      bookingEntry?.kind !== 'inspect' ||
      !isServiceBookingEnabled(bookingEntry, featureFlags.archetypes) ||
      blocker ||
      !location.line1 ||
      scheduledAt === undefined
    ) return;
    setBusy(true);
    setError(null);
    try {
      if (travel?.needs_approval && !travelApproved && scheduledAt) {
        const requestId = await createTravelRequest(service.id, scheduledAt, {
          lat: location.lat,
          lng: location.lng,
        }, description.trim());
        const next = await inspectTravelRequest(
          service.id,
          { lat: location.lat, lng: location.lng },
          scheduledAt,
        );
        setTravel({ ...next, travel_request_id: next.travel_request_id ?? requestId, status: next.status ?? 'pending' });
        toast({ message: 'Travel request sent. We’ll notify you when the provider replies.', tone: 'success' });
        return;
      }
      const paths = await Promise.all(photos.map((p) => uploadJobPhoto(p.uri, p.mimeType)));
      const bookingId = await createBooking(buildBookingPayload({
        providerServiceId: service.id,
        description: description.trim(),
        addressLine: location.line1,
        city: location.city,
        coords: { lat: location.lat, lng: location.lng },
        scheduledAt,
        photos: paths,
        travelRequestId: travelApproved ? travel?.travel_request_id ?? null : null,
      }));
      if (prefill.fromAssistant) track('draft_to_booking_conversion', { category: service.categories?.slug ?? null, edited: description.trim() !== (prefill.description ?? '').trim() });
      const result = await pay(bookingId).catch((e: Error) => {
        toast({ message: e.message, tone: 'error' });
        return 'cancelled' as const;
      });
      if (result === 'paid') toast({ message: 'Booked! The provider has been notified.', tone: 'success' });
      else if (result === 'cancelled') toast({ message: 'Booking saved — pay the visit fee to send it.', tone: 'warning' });
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    t, toast, recurringEnabled, featureFlags, packageId, archetype, bookingEntry,
    location, setLocation, service, loadError, pricePreview, priceError, setPriceAttempt,
    days, day, prefill, description, setDescription, photos, setPhotos, mode, setMode,
    dayIndex, setDayIndex, hour, setHour, editorOpen, setEditorOpen, busy, error,
    travel, travelChecking, load, slotOk, dayOk, asapOk, pickPhoto, selectedIssues, toggleIssue,
    hasAddress, scheduledAt, travelApproved, travelPending, blocker, submit,
  };
}

export type BookScreenController = ReturnType<typeof useBookScreenController>;
