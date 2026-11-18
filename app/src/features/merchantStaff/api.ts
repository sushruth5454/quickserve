import { supabase } from '../../lib/supabase';
import type { Provider, ProviderJob, Proposal } from '../../lib/types';

export type MerchantRole = 'owner' | 'manager' | 'staff';

export interface BusinessMember {
  member_id: string;
  full_name: string;
  role: MerchantRole;
  active: boolean;
  invited_at: string;
}

export interface BusinessMembership {
  owner_id: string;
  role: MerchantRole;
  business_type: 'provider' | 'shop' | 'sports';
  business_name: string;
}

export type BusinessProviderContext =
  | (Provider & { business_role: 'owner' })
  | (Omit<Provider, 'kyc_status' | 'commission_tier' | 'razorpay_account_id'> & { business_role: 'manager' | 'staff' });

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data == null) throw new Error('The server returned no business staff data.');
  return data;
}

export async function listBusinessMembers(ownerId: string): Promise<BusinessMember[]> {
  const { data, error } = await supabase.rpc('list_business_members', { p_owner_id: ownerId });
  return unwrap(data as BusinessMember[] | null, error);
}

export async function addBusinessMember(ownerId: string, memberId: string, role: Exclude<MerchantRole, 'owner'>): Promise<void> {
  const { data, error } = await supabase.rpc('add_business_member', {
    p_owner_id: ownerId,
    p_member_id: memberId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
  void data;
}

export async function removeBusinessMember(ownerId: string, memberId: string): Promise<void> {
  const { data, error } = await supabase.rpc('remove_business_member', {
    p_owner_id: ownerId,
    p_member_id: memberId,
  });
  if (error) throw new Error(error.message);
  void data;
}

export async function listMyBusinessMemberships(): Promise<BusinessMembership[]> {
  const { data, error } = await supabase.rpc('list_my_business_memberships');
  return unwrap(data as BusinessMembership[] | null, error);
}

export async function getMyProviderBusinessContext(providerId?: string): Promise<BusinessProviderContext | null> {
  const { data, error } = await supabase.rpc('get_provider_business_context', { p_provider_id: providerId ?? null });
  if (error) throw new Error(error.message);
  return data as BusinessProviderContext | null;
}

export async function listMyBusinessProviderJobs(providerId: string): Promise<ProviderJob[]> {
  const { data, error } = await supabase.rpc('get_my_business_provider_jobs', { p_provider_id: providerId });
  return unwrap(data as ProviderJob[] | null, error);
}

export async function listMyBusinessProposals(providerId: string): Promise<Proposal[]> {
  const { data, error } = await supabase.from('proposals')
    .select('*, proposal_items(*), proposal_schedule(*), bookings(id, status, payment_hold_expires_at)')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false });
  return unwrap(data as Proposal[] | null, error);
}
