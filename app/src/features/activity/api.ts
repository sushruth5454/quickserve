import { supabase } from '../../lib/supabase';
import { parseActivityUnreadCounts, type ActivityUnreadCounts } from './model';
export type { ActivityUnreadCounts } from './model';

export type ActivityResourceType = 'booking' | 'request' | 'rfq' | 'sports_booking';

export async function getMyActivityUnreadCounts(): Promise<ActivityUnreadCounts> {
  const { data, error } = await supabase.rpc('get_my_activity_unread_counts');
  if (error) throw new Error(error.message);
  return parseActivityUnreadCounts(data);
}

export async function markMyActivityNotificationRead(
  resourceType: ActivityResourceType,
  resourceId: string,
): Promise<void> {
  const { error } = await supabase.rpc('mark_my_activity_notification_read', {
    p_resource_type: resourceType,
    p_resource_id: resourceId,
  });
  if (error) throw new Error(error.message);
}
