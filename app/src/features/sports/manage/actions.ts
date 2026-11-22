import {
  isSportsCapacityValid,
  isSportsDateValid,
  isSportsTimeRangeValid,
  resolveSportsResourceSettings,
  resolveSportsVenuePaymentModesForSave,
} from '../model';
import { getVenueReviewPresentation, hasSportsVenueReviewChanges } from '../venueReviewPresentation';
import { rupeesToPaise } from '../../../lib/money';
import { supabase } from '../../../lib/supabase';
import { toInstant } from './model';
import type { useSportsVenueManagementState } from './useSportsVenueManagementState';

type ManagementState = ReturnType<typeof useSportsVenueManagementState>;
type Toast = (options: { message: string; tone: 'success' }) => void;
type Confirm = (options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}) => Promise<boolean>;

export type SportsVenueManagementActions = ReturnType<typeof createSportsVenueManagementActions>;

export function createSportsVenueManagementActions(state: ManagementState, toast: Toast) {
  const saveVenue = async (confirm: Confirm) => {
    const selected = state.selected;
    const isOwner = selected?.venue.owner_id === state.userId;
    if (selected && !getVenueReviewPresentation(selected.venue.status, isOwner ? 'owner' : selected.venue.business_role ?? 'member').canEditDetails) {
      return;
    }

    const normalizedDetails = {
      name: state.name.trim(),
      description: state.description.trim(),
      address_line: state.address.trim(),
      city: state.city.trim(),
      area: state.area.trim(),
      lat: Number(state.lat),
      lng: Number(state.lng),
      amenities: state.amenities.split(',').map((item) => item.trim()).filter(Boolean),
      photos: state.photos.split('\n').map((item) => item.trim()).filter(Boolean),
    };
    if (
      selected
      && selected.venue.status !== 'draft'
      && hasSportsVenueReviewChanges(selected.venue, normalizedDetails)
      && !await confirm({
        title: 'Save venue changes and restart review?',
        message: 'Changing venue details will return this venue to draft and clear its current review status. You will need to submit it again. Payment-setting changes alone do not restart review.',
        confirmLabel: 'Save and restart review',
      })
    ) {
      return;
    }

    const modesToSave = resolveSportsVenuePaymentModesForSave(
      state.selected?.venue.payment_modes,
      state.paymentModes,
      state.settingsVisibility.canSelectOnlinePayment,
    );
    state.setBusy(true);
    state.setError(null);
    const { data, error: rpcError } = await supabase.rpc('save_sports_venue', {
      p_id: state.selectedId || null,
      p_name: state.name.trim(),
      p_description: state.description.trim(),
      p_address_line: state.address.trim(),
      p_city: state.city.trim(),
      p_area: state.area.trim(),
      p_lat: Number(state.lat),
      p_lng: Number(state.lng),
      p_amenities: normalizedDetails.amenities,
      p_photos: normalizedDetails.photos,
      p_payment_modes: modesToSave,
    });
    state.setBusy(false);
    if (rpcError) {
      state.setError(rpcError.message);
      return;
    }
    state.setSelectedId(data as string);
    toast({ message: 'Venue details saved', tone: 'success' });
    await state.load();
  };

  const saveResource = async () => {
    if (!state.selectedId || !state.activityId) return;
    const resourceSettings = resolveSportsResourceSettings(
      state.bookingMode,
      state.capacity,
      state.instantBookingEnabled,
      state.capacitySlotsEnabled,
      state.selectedResource,
    );
    if (!isSportsCapacityValid(resourceSettings.capacity)) {
      state.setError('Capacity must be a whole number from 1 to 100.');
      return;
    }
    state.setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('save_sports_resource', {
      p_venue_id: state.selectedId,
      p_id: state.resourceId || null,
      p_activity_id: state.activityId,
      p_name: state.resourceName.trim(),
      p_slot_minutes: Number(state.slotMinutes),
      p_active: true,
      p_booking_mode: resourceSettings.bookingMode,
      p_capacity: resourceSettings.capacity,
    });
    state.setBusy(false);
    if (rpcError) {
      state.setError(rpcError.message);
      return;
    }
    state.setResourceId(data as string);
    toast({ message: 'Court/resource saved', tone: 'success' });
    await state.load();
  };

  const saveHours = async () => {
    if (!state.selectedId) return;
    if (!state.closed && !isSportsTimeRangeValid(state.opens, state.closes)) {
      state.setError('Enter valid opening and closing times in 24-hour format.');
      return;
    }
    state.setBusy(true);
    const { error: rpcError } = await supabase.rpc('set_sports_hours', {
      p_venue_id: state.selectedId,
      p_weekday: Number(state.weekday),
      p_opens: state.closed ? null : state.opens,
      p_closes: state.closed ? null : state.closes,
    });
    state.setBusy(false);
    if (rpcError) state.setError(rpcError.message);
    else {
      toast({ message: 'Opening hours saved', tone: 'success' });
      await state.load();
    }
  };

  const savePrice = async () => {
    if (!state.resourceId) return;
    if (!isSportsTimeRangeValid(state.priceStart, state.priceEnd)) {
      state.setError('Enter valid price-rule times in 24-hour format.');
      return;
    }
    const price = rupeesToPaise(Number(state.priceRupees));
    state.setBusy(true);
    const { error: rpcError } = await supabase.rpc('save_sports_price_rule', {
      p_resource_id: state.resourceId,
      p_id: state.editingPriceId,
      p_weekday: state.priceDay === 'all' ? null : Number(state.priceDay),
      p_starts: state.priceStart,
      p_ends: state.priceEnd,
      p_price_paise: price,
      p_label: state.priceLabel.trim() || 'Standard',
    });
    state.setBusy(false);
    if (rpcError) state.setError(rpcError.message);
    else {
      state.setEditingPriceId(null);
      state.setPriceRupees('');
      state.setPriceLabel('Standard');
      toast({ message: state.editingPriceId ? 'Price rule updated' : 'Price rule added', tone: 'success' });
      await state.load();
    }
  };

  const deletePrice = async (id: string) => {
    state.setBusy(true);
    const { error: rpcError } = await supabase.rpc('delete_sports_price_rule', { p_id: id });
    state.setBusy(false);
    if (rpcError) state.setError(rpcError.message);
    else {
      if (state.editingPriceId === id) {
        state.setEditingPriceId(null);
        state.setPriceRupees('');
        state.setPriceLabel('Standard');
      }
      toast({ message: 'Price rule deleted', tone: 'success' });
      await state.load();
    }
  };

  const addBlock = async () => {
    if (!state.resourceId) return;
    if (!isSportsDateValid(state.blockDate) || !isSportsTimeRangeValid(state.blockStart, state.blockEnd)) {
      state.setError('Enter a valid block date and a start time before the end time.');
      return;
    }
    const startsAt = toInstant(state.blockDate, state.blockStart);
    const endsAt = toInstant(state.blockDate, state.blockEnd);
    if (!startsAt || !endsAt) {
      state.setError('Enter a valid block date and time.');
      return;
    }
    state.setBusy(true);
    const { error: rpcError } = await supabase.rpc('add_sports_block', {
      p_resource_id: state.resourceId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_reason: state.blockReason.trim(),
    });
    state.setBusy(false);
    if (rpcError) state.setError(rpcError.message);
    else {
      toast({ message: 'Unavailable time added', tone: 'success' });
      await state.load();
    }
  };

  const removeBlock = async (id: string) => {
    const { error: rpcError } = await supabase.rpc('remove_sports_block', { p_id: id });
    if (rpcError) state.setError(rpcError.message);
    else await state.load();
  };

  const submitVenue = async () => {
    if (!state.selectedId) return;
    state.setBusy(true);
    const { error: rpcError } = await supabase.rpc('submit_sports_venue', { p_id: state.selectedId });
    state.setBusy(false);
    if (rpcError) state.setError(rpcError.message);
    else {
      toast({ message: 'Venue submitted for review', tone: 'success' });
      await state.load();
    }
  };

  const togglePaymentMode = (mode: 'online' | 'pay_at_venue') => {
    state.setPaymentModes((current) => {
      if (current.includes(mode)) {
        const next = current.filter((item) => item !== mode);
        return next.length > 0 ? next : current;
      }
      return [...current, mode];
    });
  };

  return { saveVenue, saveResource, saveHours, savePrice, deletePrice, addBlock, removeBlock, submitVenue, togglePaymentMode };
}
