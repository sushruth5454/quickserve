export type BookingStatus =
  | 'pending_payment'
  | 'requested'
  | 'accepted'
  | 'en_route'
  | 'inspecting'
  | 'quote_sent'
  | 'awaiting_payment'
  | 'in_progress'
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
export type QuoteItemKind = 'labour' | 'part' | 'other';
export type PaymentPurpose = 'visit_fee' | 'balance' | 'fixed';
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
  profile_schema?: Record<string, unknown>;
  review_tags?: string[];
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
  categories?: Pick<Category, 'name' | 'slug' | 'review_tags'> | null;
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
  cancelled_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  completion_requested_at: string | null;
  completed_at: string | null;
  categories?: Pick<Category, 'name' | 'slug' | 'review_tags'> | null;
  /** The pro, embedded for customer-facing lists (null if the provider is no longer public). */
  providers?: { rating_avg: number; rating_count: number; profiles: { full_name: string } | null } | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  kind: QuoteItemKind;
  title: string;
  qty: number;
  unit_price: number;
  bill_photo_url: string | null;
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
  total: number;
  note: string | null;
  created_at: string;
  quote_items: QuoteItem[];
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
