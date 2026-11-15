import { Linking } from 'react-native';
import type {
  AuthSession,
  ChatReadState,
  PushPlatform,
  Coords,
  CreateBookingInput,
  PaymentLinkResponse,
  ProviderDetail,
  ProviderProfileInput,
  ProviderServiceWithProvider,
  ServiceInput,
  TopRatedProvider,
} from './apiTypes';
import { supabase } from './supabase';
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
} from './types';
import type { UnreadCount } from './unread';

interface Result<T> {
  data?: T | null;
  error: { message: string } | null;
}

function unwrap<T>(res: Result<T>): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

// ---------- Auth & profile ----------
export async function getSession(): Promise<AuthSession | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return user ? { userId: user.id, phone: user.phone ?? null } : null;
}

export function onAuthChange(cb: (s: AuthSession | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, next) =>
    cb(next?.user ? { userId: next.user.id, phone: next.user.phone ?? null } : null),
  );
  return () => data.subscription.unsubscribe();
}

/**
 * There is no self-serve deletion RPC yet (it needs refund/payout checks first), so this opens a pre-filled
 * deletion request email to support. Store policies accept an in-app path that initiates deletion.
 */
export async function requestAccountDeletion(): Promise<void> {
  const uid = await requireUserId();
  const subject = encodeURIComponent('Delete my QuickServe account');
  const body = encodeURIComponent(`Please delete my account and personal data.\n\nUser ID: ${uid}`);
  await Linking.openURL(`mailto:support@quickserve.app?subject=${subject}&body=${body}`);
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
  unwrap(await supabase.auth.signOut());
}

const PROFILE_COLUMNS = 'id, full_name, avatar_url, role_customer, role_provider, created_at';

export async function getMyProfile(): Promise<Profile | null> {
  const uid = await requireUserId();
  return unwrap(await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', uid).maybeSingle<Profile>());
}

export async function updateMyProfile(
  patch: Partial<Pick<Profile, 'full_name' | 'role_customer' | 'role_provider'>>,
): Promise<void> {
  const uid = await requireUserId();
  unwrap(await supabase.from('profiles').update(patch).eq('id', uid));
}

// ---------- Discovery ----------
export async function listCategories(): Promise<Category[]> {
  return unwrap(await supabase.from('categories').select('*').order('sort_order'));
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

export async function listTopRated(limit = 10): Promise<TopRatedProvider[]> {
  const { data: auth } = await supabase.auth.getSession();
  let query = supabase
    .from('providers')
    .select(
      'id, city, rating_avg, rating_count, jobs_completed, years_experience, is_online, profiles(full_name, avatar_url), provider_services(visit_fee, skill_level, active, categories(name, slug))',
    )
    .eq('kyc_status', 'verified')
    .eq('suspended', false)
    .eq('paused', false)
    .gt('rating_count', 0);
  // Like search_providers, never suggest the signed-in user's own provider profile.
  if (auth.session) query = query.neq('id', auth.session.user.id);
  return unwrap(
    await query
      .order('rating_avg', { ascending: false })
      .order('rating_count', { ascending: false })
      .limit(limit)
      .overrideTypes<TopRatedProvider[], { merge: false }>(),
  );
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
      .select('*, categories(name, slug), rate_card_items(*), service_packages(*)')
      .eq('provider_id', providerId)
      .eq('active', true),
    supabase
      .from('reviews')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  return {
    provider: { razorpay_account_id: null, ...(unwrap(provider) as object) } as ProviderDetail['provider'],
    services: unwrap(services) as ProviderService[],
    reviews: unwrap(reviews) as Review[],
  };
}

export async function getProviderService(id: string): Promise<ProviderServiceWithProvider> {
  return unwrap(
    await supabase
      .from('provider_services')
      .select('*, categories(name, slug), providers(rating_avg, rating_count, profiles(full_name)), service_packages(*)')
      .eq('id', id)
      .single(),
  );
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
    }),
  );
}

export async function createPayment(bookingId: string): Promise<PaymentLinkResponse> {
  const { data, error } = await supabase.functions.invoke<PaymentLinkResponse>('create-payment', {
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

const BOOKING_SELECT = '*, categories(name, slug, review_tags), providers(rating_avg, rating_count, profiles(full_name))';

export async function listMyBookings(): Promise<Booking[]> {
  const uid = await requireUserId();
  return unwrap(
    await supabase.from('bookings').select(BOOKING_SELECT).eq('customer_id', uid).order('created_at', { ascending: false }),
  );
}

export async function getBooking(id: string): Promise<Booking> {
  return unwrap(await supabase.from('bookings').select(BOOKING_SELECT).eq('id', id).single());
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
      .select('*, refunds(amount, status)')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true }),
  );
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
export const startTrip = (id: string) => rpcVoid('start_trip', { p_booking_id: id });
export const requestCompletion = (id: string) => rpcVoid('request_completion', { p_booking_id: id });
export const confirmCompletion = (id: string) => rpcVoid('confirm_completion', { p_booking_id: id });
export const cancelBooking = (id: string, reason?: string) =>
  rpcVoid('cancel_booking', { p_booking_id: id, p_reason: reason ?? null });
export const disputeBooking = (id: string, reason: string) =>
  rpcVoid('dispute_booking', { p_booking_id: id, p_reason: reason });
export const regenerateOtp = (id: string, kind: 'start' | 'end') =>
  rpcVoid('regenerate_otp', { p_booking_id: id, p_kind: kind });
export const rejectQuote = (bookingId: string, quoteId: string) =>
  rpcVoid('reject_quote', { p_booking_id: bookingId, p_quote_id: quoteId });

export async function arrive(id: string, otp: string): Promise<OtpResult> {
  return unwrap(await supabase.rpc('arrive', { p_booking_id: id, p_otp: otp }));
}

export async function completeBooking(id: string, otp: string): Promise<OtpResult> {
  return unwrap(await supabase.rpc('complete_booking', { p_booking_id: id, p_otp: otp }));
}

export async function sendQuote(bookingId: string, items: QuoteItemDraft[], note?: string): Promise<string> {
  return unwrap(await supabase.rpc('send_quote', { p_booking_id: bookingId, p_items: items, p_note: note ?? null }));
}

export async function approveQuote(bookingId: string, quoteId: string): Promise<{ amount_due: number }> {
  return unwrap(await supabase.rpc('approve_quote', { p_booking_id: bookingId, p_quote_id: quoteId }));
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

// ---------- Provider ----------
export async function getMyProvider(): Promise<Provider | null> {
  await requireUserId();
  // Own row incl. private columns via RPC (select('*') is blocked by column privileges since migration 0009).
  return unwrap(await supabase.rpc('get_my_provider')) as Provider | null;
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
  let q = supabase.from('provider_services').select('*, categories(name, slug), rate_card_items(*), service_packages(*)').eq('provider_id', uid);
  if (!includeInactive) q = q.eq('active', true);
  return unwrap(await q.order('created_at'));
}

export async function upsertService(input: ServiceInput): Promise<void> {
  const uid = await requireUserId();
  unwrap(
    await supabase.from('provider_services').upsert(
      {
        provider_id: uid,
        category_id: input.categoryId,
        skill_level: input.skillLevel,
        visit_fee: input.visitFee,
        labour_rate: input.labourRate,
        rate_unit: input.rateUnit,
        attributes: input.attributes ?? {},
        active: true,
      },
      { onConflict: 'provider_id,category_id' },
    ),
  );
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
    await supabase.from('payouts').select('*').eq('provider_id', uid).order('created_at', { ascending: false }),
  );
}

// ---------- Chat & realtime ----------
export async function listMessages(bookingId: string): Promise<Message[]> {
  return unwrap(
    await supabase.from('messages').select('*').eq('booking_id', bookingId).order('created_at', { ascending: true }),
  );
}

export async function sendMessage(bookingId: string, body: string): Promise<void> {
  const uid = await requireUserId();
  unwrap(await supabase.from('messages').insert({ booking_id: bookingId, sender_id: uid, body }));
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

let registeredPushToken: string | null = null;

export async function registerPushDevice(token: string, platform: PushPlatform): Promise<void> {
  await rpcVoid('register_push_device', { p_token: token, p_platform: platform });
  registeredPushToken = token;
}

export async function unregisterPushDevice(token: string): Promise<void> {
  await rpcVoid('unregister_push_device', { p_token: token });
  if (registeredPushToken === token) registeredPushToken = null;
}