/**
 * Product analytics for the assistant funnel. Events go to `analytics_events` (insert-only for the signed-in user via
 * RLS; event names are a server-side allow-list). Props are sanitised here: numbers, booleans and short identifier-like
 * strings only, so free text, names or phone numbers can never be logged. Fire-and-forget; never blocks the UI.
 */
import { isDemoMode } from './config';
import { sanitizeProps, type Prop } from './analyticsProps';
import { supabase } from './supabase';

export type AnalyticsEvent =
  | 'assistant_opened'
  | 'voice_used'
  | 'photo_attached'
  | 'stage_latency'
  | 'draft_created'
  | 'draft_to_booking_conversion'
  | 'fallback_model_used'
  | 'assistant_feedback'
  | 'assistant_stopped'
  | 'support_handoff';

export function track(event: AnalyticsEvent, props: Record<string, Prop> = {}): void {
  if (isDemoMode) return;
  const clean = sanitizeProps(props);
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      await supabase.from('analytics_events').insert({ user_id: uid, event, props: clean });
    } catch {
      // analytics must never affect the product
    }
  })();
}
