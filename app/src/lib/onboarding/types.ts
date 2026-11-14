/** Types for provider onboarding v2 (docs/08-Provider-Onboarding.md). Mirrors get_my_provider_onboarding(). */
import type { Provider, RateUnit, SkillLevel } from '../types';

export type GoLiveState = 'draft' | 'under_review' | 'action_needed' | 'live' | 'suspended' | 'deactivated';

export type ReasonCode =
  | 'payout_missing'
  | 'payout_unavailable'
  | 'payout_pending'
  | 'payout_needs_clarification'
  | 'payout_rejected'
  | 'payout_suspended'
  | 'doc_missing'
  | 'doc_pending'
  | 'doc_rejected'
  | 'doc_expired'
  | 'no_active_service'
  | 'admin_note';

export interface GoLiveReason {
  code: ReasonCode;
  severity: 'action' | 'wait';
  detail?: string | null;
  doc_type?: string;
  category?: string;
  requirements?: { field_reference: string; reason_code: string; description?: string }[];
}

export interface GoLive {
  state: GoLiveState;
  reasons: GoLiveReason[];
  paused: boolean;
  live?: boolean;
  submitted_at?: string | null;
}

export type CheckKey = 'name' | 'photo' | 'bio' | 'languages' | 'services' | 'area' | 'hours' | 'specialisations' | 'portfolio' | 'payout';

export interface Check {
  key: CheckKey;
  required: boolean;
  ok: boolean;
}

export interface WeeklySlot {
  /** 0 = Sunday … 6 = Saturday (Postgres extract(dow)). */
  weekday: number;
  /** "HH:MM" 24h; end may be "24:00". */
  start: string;
  end: string;
}

export interface TimeOff {
  id?: string;
  from: string;
  to: string;
  reason?: string | null;
}

export interface PortfolioPhoto {
  id: string;
  file_path: string;
  caption: string;
}

export type DocStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded';

export interface ProviderDocument {
  id: string;
  doc_type: string;
  category_id: string | null;
  status: DocStatus;
  reject_reason: string | null;
  expires_on: string | null;
  created_at: string;
}

export interface PayoutAccount {
  rail: 'route' | 'payouts';
  activation_status: string;
  beneficiary_name: string | null;
  bank_last4: string | null;
  ifsc: string | null;
  last_error: string | null;
  requirements: { field_reference: string; reason_code: string; description?: string }[];
  razorpay_account_id?: string | null;
  fund_account_id?: string | null;
  updated_at?: string;
}

export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say';

export interface MyProvider extends Provider {
  gender: Gender | null;
  timezone: string;
  base_area: string | null;
  max_jobs_per_day: number | null;
  paused: boolean;
  deactivated_at: string | null;
  onboarding_step: number;
  submitted_at: string | null;
  terms_version: string | null;
  kyc_reason: string | null;
  review_note: string | null;
  lat: number | null;
  lng: number | null;
}

export interface OnboardingState {
  provider: MyProvider | null;
  profile: { full_name: string; avatar_url: string | null } | null;
  payout: PayoutAccount | null;
  documents: ProviderDocument[];
  availability: WeeklySlot[];
  time_off: TimeOff[];
  portfolio: PortfolioPhoto[];
  checks: Check[];
  go_live: GoLive;
  terms_version: string;
}

export interface CategorySkill {
  id: string;
  category_id: string;
  kind: 'skill' | 'brand' | 'tool' | 'rate_item';
  slug: string;
  label: string;
  sort_order: number;
}

export interface DocumentType {
  code: string;
  label: string;
  description: string;
  has_expiry: boolean;
  sort_order: number;
}

export interface BasicsInput {
  fullName: string;
  avatarUrl: string | null;
  gender: Gender | null;
  languages: string[];
  yearsExperience: number;
  bio: string;
}

export interface ServiceAreaInput {
  city: string;
  lat: number;
  lng: number;
  radiusKm: number;
  areaName: string | null;
}

export interface ServiceDetailsInput {
  categoryId: string;
  skillLevel: SkillLevel;
  visitFee: number;
  labourRate: number;
  rateUnit: RateUnit;
  specialisations: string[];
  brands: string[];
  tools: string[];
}

export interface PriceStats {
  n: number;
  p25: number;
  median: number;
  p75: number;
}

export interface PriceGuidance {
  visit_fee: PriceStats | null;
  labour_rate: PriceStats | null;
  min_points: number;
}

export interface PayoutForm {
  legal_name: string;
  pan: string;
  email: string;
  account_number: string;
  confirm_account_number: string;
  ifsc: string;
  address?: { street: string; city: string; state: string; postal_code: string };
}

export type PayoutFieldErrors = Partial<Record<keyof PayoutForm, string>>;

export interface PayoutResult {
  rail: 'route' | 'payouts';
  state: 'submitted' | 'unavailable' | 'updated' | 'not_started' | 'nothing_to_refresh';
  message?: string;
  gateway_status?: string;
  kyc_status?: string | null;
}

export interface ProviderSchedule {
  timezone: string;
  paused: boolean;
  max_jobs_per_day: number | null;
  slots: WeeklySlot[];
  time_off: { from: string; to: string }[];
  /** "YYYY-MM-DD" in the provider's timezone. */
  full_days: string[];
}

export interface PublicProfile {
  id: string;
  base_area: string | null;
  city: string;
  service_radius_km: number;
  paused: boolean;
  live: boolean;
  member_since: string;
  badges: { id_verified: boolean; payout_verified: boolean; police_verified: boolean };
  credentials: string[];
  specialisations: { category_id: string; labels: string[]; brands: string[] }[];
  hours: WeeklySlot[];
  on_leave_until: string | null;
  portfolio: { file_path: string; caption: string }[];
}

/** Backend contract (real: onboarding/supabaseOnboarding.ts, demo: demo/demoOnboarding.ts). */
export interface OnboardingApi {
  getOnboarding(): Promise<OnboardingState>;
  getCatalog(): Promise<{ skills: CategorySkill[]; docTypes: DocumentType[] }>;
  saveBasics(input: BasicsInput): Promise<void>;
  uploadAvatar(uri: string, mimeType: string): Promise<string>;
  saveServiceArea(input: ServiceAreaInput): Promise<void>;
  saveService(input: ServiceDetailsInput): Promise<void>;
  deleteRateCardItem(id: string): Promise<void>;
  getPriceGuidance(categoryId: string, city: string, unit: RateUnit): Promise<PriceGuidance>;
  setStep(step: number): Promise<void>;
  setAvailability(slots: WeeklySlot[], maxJobsPerDay: number | null): Promise<void>;
  addTimeOff(from: string, to: string, reason: string | null): Promise<void>;
  deleteTimeOff(id: string): Promise<void>;
  addPortfolioPhoto(uri: string, mimeType: string, caption: string): Promise<void>;
  updatePortfolioCaption(id: string, caption: string): Promise<void>;
  deletePortfolioPhoto(id: string): Promise<void>;
  uploadDocument(docType: string, uri: string, mimeType: string, categoryId: string | null, expiresOn: string | null): Promise<void>;
  submitPayout(form: PayoutForm): Promise<PayoutResult & { fields?: PayoutFieldErrors; error?: string }>;
  refreshPayout(): Promise<PayoutResult>;
  payoutRail(): Promise<'route' | 'payouts'>;
  submitProfile(termsVersion: string): Promise<GoLive>;
  setPaused(paused: boolean): Promise<void>;
  deactivate(reason: string | null): Promise<void>;
  reactivate(): Promise<void>;
  getPublicProfile(providerId: string): Promise<PublicProfile | null>;
  getProviderSchedule(providerId: string): Promise<ProviderSchedule | null>;
  publicUrl(bucket: 'avatars' | 'portfolio', path: string): string;
}
