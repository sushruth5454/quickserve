export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'requested'
  | 'accepted'
  | 'en_route'
  | 'inspecting'
  | 'quote_sent'
  | 'awaiting_payment'
  | 'in_progress'
  | 'delivery_pending'
  | 'completion_requested'
  | 'completed'
  | 'closed'
  | 'closed_no_work'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'disputed'
  | 'refunded';

export type SkillLevel = 'beginner' | 'skilled' | 'expert' | 'certified';
export type KycStatus = 'pending' | 'verified' | 'rejected' | 'under_review' | 'needs_clarification' | 'suspended';
export type RateUnit = 'hour' | 'job';
export type QuoteStatus = 'sent' | 'approved_pending_payment' | 'approved' | 'rejected' | 'superseded';
export type BookingArchetype = 'fixed' | 'inspect_quote' | 'proposal' | 'time_based' | 'remote';
export type LocationMode = 'at_customer' | 'at_provider' | 'at_venue' | 'remote';
export type TravelFeeMode = 'none' | 'flat' | 'per_km';
export type TravelRequestStatus = 'pending' | 'approved' | 'declined' | 'expired' | 'used';
export type QuoteItemKind =
  | 'labour' | 'part' | 'other' | 'material' | 'package' | 'per_unit'
  | 'travel' | 'rental' | 'discount' | 'addon';
export type ProposalItemKind = QuoteItemKind;
export type PaymentPurpose =
  | 'visit_fee' | 'balance' | 'fixed' | 'advance' | 'milestone' | 'final'
  | 'platform_fee' | 'package' | 'addon' | 'session';
export type PaymentStatus = 'created' | 'paid' | 'failed' | 'refund_pending' | 'refund_processing' | 'refunded';
export type PayoutStatus = 'pending' | 'frozen' | 'transferred' | 'failed' | 'reversed' | 'partially_reversed';
export type SortOption = 'recommended' | 'rating' | 'price' | 'distance' | 'experience';

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role_customer: boolean;
  role_provider: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  pricing_mode: 'quote' | 'fixed';
  sort_order: number;
  active?: boolean;
  vertical?: string;
  parent_id?: string | null;
  archetype?: BookingArchetype;
  location_modes?: LocationMode[];
  pricing_units?: PackageUnit[];
  intake_schema?: Record<string, unknown>;
  payment_template?: string;
  cancellation_policy?: string;
  commission_bp?: number | null;
  profile_schema?: Record<string, unknown>;
  review_tags?: string[];
  requires_docs?: string[];
  recommended_docs?: string[];
  restricted?: boolean;
  config_version?: number;
  min_lead_hours?: number;
  max_lead_days?: number;
  live?: boolean;
}

export interface ProviderSearchResult {
  provider_id: string;
  provider_service_id: string;
  full_name: string;
  avatar_url: string | null;
  city: string;
  skill_level: SkillLevel;
  visit_fee: number;
  labour_rate: number;
  rate_unit: RateUnit;
  rating_avg: number;
  rating_count: number;
  jobs_completed: number;
  years_experience: number;
  is_online: boolean;
  paused?: boolean;
  distance_km: number | null;
  score: number;
}

export interface Provider {
  id: string;
  bio: string;
  city: string;
  service_radius_km: number;
  years_experience: number;
  languages: string[];
  kyc_status: KycStatus;
  suspended: boolean;
  is_online: boolean;
  paused?: boolean;
  rating_avg: number;
  rating_count: number;
  jobs_completed: number;
  commission_tier: number;
  razorpay_account_id: string | null;
  created_at: string;
}

export interface RateCardItem {
  id: string;
  provider_service_id: string;
  title: string;
  price: number;
}

export type PackagePriceType = 'fixed' | 'range' | 'from' | 'quote';
export type PackageUnit = 'job' | 'hour' | 'day' | 'session' | 'person' | 'plate' | 'sqft' | 'bhk' | 'seat' | 'litre' | 'event' | 'month';
export interface PackageDeliverable { type: string; qty: number; spec: string; }
export interface ServicePackage {
  id: string; provider_service_id: string; package_template_id: string | null; title: string; description: string;
  price_type: PackagePriceType; price: number | null; price_min: number | null; price_max: number | null; unit: PackageUnit;
  qty_min: number; qty_max: number; duration_min: number | null; inclusions: string[]; exclusions: string[];
  deliverables: PackageDeliverable[]; turnaround_days: number | null; revisions_included: number; raw_files_included: boolean;
  usage_rights: { organic_posting?: boolean; paid_ads_days?: number; exclusivity_days?: number };
  travel_included_km: number; active: boolean; sort_order: number; created_at: string; updated_at: string;
}

export interface ProviderService {
  id: string;
  provider_id: string;
  category_id: string;
  skill_level: SkillLevel;
  visit_fee: number;
  labour_rate: number;
  rate_unit: RateUnit;
  active: boolean;
  attributes?: Record<string, unknown>;
  max_travel_km?: number | null;
  travel_fee_mode?: TravelFeeMode;
  travel_fee_flat?: number;
  travel_fee_per_km?: number;
  categories?: Pick<Category, 'name' | 'slug' | 'review_tags' | 'archetype' | 'intake_schema' | 'location_modes'> | null;
  rate_card_items?: RateCardItem[];
  service_packages?: ServicePackage[];
}

export interface Booking {
  id: string;
  customer_id: string;
  provider_id: string;
  category_id: string;
  provider_service_id: string;
  description: string;
  photos: string[];
  scheduled_at: string | null;
  status: BookingStatus;
  visit_fee: number;
  platform_fee: number;
  approved_quote_id: string | null;
  total_amount: number | null;
  commission: number | null;
  gst_on_commission: number | null;
  refund_amount: number;
  coin_discount?: number;
  cancelled_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  completion_requested_at: string | null;
  completed_at: string | null;
  archetype?: BookingArchetype;
  category_config_version?: number;
  location_mode?: LocationMode;
  pricing_snapshot?: Record<string, unknown>;
  payment_template_snapshot?: Record<string, unknown>;
  cancellation_snapshot?: Record<string, unknown>;
  platform_fee_rule_snapshot?: Record<string, unknown>;
  travel_request_id?: string | null;
  service_request_id?: string | null;
  proposal_id?: string | null;
  payment_hold_expires_at?: string | null;
  delivery_status?: 'not_applicable' | 'pending' | 'submitted' | 'accepted';
  delivery_links?: DeliveryLink[];
  travel_requests?: {
    distance_km: number;
    quoted_fee: number;
    status: TravelRequestStatus;
    expires_at: string;
  } | null;
  categories?: Pick<Category, 'name' | 'slug' | 'review_tags'> | null;
  /** The pro, embedded for customer-facing lists (null if the provider is no longer public). */
  providers?: { city?: string | null; rating_avg: number; rating_count: number; profiles: { full_name: string } | null } | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  kind: QuoteItemKind;
  title: string;
  qty: number;
  unit_price: number;
  bill_photo_url: string | null;
  travel_request_id?: string | null;
}

export interface Quote {
  id: string;
  booking_id: string;
  version: number;
  status: QuoteStatus;
  is_change_order: boolean;
  subtotal_labour: number;
  subtotal_parts: number;
  subtotal_other: number;
  subtotal_travel?: number;
  total: number;
  note: string | null;
  coin_discount?: number;
  created_at: string;
  quote_items: QuoteItem[];
}

export interface TravelPreview {
  needs_approval: boolean;
  allowed: boolean;
  distance_km: number | null;
  max_travel_km: number | null;
  quoted_fee: number;
  travel_request_id: string | null;
  status: TravelRequestStatus | null;
  expires_at: string | null;
}

export interface TravelRequest {
  id: string;
  customer_id: string;
  provider_id: string;
  provider_service_id: string;
  customer_name: string;
  provider_name: string;
  category_name: string;
  service_window: string;
  window_start?: string | null;
  window_end?: string | null;
  distance_km: number;
  quoted_fee: number;
  status: TravelRequestStatus;
  expires_at: string;
  request_note: string | null;
  response_reason: string | null;
  created_at: string;
  role: 'customer' | 'provider';
}

export interface QuoteItemDraft {
  kind: QuoteItemKind;
  title: string;
  qty: number;
  unit_price: number;
  bill_photo_url?: string;
}

export interface Payment {
  id: string;
  booking_id: string;
  quote_id: string | null;
  purpose: PaymentPurpose;
  amount: number;
  status: PaymentStatus;
  funding_source?: 'customer' | 'coins';
  created_at: string;
  paid_at: string | null;
  /** Partial or full refunds queued against this payment. */
  refunds?: { amount: number; status: 'pending' | 'processing' | 'refunded' | 'failed' }[];
}

export interface Payout {
  id: string;
  booking_id: string;
  gross: number;
  commission: number;
  gst_on_commission: number;
  amount: number;
  status: PayoutStatus;
  release_after: string;
  created_at: string;
  transferred_at: string | null;
}

export interface Review {
  id: string;
  booking_id: string;
  customer_id: string;
  provider_id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  behaviour: number | null;
  pricing: number | null;
  comment: string | null;
  provider_reply: string | null;
  tags?: string[];
  created_at: string;
}

export interface Message {
  id: string;
  booking_id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
}

export interface BookingEvent {
  id: number;
  booking_id: string;
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  note: string | null;
  at: string;
}

export interface ProviderJob {
  booking_id: string;
  status: BookingStatus;
  category_name: string;
  customer_name: string;
  description: string;
  scheduled_at: string | null;
  created_at: string;
  visit_fee: number;
  area: string;
  distance_km: number | null;
  address_line: string | null;
  lat: number | null;
  lng: number | null;
}

export interface BookingOtps {
  start_otp: string | null;
  start_locked: boolean;
  end_otp: string | null;
  end_locked: boolean;
}

/** A customer's saved address (ddresses rows, excluding the per-booking 'Booking' snapshots). */
export interface SavedAddress {
  id: string;
  label: string;
  line1: string;
  city: string;
  lat: number;
  lng: number;
  is_default: boolean;
  created_at: string;
}

export interface NewAddressInput {
  label: string;
  line1: string;
  city: string;
  lat: number;
  lng: number;
}

export interface BookingAddress {
  area: string;
  address_line: string | null;
  lat: number | null;
  lng: number | null;
}

export interface OtpResult {
  ok: boolean;
  error?: 'invalid_otp' | 'locked';
  attempts_left?: number;
}

export interface SearchFilters {
  sort: SortOption;
  minRating: number | null;
  skillLevel: SkillLevel | null;
  maxVisitFee: number | null;
  onlineOnly: boolean;
}

export interface ReviewInput {
  rating: number;
  punctuality?: number;
  quality?: number;
  behaviour?: number;
  pricing?: number;
  comment?: string;
  tags?: string[];
}

export type ServiceRequestStatus = 'open' | 'closed' | 'booked' | 'expired' | 'cancelled';
export type ProposalStatus = 'sent' | 'withdrawn' | 'accepted' | 'rejected' | 'expired';
export type ScheduleStatus = 'upcoming' | 'due' | 'paid' | 'waived' | 'refunded';

export interface ServiceRequest {
  id: string;
  customer_id: string;
  category_id: string;
  city: string;
  area: string;
  event_start: string;
  event_end: string;
  intake: Record<string, unknown>;
  budget_min: number | null;
  budget_max: number | null;
  status: ServiceRequestStatus;
  expires_at: string;
  created_at: string;
  urgent?: boolean;
  categories?: Pick<Category, 'name' | 'slug' | 'icon'> | null;
}

export interface ProposalRequest extends ServiceRequest {
  provider_id: string;
  category_name: string;
  category_slug: string;
  routed_at: string;
}

export interface ProposalItem {
  id?: string;
  proposal_id?: string;
  seq: number;
  kind: ProposalItemKind;
  title: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  bill_photo_url: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProposalScheduleInput {
  label: string;
  amount: number;
  due_rule: 'at_booking' | 'days_before_start:7' | 'days_before_start:1' | 'on_completion' | 'on_delivery';
}

export interface ProposalSchedule extends ProposalScheduleInput {
  id: string;
  proposal_id: string;
  seq: number;
  due_at: string | null;
}

export interface Proposal {
  id: string;
  request_id: string;
  provider_id: string;
  provider_service_id: string;
  version: number;
  status: ProposalStatus;
  total: number;
  valid_until: string;
  note: string | null;
  deliverables: unknown[];
  created_at: string;
  proposal_items: ProposalItem[];
  proposal_schedule: ProposalSchedule[];
  bookings?: Pick<Booking, 'id' | 'status' | 'payment_hold_expires_at'>[];
  providers?: { rating_avg: number; rating_count: number; profiles: { full_name: string } | null } | null;
}

export interface PaymentSchedule {
  id: string;
  booking_id: string;
  seq: number;
  label: string;
  amount: number;
  due_rule: string;
  due_at: string | null;
  status: ScheduleStatus;
  purpose: PaymentPurpose;
  obligation_kind: 'service' | 'platform_fee';
  payment_id: string | null;
  reminded_at: string | null;
  paid_at: string | null;
}

export interface RequestMessage {
  id: string;
  request_id: string;
  provider_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface DeliveryLink {
  title: string;
  url: string;
}

export interface CreateServiceRequestInput {
  categoryId: string;
  city: string;
  area: string;
  eventStart: Date;
  eventEnd: Date;
  intake: Record<string, unknown>;
  budgetMin: number | null;
  budgetMax: number | null;
  addressId: string | null;
  venueText: string | null;
  /** Send the brief only to this provider instead of up to 8 matching providers. */
  providerId?: string | null;
  /** Selected location; used for routing when no saved address is chosen. */
  lat?: number | null;
  lng?: number | null;
  /** Event within the category's notice period (≥ 2 hours away); pros are alerted as urgent. */
  urgent?: boolean;
}

export interface SendProposalInput {
  requestId: string;
  items: ProposalItem[];
  schedule: ProposalScheduleInput[];
  validUntil: Date;
  note?: string;
  deliverables?: unknown[];
}
