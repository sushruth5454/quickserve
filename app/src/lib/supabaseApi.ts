import { Linking } from 'react-native';
import type {
  AuthSession,
  AccountDeletionOutcome,
  CancellationPreview,
  ChatReadState,
  PushPlatform,
  Coords,
  CommissionTerms,
  CreateBookingInput,
  PaymentLinkResponse,
  PaymentReceipt,
  ProviderDetail,
  ProviderProfileInput,
  ProviderServiceWithProvider,
  PublicReview,
  ServiceInput,
  TopRatedProvider,
  LiveCity,
} from './apiTypes';
import { supabase } from './supabase';
import { supportContact } from './config';
import { invokeFunction } from './invokeFunction';
import type {
  Booking,
  BookingAddress,
  BookingEvent,
  BookingOtps,
  Category,
  Message,
  NewAddressInput,
  OtpResult,
  Payment,
  Payout,
  ProviderStatementRow,
  Profile,
  Provider,
  ProviderJob,
  ProviderSearchResult,
  ProviderService,
  Quote,
  QuoteItemDraft,
  RateUnit,
  Review,
  ReviewInput,
  SavedAddress,
  SearchFilters,
  SkillLevel,
  TravelPreview,
  TravelRequest,
  ServiceRequest,
  Proposal,
  ProposalRequest,
  RequestMessage,
  PaymentSchedule,
  CreateServiceRequestInput,
  SendProposalInput,
  DeliveryLink,
} from './types';
import type { AppNotification, UnreadCount } from './unread';
import type { CoinLedgerEntry, CoinRedemptionPreview } from './coins';

interface Result<T> {
  data?: T | null;
  error: { message: string } | null;
}

function unwrap<T>(res: Result<T>): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

// ---------- Auth & profile ----------
export async function getSession(): Promise<AuthSession | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const user = data.session?.user;
  return user ? { userId: user.id, phone: user.phone ?? null } : null;
}

export function onAuthChange(cb: (s: AuthSession | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, next) =>
    cb(next?.user ? { userId: next.user.id, phone: next.user.phone ?? null } : null),
  );
  return () => data.subscription.unsubscribe();
}

export async function requestAccountDeletion(): Promise<AccountDeletionOutcome> {
  const uid = await requireUserId();
  try {
    unwrap(await supabase.rpc('request_account_deletion'));
    return 'recorded';
  } catch {
    const subject = encodeURIComponent('Delete my QuickServe account');
    const body = encodeURIComponent(`Please delete my account and personal data.\n\nUser ID: ${uid}`);
    await Linking.openURL(`mailto:${supportContact.email}?subject=${subject}&body=${body}`);
    return 'email';
  }
}

export async function sendOtp(phone: string): Promise<void> {
  unwrap(await supabase.auth.signInWithOtp({ phone }));
}

export async function verifyOtp(phone: string, token: string): Promise<void> {
  unwrap(await supabase.auth.verifyOtp({ phone, token, type: 'sms' }));
}

export async function signOut(): Promise<void> {
  // Stop pushes to this device for the departing user (best effort: signing out must work offline too).
  const token = registeredPushToken;
  registeredPushToken = null;
  if (token) await unregisterPushDevice(token).catch(() => undefined);
  // Only this device: a global sign-out would end the same account's sessions on every other phone too.
  unwrap(await supabase.auth.signOut({ scope: 'local' }));
}

const PROFILE_COLUMNS = 'id, full_name, avatar_url, role_customer, role_provider, created_at';

export async function getMyProfile(): Promise<Profile | null> {
  const uid = await requireUserId();
  return unwrap(await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', uid).maybeSingle<Profile>());
}

export async function updateMyProfile(
  patch: Partial<Pick<Profile, 'full_name' | 'avatar_url'>>,
): Promise<void> {
  const uid = await requireUserId();
  unwrap(await supabase.from('profiles').update(patch).eq('id', uid));
}

// ---------- Discovery ----------
export async function listCategories(city?: string): Promise<Category[]> {
  return unwrap(
    await supabase.rpc('get_catalog', { p_city: city?.trim() || null }),
  ) as Category[];
}

export async function searchProviders(
  categorySlug: string,
  coords: Coords | null,
  filters: SearchFilters,
): Promise<ProviderSearchResult[]> {
  return unwrap(
    await supabase.rpc('search_providers', {
      p_category_slug: categorySlug,
      p_lat: coords?.lat ?? null,
      p_lng: coords?.lng ?? null,
      p_sort: filters.sort,
      p_min_rating: filters.minRating,
      p_skill_level: filters.skillLevel,
      p_max_visit_fee: filters.maxVisitFee,
      p_online_only: filters.onlineOnly,
    }),
  );
}

export async function listTopRated(limit = 10, city?: string | null): Promise<TopRatedProvider[]> {
  return unwrap(
    await supabase.rpc('list_top_rated_public', {
      p_city: city?.trim() || null,
      p_limit: limit,
    }),
  ) as TopRatedProvider[];
}

export async function listLiveCities(): Promise<LiveCity[]> {
  return ((unwrap(await supabase.rpc('list_live_cities')) ?? []) as LiveCity[]).map((c) => ({
    ...c,
    lat: c.lat == null ? null : Number(c.lat),
    lng: c.lng == null ? null : Number(c.lng),
  }));
}

export async function resolveServiceCity(lat: number, lng: number, city?: string | null): Promise<string | null> {
  return (unwrap(await supabase.rpc('resolve_service_city', { p_lat: lat, p_lng: lng, p_city: city ?? null })) as string | null) ?? null;
}

export async function joinCityWaitlist(city: string, lat?: number | null, lng?: number | null): Promise<boolean> {
  return unwrap(await supabase.rpc('join_city_waitlist', { p_city: city, p_lat: lat ?? null, p_lng: lng ?? null })) as boolean;
}

export async function onCityWaitlist(city: string): Promise<boolean> {
  return Boolean(unwrap(await supabase.rpc('on_city_waitlist', { p_city: city })));
}

// ---------- Proposal / milestone booking ----------
export async function createServiceRequest(input: CreateServiceRequestInput): Promise<string> {
  return unwrap(await supabase.rpc('create_service_request', {
    p_category_id: input.categoryId,
    p_city: input.city,
    p_area: input.area,
    p_event_start: input.eventStart.toISOString(),
    p_event_end: input.eventEnd.toISOString(),
    p_intake: input.intake,
    p_budget_min: input.budgetMin,
    p_budget_max: input.budgetMax,
    p_address_id: input.addressId,
    p_venue_text: input.venueText,
    ...(input.providerId ? { p_provider_id: input.providerId } : {}),
    ...(input.lat != null && input.lng != null ? { p_lat: input.lat, p_lng: input.lng } : {}),
    ...(input.urgent ? { p_urgent: true } : {}),
  })) as string;
}

export async function cancelServiceRequest(id: string): Promise<void> {
  await rpcVoid('cancel_service_request', { p_request_id: id });
}

export async function listMyServiceRequests(): Promise<ServiceRequest[]> {
  const uid = await requireUserId();
  return unwrap(await supabase.from('service_requests').select('*, categories(name, slug, icon)')
    .eq('customer_id', uid).order('created_at', { ascending: false })) as ServiceRequest[];
}

export async function listProviderServiceRequests(): Promise<ProposalRequest[]> {
  return unwrap(await supabase.from('service_request_provider_view')
    .select('*').order('created_at', { ascending: false })) as ProposalRequest[];
}

export async function getServiceRequest(id: string): Promise<ServiceRequest | null> {
  return unwrap(await supabase.from('service_requests').select('*, categories(name, slug, icon)')
    .eq('id', id).maybeSingle<ServiceRequest>());
}

export async function listRequestProposals(requestId: string): Promise<Proposal[]> {
  return unwrap(await supabase.from('proposals')
    .select('*, proposal_items(*), proposal_schedule(*), bookings(id, status, payment_hold_expires_at), providers(rating_avg, rating_count, profiles(full_name))')
    .eq('request_id', requestId).order('created_at', { ascending: false })) as Proposal[];
}

export async function getProposal(id: string): Promise<Proposal> {
  return unwrap(await supabase.from('proposals')
    .select('*, proposal_items(*), proposal_schedule(*), bookings(id, status, payment_hold_expires_at), providers(rating_avg, rating_count, profiles(full_name))')
    .eq('id', id).single<Proposal>());
}

export async function sendProposal(input: SendProposalInput): Promise<string> {
  return unwrap(await supabase.rpc('send_proposal', {
    p_request_id: input.requestId,
    p_items: input.items.map(({ kind, title, qty, unit, unit_price, bill_photo_url, metadata }) =>
      ({ kind, title, qty, unit, unit_price, bill_photo_url, metadata })),
    p_schedule: input.schedule,
    p_valid_until: input.validUntil.toISOString(),
    p_note: input.note ?? null,
    p_deliverables: input.deliverables ?? [],
  })) as string;
}

export async function withdrawProposal(id: string): Promise<void> {
  await rpcVoid('withdraw_proposal', { p_proposal_id: id });
}

export async function listMyProposals(): Promise<Proposal[]> {
  const uid = await requireUserId();
  return unwrap(await supabase.from('proposals')
    .select('*, proposal_items(*), proposal_schedule(*), bookings(id, status, payment_hold_expires_at)')
    .eq('provider_id', uid).order('created_at', { ascending: false })) as Proposal[];
}

export async function acceptProposal(id: string, addressId: string | null = null): Promise<string> {
  return unwrap(await supabase.rpc('accept_proposal', {
    p_proposal_id: id,
    p_address_id: addressId,
  })) as string;
}

export async function listRequestMessages(requestId: string, providerId: string): Promise<RequestMessage[]> {
  return unwrap(await supabase.from('request_messages').select('*')
    .eq('request_id', requestId).eq('provider_id', providerId).order('created_at')) as RequestMessage[];
}

export async function sendRequestMessage(requestId: string, providerId: string, body: string): Promise<void> {
  await supabase.rpc('send_request_message', {
    p_request_id: requestId, p_provider_id: providerId, p_body: body,
  });
}

export async function listPaymentSchedule(bookingId: string): Promise<PaymentSchedule[]> {
  return unwrap(await supabase.from('payment_schedule').select('*')
    .eq('booking_id', bookingId).order('seq')) as PaymentSchedule[];
}

export async function createSchedulePayment(bookingId: string, scheduleId: string): Promise<PaymentLinkResponse> {
  const { data, error } = await invokeFunction<PaymentLinkResponse>('create-payment', {
    body: { booking_id: bookingId, schedule_id: scheduleId },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error((detail as { error?: string } | null)?.error ?? error.message);
  }
  if (!data) throw new Error('Payment link was not created');
  return data;
}

export async function startProposalBooking(bookingId: string, otp: string): Promise<OtpResult> {
  return unwrap(await supabase.rpc('start_proposal_booking', {
    p_booking_id: bookingId, p_otp: otp,
  })) as OtpResult;
}

export async function beginDelivery(bookingId: string): Promise<void> {
  await rpcVoid('begin_delivery', { p_booking_id: bookingId });
}

export async function submitDelivery(bookingId: string, links: DeliveryLink[]): Promise<void> {
  await rpcVoid('submit_delivery', { p_booking_id: bookingId, p_links: links });
}

export async function acceptDelivery(bookingId: string): Promise<void> {
  await rpcVoid('accept_delivery', { p_booking_id: bookingId });
}

export async function cancelProposalPaymentDefault(bookingId: string): Promise<void> {
  await rpcVoid('cancel_proposal_payment_default', { p_booking_id: bookingId });
}

/** Columns granted to anon/authenticated on public.providers (migration 0009). */
const PUBLIC_PROVIDER_COLUMNS =
  'id, bio, city, service_radius_km, years_experience, languages, kyc_status, suspended, is_online, rating_avg, rating_count, jobs_completed, commission_tier, created_at, paused, base_area, timezone';

export async function getProviderDetail(providerId: string): Promise<ProviderDetail> {
  const [provider, services, reviews] = await Promise.all([
    // Column privileges (migration 0009) expose only public provider columns; base location and payout ids stay private.
    supabase.from('providers').select(`${PUBLIC_PROVIDER_COLUMNS}, profiles(full_name, avatar_url)`).eq('id', providerId).single(),
    supabase
      .from('provider_services')
      .select('*, categories(name, slug, archetype), rate_card_items(*), service_packages(*)')
      .eq('provider_id', providerId)
      .eq('active', true),
    supabase
      .from('reviews')
      .select('id, rating, punctuality, quality, behaviour, pricing, comment, provider_reply, created_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  return {
    provider: { razorpay_account_id: null, ...(unwrap(provider) as object) } as ProviderDetail['provider'],
    services: unwrap(services) as ProviderService[],
    reviews: unwrap(reviews) as PublicReview[],
  };
}

export async function getProviderService(id: string): Promise<ProviderServiceWithProvider> {
  return unwrap(
    await supabase
      .from('provider_services')
      .select(
        '*, categories(name, slug, archetype, recurrence_allowed, allowed_frequencies), providers(rating_avg, rating_count, is_online, paused, profiles(full_name)), service_packages(*)',
      )
      .eq('id', id)
      .single(),
  );
}

export async function inspectTravelRequest(
  providerServiceId: string,
  coords: Coords,
  scheduledAt: Date | null,
): Promise<TravelPreview> {
  const rows = unwrap(
    await supabase.rpc('inspect_travel_request', {
      p_provider_service_id: providerServiceId,
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_scheduled_at: scheduledAt?.toISOString() ?? null,
    }),
  ) as TravelPreview[];
  const result = rows[0];
  if (!result) throw new Error('Could not calculate travel requirement');
  return result;
}

export async function createTravelRequest(
  providerServiceId: string,
  scheduledAt: Date,
  coords: Coords,
  note = '',
): Promise<string> {
  return unwrap(
    await supabase.rpc('create_travel_request', {
      p_provider_service_id: providerServiceId,
      p_scheduled_at: scheduledAt.toISOString(),
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_note: note || null,
    }),
  ) as string;
}

export async function listMyTravelRequests(status?: string): Promise<TravelRequest[]> {
  return unwrap(
    await supabase.rpc('list_my_travel_requests', { p_status: status ?? null }),
  ) as TravelRequest[];
}

export async function respondToTravelRequest(id: string, approve: boolean, reason?: string): Promise<void> {
  await rpcVoid('respond_travel_request', {
    p_travel_request_id: id,
    p_approve: approve,
    p_reason: reason?.trim() || null,
  });
}

// ---------- Saved addresses ----------
const ADDRESS_COLUMNS = 'id, label, line1, city, lat, lng, is_default, created_at';

export async function listMyAddresses(): Promise<SavedAddress[]> {
  const uid = await requireUserId();
  // create_booking snapshots every booking's address with label 'Booking'; those are not user-saved addresses.
  return unwrap(
    await supabase
      .from('addresses')
      .select(ADDRESS_COLUMNS)
      .eq('user_id', uid)
      .neq('label', 'Booking')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  ) as SavedAddress[];
}

export async function addAddress(input: NewAddressInput): Promise<SavedAddress> {
  const uid = await requireUserId();
  // The addresses_set_location trigger fills the geography column from lat/lng.
  return unwrap(
    await supabase
      .from('addresses')
      .insert({ user_id: uid, label: input.label.trim() || 'Other', line1: input.line1.trim(), city: input.city.trim(), lat: input.lat, lng: input.lng })
      .select(ADDRESS_COLUMNS)
      .single(),
  ) as SavedAddress;
}

export async function deleteAddress(id: string): Promise<void> {
  const uid = await requireUserId();
  unwrap(
    await supabase
      .from('addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', uid)
      .neq('label', 'Booking'),
  );
}

// ---------- Booking ----------
export async function createBooking(input: CreateBookingInput): Promise<string> {
  return unwrap(
    await supabase.rpc('create_booking', {
      p_provider_service_id: input.providerServiceId,
      p_description: input.description,
      p_address_line: input.addressLine,
      p_city: input.city,
      p_lat: input.coords.lat,
      p_lng: input.coords.lng,
      p_scheduled_at: input.scheduledAt?.toISOString() ?? null,
      p_photos: input.photos,
      p_travel_request_id: input.travelRequestId ?? null,
    }),
  );
}

export {
  createFixedBooking,
  listFixedPackages,
  sendFixedAddons,
  approveFixedChangeOrder,
} from './fixedBooking';

export async function createPayment(bookingId: string): Promise<PaymentLinkResponse> {
  const { data, error } = await invokeFunction<PaymentLinkResponse>('create-payment', {
    body: { booking_id: bookingId },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error((detail as { error?: string } | null)?.error ?? error.message);
  }
  if (!data) throw new Error('No payment link returned');
  return data;
}

const BOOKING_SELECT =
  '*, travel_requests(distance_km, quoted_fee, status, expires_at), categories(name, slug, review_tags), providers(city, rating_avg, rating_count, profiles(full_name))';

export async function listMyBookings(): Promise<Booking[]> {
  const uid = await requireUserId();
  return unwrap(
    await supabase.from('bookings').select(BOOKING_SELECT).eq('customer_id', uid).order('created_at', { ascending: false }),
  );
}

export async function getBooking(id: string): Promise<Booking> {
  return unwrap(await supabase.from('bookings').select(BOOKING_SELECT).eq('id', id).single());
}

export async function getBookingCommissionRate(bookingId: string): Promise<number> {
  const rateBp = unwrap(await supabase.rpc('get_booking_commission_rate', { p_booking_id: bookingId })) as unknown;
  if (typeof rateBp !== 'number' || !Number.isInteger(rateBp) || rateBp < 0) {
    throw new Error('The server returned an invalid commission rate.');
  }
  return rateBp;
}

export async function getQuotes(bookingId: string): Promise<Quote[]> {
  return unwrap(
    await supabase
      .from('quotes')
      .select('*, quote_items(*)')
      .eq('booking_id', bookingId)
      .order('version', { ascending: false }),
  );
}

export async function getPayments(bookingId: string): Promise<Payment[]> {
  return unwrap(
    await supabase
      .from('payments')
      .select('*, refunds(amount, status, created_at, processed_at)')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true }),
  );
}

export async function getReceipt(paymentId: string): Promise<PaymentReceipt | null> {
  const rows = unwrap(
    await supabase.rpc('get_receipt', { p_payment_id: paymentId }),
  ) as PaymentReceipt[];
  return rows[0] ?? null;
}

export async function getEvents(bookingId: string): Promise<BookingEvent[]> {
  return unwrap(
    await supabase.from('booking_events').select('*').eq('booking_id', bookingId).order('at', { ascending: true }),
  );
}

export async function getBookingOtps(bookingId: string): Promise<BookingOtps | null> {
  const rows = unwrap(await supabase.rpc('get_booking_otps', { p_booking_id: bookingId })) as BookingOtps[];
  return rows[0] ?? null;
}

export async function getBookingAddress(bookingId: string): Promise<BookingAddress | null> {
  const rows = unwrap(await supabase.rpc('get_booking_address', { p_booking_id: bookingId })) as BookingAddress[];
  return rows[0] ?? null;
}

export async function getReviewForBooking(bookingId: string): Promise<Review | null> {
  return unwrap(await supabase.from('reviews').select('*').eq('booking_id', bookingId).maybeSingle());
}

export async function getProfileName(userId: string): Promise<string> {
  const row = unwrap(
    await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle<{ full_name: string }>(),
  );
  return row?.full_name || 'User';
}

export async function signedPhotoUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const res = unwrap(await supabase.storage.from('job-photos').createSignedUrls(paths, 3600));
  return res.map((r) => r.signedUrl).filter((u): u is string => !!u);
}

export async function uploadJobPhoto(uri: string, mimeType = 'image/jpeg'): Promise<string> {
  const uid = await requireUserId();
  const ext = mimeType.split('/')[1] ?? 'jpg';
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const body = await (await fetch(uri)).arrayBuffer();
  unwrap(await supabase.storage.from('job-photos').upload(path, body, { contentType: mimeType }));
  return path;
}

// ---------- State transitions (all server-validated RPCs) ----------
const rpcVoid = async (fn: string, args: Record<string, unknown>) => {
  unwrap(await supabase.rpc(fn, args));
};

export const acceptBooking = (id: string) => rpcVoid('accept_booking', { p_booking_id: id });
export const declineBooking = (id: string, reason?: string) =>
  rpcVoid('decline_booking', { p_booking_id: id, p_reason: reason ?? null });
export async function startTrip(id: string): Promise<void> {
  const booking = await getBooking(id);
  if (booking.archetype !== 'time_based') await rpcVoid('start_trip', { p_booking_id: id });
}
export async function requestCompletion(id: string): Promise<void> {
  const booking = await getBooking(id);
  await rpcVoid(booking.archetype === 'time_based' ? 'request_session_completion' : 'request_completion', { p_booking_id: id });
}
export async function confirmCompletion(id: string): Promise<void> {
  const booking = await getBooking(id);
  await rpcVoid(booking.archetype === 'time_based' ? 'confirm_session_completion' : 'confirm_completion', { p_booking_id: id });
}
export async function previewCancellation(id: string): Promise<CancellationPreview> {
  const raw = unwrap(await supabase.rpc('preview_cancellation', { p_booking_id: id })) as unknown;
  if (!raw || typeof raw !== 'object') {
    throw new Error('The server returned an invalid cancellation preview.');
  }
  const preview = raw as Record<string, unknown>;
  const refundAmount = preview.refund_amount;
  const chargedAmount = preview.charged_amount;
  if (
    typeof refundAmount !== 'number'
    || !Number.isSafeInteger(refundAmount)
    || refundAmount < 0
    || typeof chargedAmount !== 'number'
    || !Number.isSafeInteger(chargedAmount)
    || chargedAmount < 0
  ) {
    throw new Error('The server returned an invalid cancellation preview.');
  }
  return {
    refund_amount: refundAmount,
    charged_amount: chargedAmount,
  };
}
export async function cancelBooking(id: string, reason?: string): Promise<void> {
  const booking = await getBooking(id);
  await rpcVoid(booking.archetype === 'time_based' ? 'cancel_session_booking' : 'cancel_booking', {
    p_booking_id: id,
    p_reason: reason ?? null,
  });
}
export const providerCancelBooking = (id: string, reason: 'provider_cancellation' | 'provider_no_show' = 'provider_cancellation') =>
  rpcVoid('provider_cancel_booking', { p_booking_id: id, p_reason: reason, p_note: null });
export const disputeBooking = (id: string, reason: string) =>
  rpcVoid('dispute_booking', { p_booking_id: id, p_reason: reason });
export const reportNoShow = (id: string, absentParty: 'customer' | 'provider') =>
  rpcVoid('report_no_show', { p_booking_id: id, p_party: absentParty });
export const regenerateOtp = (id: string, kind: 'start' | 'end') =>
  rpcVoid('regenerate_otp', { p_booking_id: id, p_kind: kind });
export const rejectQuote = (bookingId: string, quoteId: string) =>
  rpcVoid('reject_quote', { p_booking_id: bookingId, p_quote_id: quoteId });

export async function arrive(id: string, otp: string): Promise<OtpResult> {
  const booking = await getBooking(id);
  return unwrap(await supabase.rpc(booking.archetype === 'time_based' ? 'start_session_booking' : 'arrive', {
    p_booking_id: id,
    p_otp: otp,
  }));
}

export async function completeBooking(id: string, otp: string): Promise<OtpResult> {
  const booking = await getBooking(id);
  return unwrap(await supabase.rpc(booking.archetype === 'time_based' ? 'complete_session_booking' : 'complete_booking', {
    p_booking_id: id,
    p_otp: otp,
  }));
}

export async function sendQuote(bookingId: string, items: QuoteItemDraft[], note?: string): Promise<string> {
  return unwrap(await supabase.rpc('send_quote', { p_booking_id: bookingId, p_items: items, p_note: note ?? null }));
}

export async function approveQuote(
  bookingId: string,
  quoteId: string,
  useCoins = false,
): Promise<{ amount_due: number; coins_redeemed_paise?: number }> {
  return unwrap(
    await supabase.rpc('approve_quote_with_coins', {
      p_booking_id: bookingId,
      p_quote_id: quoteId,
      p_use_coins: useCoins,
    }),
  );
}

export async function submitReview(bookingId: string, r: ReviewInput): Promise<string> {
  return unwrap(
    await supabase.rpc('submit_review', {
      p_booking_id: bookingId,
      p_rating: r.rating,
      p_punctuality: r.punctuality ?? null,
      p_quality: r.quality ?? null,
      p_behaviour: r.behaviour ?? null,
      p_pricing: r.pricing ?? null,
      p_comment: r.comment ?? null,
      p_tags: r.tags ?? [],
    }),
  );
}

export async function getMyCoinBalance(): Promise<number> {
  return unwrap(await supabase.rpc('get_my_coin_balance'));
}

export async function listCoinHistory(limit = 50): Promise<CoinLedgerEntry[]> {
  return unwrap(
    await supabase
      .from('coin_ledger')
      .select('id, user_id, delta, kind, booking_id, source_ledger_id, expires_at, ref, reason, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function getCoinRedemptionPreview(bookingId: string, quoteId: string): Promise<CoinRedemptionPreview> {
  return unwrap(
    await supabase.rpc('get_coin_redemption_preview', {
      p_booking_id: bookingId,
      p_quote_id: quoteId,
    }),
  );
}

// ---------- Provider ----------
export async function getMyProvider(): Promise<Provider | null> {
  await requireUserId();
  // Own row incl. private columns via RPC (select('*') is blocked by column privileges since migration 0009).
  return unwrap(await supabase.rpc('get_my_provider')) as Provider | null;
}

export async function getCommissionTerms(): Promise<CommissionTerms> {
  return unwrap(await supabase.rpc('get_commission_terms')) as CommissionTerms;
}

export async function upsertProviderProfile(input: ProviderProfileInput): Promise<void> {
  await rpcVoid('upsert_provider_profile', {
    p_full_name: input.fullName,
    p_bio: input.bio,
    p_city: input.city,
    p_service_radius_km: input.serviceRadiusKm,
    p_lat: input.coords?.lat ?? null,
    p_lng: input.coords?.lng ?? null,
    p_years_experience: input.yearsExperience,
    p_languages: input.languages,
  });
}

export const setOnline = (online: boolean) => rpcVoid('set_provider_online', { p_online: online });

export async function listMyServices(includeInactive = false): Promise<ProviderService[]> {
  const uid = await requireUserId();
  let q = supabase.from('provider_services').select('*, categories(name, slug, archetype), rate_card_items(*), service_packages(*)').eq('provider_id', uid);
  if (!includeInactive) q = q.eq('active', true);
  return unwrap(await q.order('created_at'));
}

export async function upsertService(input: ServiceInput): Promise<void> {
  const uid = await requireUserId();
  const existing = unwrap(
    await supabase
      .from('provider_services')
      .select('id')
      .eq('provider_id', uid)
      .eq('category_id', input.categoryId)
      .maybeSingle(),
  ) as { id: string } | null;
  const fields = {
    skill_level: input.skillLevel,
    visit_fee: input.visitFee,
    labour_rate: input.labourRate,
    rate_unit: input.rateUnit,
    ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
    ...(input.maxTravelKm === undefined ? {} : { max_travel_km: input.maxTravelKm }),
    ...(input.travelFeeMode === undefined ? {} : { travel_fee_mode: input.travelFeeMode }),
    ...(input.travelFeeFlat === undefined ? {} : { travel_fee_flat: input.travelFeeFlat }),
    ...(input.travelFeePerKm === undefined ? {} : { travel_fee_per_km: input.travelFeePerKm }),
    active: true,
  };
  if (existing) unwrap(await supabase.from('provider_services').update(fields).eq('id', existing.id));
  else unwrap(await supabase.from('provider_services').insert({ provider_id: uid, category_id: input.categoryId, ...fields }));
}

// Soft delete: past bookings reference the service row, so it is deactivated (hidden from search) instead.
export async function deleteService(id: string): Promise<void> {
  unwrap(await supabase.from('provider_services').update({ active: false }).eq('id', id));
}

export async function addRateCardItem(providerServiceId: string, title: string, price: number): Promise<void> {
  unwrap(await supabase.from('rate_card_items').insert({ provider_service_id: providerServiceId, title, price }));
}

export async function getProviderJobs(): Promise<ProviderJob[]> {
  return unwrap(await supabase.rpc('get_provider_jobs'));
}

export async function listMyPayouts(): Promise<Payout[]> {
  const uid = await requireUserId();
  return unwrap(
    await supabase.from('payouts').select('*').or(`provider_id.eq.${uid},payee_id.eq.${uid}`).order('created_at', { ascending: false }),
  );
}

export async function getProviderStatement(from: string, to: string): Promise<ProviderStatementRow[]> {
  await requireUserId();
  return unwrap(await supabase.rpc('get_provider_statement', { p_from: from, p_to: to }));
}

// ---------- Chat & realtime ----------
export async function listMessages(bookingId: string): Promise<Message[]> {
  return unwrap(
    await supabase.from('messages').select('*').eq('booking_id', bookingId).order('created_at', { ascending: true }),
  );
}

export async function sendMessage(bookingId: string, body: string): Promise<void> {
  unwrap(await supabase.rpc('send_booking_message', { p_booking_id: bookingId, p_body: body }));
}

export function subscribeToMessages(bookingId: string, onMessage: (m: Message) => void): () => void {
  const channel = supabase
    .channel(`messages:${bookingId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
      (payload) => onMessage(payload.new as Message),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToBooking(bookingId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`booking:${bookingId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToMyMessages(onMessage: (m: Message) => void): () => void {
  // No filter: Realtime applies the messages RLS policy, so only the user's own chats arrive.
  const channel = supabase
    .channel(`my-messages:${Date.now().toString(36)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => onMessage(payload.new as Message))
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- Read state & push devices ----------
export async function getUnreadCounts(): Promise<UnreadCount[]> {
  return unwrap(await supabase.rpc('get_unread_counts')) ?? [];
}

export async function markChatRead(bookingId: string, viewing: boolean | null = null): Promise<void> {
  await rpcVoid('mark_chat_read', { p_booking_id: bookingId, p_viewing: viewing });
}

export async function getChatReadState(bookingId: string): Promise<ChatReadState> {
  const rows = unwrap(await supabase.rpc('get_chat_read_state', { p_booking_id: bookingId })) as ChatReadState[] | null;
  return rows?.[0] ?? { my_last_read_at: null, other_last_read_at: null };
}

export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  return (unwrap(await supabase.rpc('list_my_notifications', { p_limit: limit })) as AppNotification[] | null) ?? [];
}

export async function countUnreadNotifications(): Promise<number> {
  return Number(unwrap(await supabase.rpc('count_unread_notifications')) ?? 0);
}

export async function markNotificationsRead(ids: string[] | null = null): Promise<void> {
  await rpcVoid('mark_notifications_read', { p_ids: ids });
}

export async function getChatHeading(bookingId: string): Promise<{ name: string; category: string | null } | null> {
  return (unwrap(await supabase.rpc('get_chat_heading', { p_booking_id: bookingId })) as { name: string; category: string | null } | null) ?? null;
}

let registeredPushToken: string | null = null;

export async function registerPushDevice(token: string, platform: PushPlatform): Promise<void> {
  await rpcVoid('register_push_device', { p_token: token, p_platform: platform });
  registeredPushToken = token;
}

export async function unregisterPushDevice(token: string): Promise<void> {
  await rpcVoid('unregister_push_device', { p_token: token });
  if (registeredPushToken === token) registeredPushToken = null;
}
