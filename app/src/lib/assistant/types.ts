/**
 * Response contract of the ai-assistant edge function (supabase/functions/ai-assistant) and the demo assistant.
 * Amounts are integer paise. Replies are always validated with parseAssistantReply() before rendering.
 */

export type AssistantLanguage = 'en' | 'hi' | 'te' | 'hinglish' | 'tenglish' | 'other';

export type DraftSlot =
  | { type: 'asap'; label: string }
  | { type: 'window'; /** IST date, YYYY-MM-DD */ date: string; start_hour: number; starts_at: string; label: string };

export interface SafetyCard {
  type: 'safety';
  hazard: string;
  title: string;
  steps: string[];
  emergency: { label: string; number: string }[];
}

export interface DiagnosisCard {
  type: 'diagnosis';
  title: string;
  likely_issues: string[];
  pro_checks: string[];
  safety_tip: string | null;
  /** How sure the model is from the description alone (server defaults to 'low'). */
  confidence: 'low' | 'medium' | 'high';
  category_slug: string | null;
}

export interface EstimateCard {
  type: 'estimate';
  category_slug: string;
  category_name: string;
  visit_fee: { min: number; median: number; max: number; count: number } | null;
  typical_total: { low: number; median: number; high: number; count: number } | null;
  note: string;
}

export interface ProviderPick {
  provider_id: string;
  provider_service_id: string;
  name: string;
  skill_level: string;
  visit_fee: number;
  rating_avg: number;
  rating_count: number;
  jobs_completed: number;
  distance_km: number | null;
  is_online: boolean;
  previously_booked: boolean;
  reason: string;
}

export interface ProvidersCard {
  type: 'providers';
  category_slug: string;
  category_name: string;
  providers: ProviderPick[];
}

export interface DraftAddress {
  address_id: string | null;
  label: string | null;
  area: string;
  city: string;
  needs_full_address: boolean;
}

export interface DraftCard {
  type: 'draft';
  category_slug: string;
  category_name: string;
  provider: { provider_id: string; provider_service_id: string; name: string; visit_fee: number; rating_avg: number; rating_count: number };
  description_en: string;
  description_original: string;
  problem_chips: string[];
  slot: DraftSlot;
  address: DraftAddress;
}

export type AssistantCard = SafetyCard | DiagnosisCard | EstimateCard | ProvidersCard | DraftCard;

export interface AssistantReply {
  conversation_id: string | null;
  reply_text: string;
  language: AssistantLanguage;
  quick_replies: string[];
  cards: AssistantCard[];
  /** Voice messages: what the model heard (shown as the user's bubble). */
  transcript: string | null;
  limits: { messages_left: number; voice_left: number } | null;
}

export interface AssistantLocation {
  area: string;
  city: string;
  lat: number;
  lng: number;
  address_id: string | null;
}

export interface AssistantRequest {
  conversationId: string | null;
  message?: string;
  audio?: { data: string; mimeType: string };
  location: AssistantLocation;
}
