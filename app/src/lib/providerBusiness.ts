import { isDemoMode } from './config';
import { supabase } from './supabase';
import type { NewAddressInput } from './types';

export interface CreateByoInviteInput {
  providerServiceId: string;
  customerLabel: string;
  description: string;
  amountPaise: number;
  scheduledAt: Date | null;
}

export interface ByoInviteResult {
  invite_id: string;
  token: string;
  share_url: string;
  expires_at: string;
}

export interface ByoInvitePreview {
  invite_id: string;
  provider_id: string;
  provider_name: string;
  provider_service_id: string;
  category_name: string;
  customer_label: string;
  description: string;
  amount_paise: number;
  fee_paise: number;
  total_paise: number;
  scheduled_at: string | null;
  expires_at: string;
}

export interface ByoInviteSummary {
  invite_id: string;
  provider_service_id: string;
  category_name: string;
  customer_label: string;
  description: string;
  amount_paise: number;
  fee_paise: number;
  total_paise: number;
  scheduled_at: string | null;
  status: 'open' | 'claimed' | 'cancelled' | 'expired';
  booking_id: string | null;
  created_at: string;
  expires_at: string;
}

interface DemoInvite {
  summary: ByoInviteSummary;
  token: string;
  providerName: string;
}

const demoInvites = new Map<string, DemoInvite>();
let demoSeq = 1;

function unwrap<T>(result: { data?: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function createByoInvite(input: CreateByoInviteInput): Promise<ByoInviteResult> {
  if (isDemoMode) {
    const id = `demo-invite-${demoSeq++}`;
    const token = `demobyo${Date.now().toString(36)}${demoSeq}`;
    const fee = Math.round(input.amountPaise * 0.03);
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const summary: ByoInviteSummary = {
      invite_id: id,
      provider_service_id: input.providerServiceId,
      category_name: 'Your service',
      customer_label: input.customerLabel,
      description: input.description,
      amount_paise: input.amountPaise,
      fee_paise: fee,
      total_paise: input.amountPaise + fee,
      scheduled_at: input.scheduledAt?.toISOString() ?? null,
      status: 'open',
      booking_id: null,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };
    demoInvites.set(token, { summary, token, providerName: 'Demo provider' });
    return { invite_id: id, token, share_url: `quickserve://byo/${token}`, expires_at: expiresAt };
  }

  const rows = unwrap(
    await supabase.rpc('create_byo_invite', {
      p_provider_service_id: input.providerServiceId,
      p_customer_label: input.customerLabel,
      p_description: input.description,
      p_amount_paise: input.amountPaise,
      p_scheduled_at: input.scheduledAt?.toISOString() ?? null,
    }),
  ) as ByoInviteResult[];
  if (!rows[0]) throw new Error('Could not create invite');
  return rows[0];
}

export async function listMyByoInvites(): Promise<ByoInviteSummary[]> {
  if (isDemoMode) return [...demoInvites.values()].map((i) => ({ ...i.summary }));
  return unwrap(await supabase.rpc('list_my_byo_invites')) as ByoInviteSummary[];
}

export async function cancelByoInvite(inviteId: string): Promise<void> {
  if (isDemoMode) {
    const invite = [...demoInvites.values()].find((i) => i.summary.invite_id === inviteId);
    if (!invite || invite.summary.status !== 'open') throw new Error('Invite is not open');
    invite.summary.status = 'cancelled';
    return;
  }
  unwrap<void>(await supabase.rpc('cancel_byo_invite', { p_invite_id: inviteId }));
}

export async function previewByoInvite(token: string): Promise<ByoInvitePreview | null> {
  if (isDemoMode) {
    const invite = demoInvites.get(token);
    if (!invite || invite.summary.status !== 'open' || new Date(invite.summary.expires_at).getTime() <= Date.now()) return null;
    return {
      invite_id: invite.summary.invite_id,
      provider_id: 'demo-provider',
      provider_name: invite.providerName,
      provider_service_id: invite.summary.provider_service_id,
      category_name: invite.summary.category_name,
      customer_label: invite.summary.customer_label,
      description: invite.summary.description,
      amount_paise: invite.summary.amount_paise,
      fee_paise: invite.summary.fee_paise,
      total_paise: invite.summary.total_paise,
      scheduled_at: invite.summary.scheduled_at,
      expires_at: invite.summary.expires_at,
    };
  }
  const rows = unwrap(await supabase.rpc('preview_byo_invite', { p_token: token })) as ByoInvitePreview[];
  return rows[0] ?? null;
}

export async function claimByoInvite(token: string, address: NewAddressInput): Promise<string> {
  if (isDemoMode) throw new Error('Protected BYO checkout is available in the live project.');
  return unwrap<string>(
    await supabase.rpc('claim_byo_invite', {
      p_token: token,
      p_address_line: address.line1,
      p_city: address.city,
      p_lat: address.lat,
      p_lng: address.lng,
    }),
  );
}
