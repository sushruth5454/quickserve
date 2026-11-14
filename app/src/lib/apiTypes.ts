import type {
  Booking,
  BookingAddress,
  BookingEvent,
  BookingOtps,
  Category,
  Message,
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
  NewAddressInput,
  Review,
  ReviewInput,
  SavedAddress,
  SearchFilters,
  SkillLevel,
} from './types';
import type { UnreadCount } from './unread';

export interface Coords {
  lat: number;
  lng: number;
}

export interface AuthSession {
  userId: string;
  phone: string | null;
}

export interface TopRatedProvider {
  id: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  jobs_completed: number;
  years_experience: number;
  is_online: boolean;
  profiles: { full_name: string; avatar_url: string | null } | null;
  /** Active services, for the card's category/skill/visit-fee line. Optional so older callers still type-check. */
  provider_services?: TopRatedService[];
}

export interface TopRatedService {
  visit_fee: number;
  skill_level: SkillLevel;
  active: boolean;
  categories: { name: string; slug: string } | null;
}

export interface ProviderDetail {
  provider: Provider & { profiles: { full_name: string; avatar_url: string | null } | null };
  services: ProviderService[];
  reviews: Review[];
}

export type ProviderServiceWithProvider = ProviderService & {
  providers: { rating_avg: number; rating_count: number; profiles: { full_name: string } | null } | null;
};

export interface CreateBookingInput {
  providerServiceId: string;
  description: string;
  addressLine: string;
  city: string;
  coords: Coords;
  scheduledAt: Date | null;
  photos: string[];
}

export interface ChatReadState {
  /** When the signed-in user last read this chat (null: never). */
  my_last_read_at: string | null;
  /** When the other participant last read it, for "Seen". */
  other_last_read_at: string | null;
}

export type PushPlatform = 'ios' | 'android' | 'web';

export interface PaymentLinkResponse {
  short_url: string;
  amount: number;
  purpose: 'visit_fee' | 'balance' | 'fixed';
}

export interface ProviderProfileInput {
  fullName: string;
  bio: string;
  city: string;
  serviceRadiusKm: number;
  coords: Coords | null;
  yearsExperience: number;
  languages: string[];
}

export interface ServiceInput {
  categoryId: string;
  skillLevel: SkillLevel;
  visitFee: number;
  labourRate: number;
  rateUnit: RateUnit;
}

/** The backend contract the screens use. Implemented by supabaseApi.ts (real) and demo/demoApi.ts (in-memory). */
export interface Api {
  // auth
  getSession(): Promise<AuthSession | null>;
  onAuthChange(cb: (s: AuthSession | null) => void): () => void;
  sendOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, token: string): Promise<void>;
  signOut(): Promise<void>;
  requestAccountDeletion(): Promise<void>;
  getMyProfile(): Promise<Profile | null>;
  updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'role_customer' | 'role_provider'>>): Promise<void>;
  // discovery
  listCategories(): Promise<Category[]>;
  searchProviders(categorySlug: string, coords: Coords | null, filters: SearchFilters): Promise<ProviderSearchResult[]>;
  listTopRated(limit?: number): Promise<TopRatedProvider[]>;
  getProviderDetail(providerId: string): Promise<ProviderDetail>;
  getProviderService(id: string): Promise<ProviderServiceWithProvider>;
  // saved addresses
  listMyAddresses(): Promise<SavedAddress[]>;
  addAddress(input: NewAddressInput): Promise<SavedAddress>;
  // booking
  createBooking(input: CreateBookingInput): Promise<string>;
  createPayment(bookingId: string): Promise<PaymentLinkResponse>;
  listMyBookings(): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking>;
  getQuotes(bookingId: string): Promise<Quote[]>;
  getPayments(bookingId: string): Promise<Payment[]>;
  getEvents(bookingId: string): Promise<BookingEvent[]>;
  getBookingOtps(bookingId: string): Promise<BookingOtps | null>;
  getBookingAddress(bookingId: string): Promise<BookingAddress | null>;
  getReviewForBooking(bookingId: string): Promise<Review | null>;
  getProfileName(userId: string): Promise<string>;
  signedPhotoUrls(paths: string[]): Promise<string[]>;
  uploadJobPhoto(uri: string, mimeType?: string): Promise<string>;
  // transitions
  acceptBooking(id: string): Promise<void>;
  declineBooking(id: string, reason?: string): Promise<void>;
  startTrip(id: string): Promise<void>;
  requestCompletion(id: string): Promise<void>;
  confirmCompletion(id: string): Promise<void>;
  cancelBooking(id: string, reason?: string): Promise<void>;
  disputeBooking(id: string, reason: string): Promise<void>;
  regenerateOtp(id: string, kind: 'start' | 'end'): Promise<void>;
  rejectQuote(bookingId: string, quoteId: string): Promise<void>;
  arrive(id: string, otp: string): Promise<OtpResult>;
  completeBooking(id: string, otp: string): Promise<OtpResult>;
  sendQuote(bookingId: string, items: QuoteItemDraft[], note?: string): Promise<string>;
  approveQuote(bookingId: string, quoteId: string): Promise<{ amount_due: number }>;
  submitReview(bookingId: string, r: ReviewInput): Promise<string>;
  // provider
  getMyProvider(): Promise<Provider | null>;
  upsertProviderProfile(input: ProviderProfileInput): Promise<void>;
  setOnline(online: boolean): Promise<void>;
  /** Active services only unless includeInactive (for the Me > My services toggle list). */
  listMyServices(includeInactive?: boolean): Promise<ProviderService[]>;
  upsertService(input: ServiceInput): Promise<void>;
  deleteService(id: string): Promise<void>;
  addRateCardItem(providerServiceId: string, title: string, price: number): Promise<void>;
  getProviderJobs(): Promise<ProviderJob[]>;
  listMyPayouts(): Promise<Payout[]>;
  // chat & realtime
  listMessages(bookingId: string): Promise<Message[]>;
  sendMessage(bookingId: string, body: string): Promise<void>;
  subscribeToMessages(bookingId: string, onMessage: (m: Message) => void): () => void;
  subscribeToBooking(bookingId: string, onChange: () => void): () => void;
  /** Every new message in any of the user's chats (RLS-scoped), for unread badges. */
  subscribeToMyMessages(onMessage: (m: Message) => void): () => void;
  // read state & push
  /** Unread messages per booking for the signed-in user (only bookings with unread > 0). */
  getUnreadCounts(): Promise<UnreadCount[]>;
  /** Marks the chat read. viewing: true while open and focused (suppresses pushes), false when leaving. */
  markChatRead(bookingId: string, viewing?: boolean | null): Promise<void>;
  getChatReadState(bookingId: string): Promise<ChatReadState>;
  registerPushDevice(token: string, platform: PushPlatform): Promise<void>;
  unregisterPushDevice(token: string): Promise<void>;
}
