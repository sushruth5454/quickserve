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
  ProviderStatementRow,
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

export interface LiveCity {
  city: string;
  categories: number;
  providers: number;
  lat: number | null;
  lng: number | null;
}

export interface AuthSession {
  userId: string;
  phone: string | null;
}

export interface CancellationPreview {
  refund_amount: number;
  charged_amount: number;
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

export interface PublicReview {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  behaviour: number | null;
  pricing: number | null;
  comment: string | null;
  provider_reply: string | null;
  created_at: string;
}

export interface ProviderDetail {
  provider: Provider & { profiles: { full_name: string; avatar_url: string | null } | null };
  services: ProviderService[];
  reviews: PublicReview[];
}

export type ProviderServiceWithProvider = ProviderService & {
  providers: { rating_avg: number; rating_count: number; is_online?: boolean; paused?: boolean; profiles: { full_name: string } | null } | null;
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

export interface PaymentReceiptItem {
  description: string;
  kind: string;
  qty: number;
  unit_price: number;
  amount: number;
}

export interface PaymentReceiptPayment {
  amount: number;
  purpose?: string | null;
  method: string | null;
  gateway_ref: string | null;
  paid_at: string | null;
}

export interface PaymentReceiptRefund {
  amount: number;
  status: string;
  processed_at: string | null;
}

export interface PaymentReceiptSnapshot {
  receipt_no: string;
  issued_at: string;
  status: string;
  booking_ref: string;
  category: string;
  provider_display_name: string;
  customer_name: string;
  customer_locality: string | null;
  items: PaymentReceiptItem[];
  subtotal: number;
  platform_fee: number;
  tax_lines: { label: string; amount: number }[];
  coins_discount: number;
  total: number;
  prior_payments: PaymentReceiptPayment[];
  this_payment: PaymentReceiptPayment;
  balance_due: number;
  refunds: PaymentReceiptRefund[];
  dispute_link: string | null;
  tax_invoice_url: string | null;
}

export interface PaymentReceipt {
  id: string;
  receipt_no: string;
  payment_id: string;
  booking_id: string;
  issued_at: string;
  snapshot: PaymentReceiptSnapshot;
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

export interface CommissionTier {
  min_jobs: number;
  bp: number;
}

export interface TimeBasedCommissionRates {
  one_off_bp: number;
  recurring_bp: number;
}

export interface CommissionTerms {
  founding_days: number;
  tiers: CommissionTier[];
  repeat_discount_bp: number;
  repeat_floor_bp: number;
  time_based: TimeBasedCommissionRates;
  my_bp: number | null;
  my_free_until: string | null;
}

/** The backend contract the screens use. Implemented by supabaseApi.ts (real) and demo/demoApi.ts (in-memory). */
export interface Api {
  // auth
  getSession(): Promise<AuthSession | null>;
  onAuthChange(cb: (s: AuthSession | null) => void): () => void;
  sendOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, token: string): Promise<void>;
  signOut(): Promise<void>;
  requestAccountDeletion(): Promise<AccountDeletionOutcome>;
  getMyProfile(): Promise<Profile | null>;
  updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'role_customer' | 'role_provider'>>): Promise<void>;
  // discovery
  listCategories(city?: string): Promise<Category[]>;
  searchProviders(categorySlug: string, coords: Coords | null, filters: SearchFilters): Promise<ProviderSearchResult[]>;
  listTopRated(limit?: number, city?: string | null): Promise<TopRatedProvider[]>;
  /** Cities with live providers, with a centre point to switch the location to. */
  listLiveCities(): Promise<LiveCity[]>;
  /** The live service city covering a point (keeps an already-live city name); null when the area is not served. */
  resolveServiceCity(lat: number, lng: number, city?: string | null): Promise<string | null>;
  /** Adds the user to a city's launch waitlist; false when they were already on it. */
  joinCityWaitlist(city: string, lat?: number | null, lng?: number | null): Promise<boolean>;
  onCityWaitlist(city: string): Promise<boolean>;
  getProviderDetail(providerId: string): Promise<ProviderDetail>;
  getProviderService(id: string): Promise<ProviderServiceWithProvider>;
  inspectTravelRequest(providerServiceId: string, coords: Coords, scheduledAt: Date | null): Promise<TravelPreview>;
  createTravelRequest(providerServiceId: string, scheduledAt: Date, coords: Coords, note?: string): Promise<string>;
  listMyTravelRequests(status?: string): Promise<TravelRequest[]>;
  respondToTravelRequest(id: string, approve: boolean, reason?: string): Promise<void>;
  // saved addresses
  listMyAddresses(): Promise<SavedAddress[]>;
  addAddress(input: NewAddressInput): Promise<SavedAddress>;
  deleteAddress(id: string): Promise<void>;
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
  getBookingCommissionRate(bookingId: string): Promise<number>;
  getQuotes(bookingId: string): Promise<Quote[]>;
  getPayments(bookingId: string): Promise<Payment[]>;
  getReceipt(paymentId: string): Promise<PaymentReceipt | null>;
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
  previewCancellation(id: string): Promise<CancellationPreview | null>;
  cancelBooking(id: string, reason?: string): Promise<void>;
  providerCancelBooking(id: string, reason?: 'provider_cancellation' | 'provider_no_show'): Promise<void>;
  disputeBooking(id: string, reason: string): Promise<void>;
  reportNoShow(id: string, absentParty: 'customer' | 'provider'): Promise<void>;
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
  getCommissionTerms(): Promise<CommissionTerms>;
  upsertProviderProfile(input: ProviderProfileInput): Promise<void>;
  setOnline(online: boolean): Promise<void>;
  /** Active services only unless includeInactive (for the Me > My services toggle list). */
  listMyServices(includeInactive?: boolean): Promise<ProviderService[]>;
  upsertService(input: ServiceInput): Promise<void>;
  deleteService(id: string): Promise<void>;
  addRateCardItem(providerServiceId: string, title: string, price: number): Promise<void>;
  getProviderJobs(): Promise<ProviderJob[]>;
  listMyPayouts(): Promise<Payout[]>;
  getProviderStatement(from: string, to: string): Promise<ProviderStatementRow[]>;
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
  /** The signed-in provider's own proposals (latest first), to show what they have already sent. */
  listMyProposals(): Promise<Proposal[]>;
  acceptProposal(id: string, addressId?: string | null): Promise<string>;
  listRequestMessages(requestId: string, providerId: string): Promise<RequestMessage[]>;
  sendRequestMessage(requestId: string, providerId: string, body: string): Promise<void>;
  listPaymentSchedule(bookingId: string): Promise<PaymentSchedule[]>;
  createSchedulePayment(bookingId: string, scheduleId: string): Promise<PaymentLinkResponse>;
  startProposalBooking(bookingId: string, otp: string): Promise<OtpResult>;
  beginDelivery(bookingId: string): Promise<void>;
  submitDelivery(bookingId: string, links: DeliveryLink[]): Promise<void>;
  acceptDelivery(bookingId: string): Promise<void>;
  cancelProposalPaymentDefault(bookingId: string): Promise<void>;
}

export type AccountDeletionOutcome = 'recorded' | 'email';
