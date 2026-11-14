/**
 * Conversation history (last 20), resume, and per-answer feedback. Reads go straight to Postgres with the user's JWT:
 * RLS limits ai_conversations / ai_messages / ai_feedback to the owner. The assistant itself writes messages
 * server-side; the app only writes its own feedback rows (fixed reason codes, no free text).
 */
import { isDemoMode } from '../config';
import { supabase } from '../supabase';
import { parseCard } from './parse';
import type { AssistantCard, AssistantLanguage, HandoffReason } from './types';

export const HISTORY_LIMIT = 20;

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export type FeedbackReason = 'wrong_service' | 'wrong_price' | 'wrong_pro' | 'language' | 'not_helpful' | 'unsafe' | 'other';

export interface StoredTurn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** user turns */
  voice?: { transcript_original: string; transcript_en: string | null } | null;
  photoPath?: string | null;
  /** assistant turns */
  cards?: AssistantCard[];
  quickReplies?: string[];
  language?: AssistantLanguage | null;
  handoff?: HandoffReason | null;
  feedback?: 1 | -1 | null;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  if (isDemoMode) return [];
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('id, title, updated_at')
    .order('updated_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id as string, title: (c.title as string | null) || 'Conversation', updatedAt: c.updated_at as string }));
}

type Row = { id: number; role: string; content: string; payload: Record<string, unknown> | null };

/** Stored rows → chat turns (cards re-validated with the same parser as live replies). */
export function toTurns(rows: Row[], feedback: Map<number, 1 | -1>): StoredTurn[] {
  const out: StoredTurn[] = [];
  for (const r of rows) {
    const p = r.payload ?? {};
    if (r.role === 'user') {
      const v = p.voice && typeof p.voice === 'object' ? (p.voice as Record<string, unknown>) : null;
      const photo = p.photo && typeof p.photo === 'object' ? (p.photo as Record<string, unknown>) : null;
      out.push({
        id: r.id,
        role: 'user',
        text: v && typeof v.transcript_original === 'string' ? v.transcript_original : r.content,
        voice: v && typeof v.transcript_original === 'string' ? { transcript_original: v.transcript_original, transcript_en: typeof v.transcript_en === 'string' ? v.transcript_en : null } : null,
        photoPath: photo && typeof photo.path === 'string' ? photo.path : null,
      });
    } else if (r.role === 'assistant') {
      const cards = (Array.isArray(p.cards) ? p.cards : []).map(parseCard).filter((c): c is AssistantCard => !!c);
      const handoff = p.handoff && typeof p.handoff === 'object' ? ((p.handoff as Record<string, unknown>).reason as HandoffReason) : null;
      out.push({
        id: r.id,
        role: 'assistant',
        text: r.content,
        cards,
        quickReplies: Array.isArray(p.quick_replies) ? (p.quick_replies as unknown[]).filter((q): q is string => typeof q === 'string').slice(0, 4) : [],
        language: typeof p.language === 'string' ? (p.language as AssistantLanguage) : null,
        handoff: handoff ?? null,
        feedback: feedback.get(r.id) ?? null,
      });
    }
  }
  return out;
}

export async function loadConversation(id: string): Promise<StoredTurn[]> {
  if (isDemoMode) return [];
  const { data, error } = await supabase
    .from('ai_messages')
    .select('id, role, content, payload')
    .eq('conversation_id', id)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const ids = rows.filter((r) => r.role === 'assistant').map((r) => r.id);
  const fb = new Map<number, 1 | -1>();
  if (ids.length) {
    const { data: f } = await supabase.from('ai_feedback').select('message_id, rating').in('message_id', ids);
    for (const x of f ?? []) fb.set(x.message_id as number, (x.rating as number) > 0 ? 1 : -1);
  }
  return toTurns(rows, fb);
}

/** Short-lived link to the customer's own diagnosis photo (private bucket, owner-only RLS). */
export async function photoUrl(path: string): Promise<string | null> {
  if (isDemoMode) return null;
  const { data } = await supabase.storage.from('ai-photos').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function setFeedback(messageId: number, rating: 1 | -1, reason: FeedbackReason | null = null): Promise<void> {
  if (isDemoMode) return;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Please sign in again.');
  const { error } = await supabase
    .from('ai_feedback')
    .upsert({ message_id: messageId, user_id: uid, rating, reason, updated_at: new Date().toISOString() }, { onConflict: 'message_id,user_id' });
  if (error) throw error;
}
