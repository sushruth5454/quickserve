import * as appApi from '../../lib/api';
import { isDemoMode } from '../../lib/config';
import { supabase } from '../../lib/supabase';
import type { Proposal, ProposalItem, ProposalScheduleInput, SendProposalInput } from '../../lib/types';

export interface CreatorProposalConfig {
  defaultRevisions: number;
  maxAdvanceBp: number;
}

export interface ProposalFeePreview {
  platform_fee: number;
  advance_due: number;
  total_today: number;
}

export async function getCreatorProposalConfig(): Promise<CreatorProposalConfig> {
  if (isDemoMode) return { defaultRevisions: 1, maxAdvanceBp: 2500 };
  const { data, error } = await supabase.rpc('get_creator_proposal_config');
  if (error || !data || typeof data !== 'object') return { defaultRevisions: 1, maxAdvanceBp: 2500 };
  const config = data as Record<string, unknown>;
  const defaultRevisions = Number(config.default_revisions);
  const maxAdvanceBp = Number(config.max_advance_bp);
  return {
    defaultRevisions: Number.isInteger(defaultRevisions) && defaultRevisions >= 0 && defaultRevisions <= 10
      ? defaultRevisions
      : 1,
    maxAdvanceBp: Number.isInteger(maxAdvanceBp) && maxAdvanceBp >= 0 && maxAdvanceBp <= 10000
      ? maxAdvanceBp
      : 2500,
  };
}

export async function sendProposalWithDeadline(
  input: SendProposalInput & { deliveryDueAt?: Date | null },
): Promise<string> {
  if (isDemoMode) return appApi.sendProposal(input);
  const { data, error } = await supabase.rpc('send_proposal', {
    p_request_id: input.requestId,
    p_items: input.items.map(({ kind, title, qty, unit, unit_price, bill_photo_url, metadata }: ProposalItem) =>
      ({ kind, title, qty, unit, unit_price, bill_photo_url, metadata })),
    p_schedule: input.schedule as ProposalScheduleInput[],
    p_valid_until: input.validUntil.toISOString(),
    p_note: input.note ?? null,
    p_deliverables: input.deliverables ?? [],
    p_delivery_due_at: input.deliveryDueAt?.toISOString() ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getProposalFeePreview(proposalId: string): Promise<ProposalFeePreview> {
  if (isDemoMode) {
    const proposal = await appApi.getProposal(proposalId);
    const advanceDue = proposal.proposal_schedule
      .filter((row) => row.due_rule === 'at_booking')
      .reduce((sum, row) => sum + row.amount, 0);
    const platformFee = Math.min(49900, Math.max(9900, Math.round(proposal.total * 0.01)));
    return { platform_fee: platformFee, advance_due: advanceDue, total_today: advanceDue + platformFee };
  }
  const { data, error } = await supabase.rpc('get_proposal_fee_preview', { p_proposal_id: proposalId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Proposal fee preview is unavailable');
  return row as ProposalFeePreview;
}

export async function getRequestRecipientCount(requestId: string): Promise<number> {
  if (isDemoMode) return 0;
  const { count, error } = await supabase
    .from('request_recipients')
    .select('provider_id', { count: 'exact', head: true })
    .eq('request_id', requestId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export function proposalWithDeliveryDate(proposal: Proposal): Proposal & { delivery_due_at?: string | null } {
  return proposal as Proposal & { delivery_due_at?: string | null };
}
