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
  ServicePackage,
  TravelPreview,
  TravelRequest,
  TravelFeeMode,
  ServiceRequest,
  Proposal,
  ProposalRequest,
  PaymentSchedule,
  RequestMessage,
  DeliveryLink,
  CreateServiceRequestInput,
  SendProposalInput,
} from './types';
import type { AppNotification, UnreadCount } from './unread';
import type { CoinLedgerEntry, CoinRedemptionPreview } from './coins';

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
  travelRequestId?: string | null;
}

export interface FixedBookingLocation {
  mode: 'at_customer';
  addressId?: string | null;
  addressLine?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

export interface CreateFixedBookingInput {
  packageId: string;
  quantity: number;
  windowStart: Date;
  windowEnd: Date;
  location: FixedBookingLocation;
  intake?: Record<string, unknown>;
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
  purpose: 'visit_fee' | 'balance' | 'fixed' | 'advance' | 'milestone' | 'final' | 'platform_fee' | 'package' | 'addon' | 'session';
  schedule_id?: string | null;
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
  attributes?: Record<string, unknown>;
  maxTravelKm?: number | null;
  travelFeeMode?: TravelFeeMode;
  travelFeeFlat?: number;
  travelFeePerKm?: number;
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
  listCategories(city?: string): Promise<Category[]>;
  searchProviders(categorySlug: string, coords: Coords | null, filters: SearchFilters): Promise<ProviderSearchResult[]>;
  listTopRated(limit?: number): Promise<TopRatedProvider[]>;
  getProviderDetail(providerId: string): Promise<ProviderDetail>;
  getProviderService(id: string): Promise<ProviderServiceWithProvider>;
  inspectTravelRequest(providerServiceId: string, coords: Coords, scheduledAt: Date | null): Promise<TravelPreview>;
  createTravelRequest(providerServiceId: string, scheduledAt: Date, coords: Coords, note?: string): Promise<string>;
  listMyTravelRequests(status?: string): Promise<TravelRequest[]>;
  respondToTravelRequest(id: string, approve: boolean, reason?: string): Promise<void>;
  // saved addresses
  listMyAddresses(): Promise<SavedAddress[]>;
  addAddress(input: NewAddressInput): Promise<SavedAddress>;
  // booking
  createBooking(input: CreateBookingInput): Promise<string>;
  createFixedBooking(input: CreateFixedBookingInput): Promise<string>;
  listFixedPackages(providerServiceId: string): Promise<ServicePackage[]>;
  sendFixedAddons(
    bookingId: string,
    addons: { title: string; qty: number; unit?: string; unit_price: number }[],
    note?: string,
  ): Promise<string>;
  approveFixedChangeOrder(bookingId: string, quoteId: string): Promise<{ amount_due: number; refund: number; quote_id: string }>;
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
  approveQuote(bookingId: string, quoteId: string, useCoins?: boolean): Promise<{ amount_due: number; coins_redeemed_paise?: number }>;
  submitReview(bookingId: string, r: ReviewInput): Promise<string>;
  // Seva Coins
  getMyCoinBalance(): Promise<number>;
  listCoinHistory(limit?: number): Promise<CoinLedgerEntry[]>;
  getCoinRedemptionPreview(bookingId: string, quoteId: string): Promise<CoinRedemptionPreview>;
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
  /** In-app notification centre (newest first; chats are grouped per booking by the screen). */
  listNotifications(limit?: number): Promise<AppNotification[]>;
  /** Unread non-chat notifications (chat messages are counted by getUnreadCounts). */
  countUnreadNotifications(): Promise<number>;
  /** Marks the given notifications read, or all of them when ids is omitted. */
  markNotificationsRead(ids?: string[] | null): Promise<void>;
  /** The other participant's first name and the service, for "New message from Ravi · AC Repair". */
  getChatHeading(bookingId: string): Promise<{ name: string; category: string | null } | null>;
  registerPushDevice(token: string, platform: PushPlatform): Promise<void>;
  unregisterPushDevice(token: string): Promise<void>;
  // proposal / milestone booking
  createServiceRequest(input: CreateServiceRequestInput): Promise<string>;
  cancelServiceRequest(id: string): Promise<void>;
  listMyServiceRequests(): Promise<ServiceRequest[]>;
  listProviderServiceRequests(): Promise<ProposalRequest[]>;
  getServiceRequest(id: string): Promise<ServiceRequest | null>;
  listRequestProposals(requestId: string): Promise<Proposal[]>;
  getProposal(id: string): Promise<Proposal>;
  sendProposal(input: SendProposalInput): Promise<string>;
  withdrawProposal(id: string): Promise<void>;
  acceptProposal(id: string, addressId?: string | null): Promise<string>;
  listRequestMessages(requestId: string, providerId: string): Promise<RequestMessage[]>;
  sendRequestMessage(requestId: string, providerId: string, body: string): Promise<void>;
  listPaymentSchedule(bookingId: string): Promise<PaymentSchedule[]>;
  createSchedulePayment(bookingId: string, scheduleId: string): Promise<PaymentLinkResponse>;
  startProposalBooking(bookingId: string, otp: string): Promise<OtpResult>;
  beginDelivery(bookingId: string): Promise<void>;
  submitDelivery(bookingId: string, links: DeliveryLink[]): Promise<void>;
  acceptDelivery(bookingId: string): Promise<void>;
}
