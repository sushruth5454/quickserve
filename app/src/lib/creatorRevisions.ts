import { supabase } from './supabase';

export async function creatorRevisionsEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_app_features');
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null)?.creator_revisions === true;
}

export async function requestCreatorRevision(bookingId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('request_revision', {
    p_booking_id: bookingId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}
