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
  tier?: 'best_match' | 'nearest_best' | 'strong_match';
  matched_needs?: string[];
  evidence_quotes?: string[];
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

/** Job brief for the pro, built server-side from the whole conversation (never the last message). */
export interface JobBrief {
  issue_summary: string;
  /** The customer's own words (original language/script). */
  customer_reported: string;
  customer_reported_en: string | null;
  details: string[];
  /** AI assessment, to be confirmed on inspection. */
  likely_cause: string | null;
  likely_cause_confidence: 'low' | 'medium' | 'high' | null;
}

export interface DraftCard {
  type: 'draft';
  category_slug: string;
  category_name: string;
  provider: { provider_id: string; provider_service_id: string; name: string; visit_fee: number; rating_avg: number; rating_count: number };
  /** null for replies from v1 servers (description_en then holds the text). */
  brief: JobBrief | null;
  /** Rendered brief for the pro (≤ ~600 chars), used as the Book screen description. */
  description: string;
  description_en: string;
  description_original: string;
  problem_chips: string[];
  slot: DraftSlot;
  address: DraftAddress;
}

export type AssistantCard = SafetyCard | DiagnosisCard | EstimateCard | ProvidersCard | DraftCard;

export type HandoffReason = 'safety' | 'low_confidence' | 'frustrated' | 'asked_human';

/** Server progress stage keys (supabase/functions/ai-assistant/stages.ts). Unknown keys are shown with the server label. */
export type StageKey = 'understanding' | 'backup' | 'services' | 'history' | 'pros' | 'pricing' | 'drafting' | 'reviewing';

export interface StageEvent {
  key: string;
  label: string;
  status: 'active' | 'done' | 'failed';
  /** ms since the request started (server clock) */
  t: number;
  ms: number | null;
}

export interface StageSummaryItem {
  key: string;
  ms: number;
  ok: boolean;
}

/** The customer's own turn as the server recorded it (voice: original words + English). */
export interface UserTurn {
  voice: boolean;
  transcript_original: string | null;
  transcript_en: string | null;
  photo: boolean;
}

export interface AssistantReply {
  conversation_id: string | null;
  /** Assistant message row id (for thumbs up/down); null in demo mode. */
  message_id: number | null;
  request_id: string | null;
  reply_text: string;
  language: AssistantLanguage;
  quick_replies: string[];
  cards: AssistantCard[];
  handoff: { reason: HandoffReason } | null;
  user_turn: UserTurn | null;
  /** Voice messages: what the model heard (v1 field; same as user_turn.transcript_original). */
  transcript: string | null;
  stages: StageSummaryItem[];
  fallback_used: boolean;
  /** Server processing time (ms), when known. */
  elapsed_ms: number | null;
  limits: { messages_left: number; voice_left: number; photos_left: number | null } | null;
}

export type Clarity = 'clear' | 'partial' | 'unclear';

/** Voice step 1: what the customer said, for review/edit before sending. */
export interface Transcription {
  request_id: string | null;
  transcript_original: string;
  transcript_en: string | null;
  language: AssistantLanguage;
  clarity: Clarity;
  voice_left: number | null;
}

export interface VoiceMeta {
  transcript_original: string;
  transcript_en: string | null;
  language: AssistantLanguage;
  edited: boolean;
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
  /** Raw voice clip (v1 path; the app now transcribes first and sends `voice` with the reviewed text). */
  audio?: { data: string; mimeType: string };
  /** Set when `message` is a reviewed voice transcript. */
  voice?: VoiceMeta;
  /** JPEG/PNG photo of the problem, base64 (EXIF is stripped server-side). */
  image?: { data: string; mimeType: string };
  location: AssistantLocation;
}
