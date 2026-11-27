import * as appApi from '../../lib/api';
import { isDemoMode } from '../../lib/config';
import { supabase } from '../../lib/supabase';
import type {
  BookingStatus,
  Proposal,
  ProposalItem,
  ProposalScheduleInput,
  ProposalViewState,
  SendProposalInput,
  ServiceRequestStatus,
} from '../../lib/types';

export interface CreatorProposalConfig {
  defaultRevisions: number;
  maxAdvanceBp: number;
}

export interface ProposalFeePreview {
  platform_fee: number;
  service_due: number;
  total_today: number;
}

function isProposalViewState(value: unknown): value is ProposalViewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const bookingStatuses: Array<BookingStatus | null> = [
    null, 'pending_payment', 'confirmed', 'requested', 'accepted', 'en_route',
    'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress', 'delivery_pending',
    'completion_requested', 'completed', 'closed', 'closed_no_work', 'declined',
    'expired', 'cancelled', 'disputed', 'refunded',
  ];
  const requestStatuses: ServiceRequestStatus[] = ['open', 'closed', 'booked', 'expired', 'cancelled'];
  return typeof row.proposal_id === 'string'
    && ['customer', 'owner', 'manager', 'admin'].includes(String(row.viewer_role))
    && requestStatuses.includes(row.request_status as ServiceRequestStatus)
    && typeof row.request_expires_at === 'string'
    && (row.current_booking_id === null || typeof row.current_booking_id === 'string')
    && bookingStatuses.includes(row.current_booking_status as BookingStatus | null)
    && (row.current_booking_created_at === null || typeof row.current_booking_created_at === 'string')
    && (row.payment_hold_expires_at === null || typeof row.payment_hold_expires_at === 'string')
    && (row.delivery_status === null || ['not_applicable', 'pending', 'submitted', 'accepted'].includes(String(row.delivery_status)))
    && typeof row.can_accept === 'boolean'
    && typeof row.can_withdraw === 'boolean'
    && typeof row.can_send_new === 'boolean'
    && typeof row.can_message === 'boolean';
}

async function getDemoProposalViewState(proposalId: string): Promise<ProposalViewState> {
  const [session, proposal] = await Promise.all([appApi.getSession(), appApi.getProposal(proposalId)]);
  if (!session) throw new Error('Sign in to read this proposal');
  const request = await appApi.getServiceRequest(proposal.request_id);
  if (!request) throw new Error('Proposal request state is unavailable in the demo backend');
  const viewerRole = request.customer_id === session.userId
    ? 'customer'
    : proposal.provider_id === session.userId
      ? 'owner'
      : null;
  if (!viewerRole) throw new Error('Proposal not found');

  const bookings = proposal.bookings ?? [];
  const activeStatuses = new Set([
    'pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
    'delivery_pending', 'completion_requested', 'disputed',
  ]);
  const active = bookings.filter((booking) => activeStatuses.has(booking.status));
  if (active.length > 1 || (active.length === 0 && bookings.length > 1)) {
    throw new Error('Demo proposal booking history is ambiguous');
  }
  const current = active.length === 1
    ? active.at(0) ?? null
    : bookings.length === 1
      ? bookings.at(0) ?? null
      : null;
  const latestProposal = viewerRole === 'owner'
    ? (await appApi.listMyProposals())
      .filter((row) => row.request_id === proposal.request_id)
      .reduce<Proposal | null>((latest, row) => !latest || row.version > latest.version ? row : latest, null)
    : null;
  const canAccept = viewerRole === 'customer'
    && request.status === 'open'
    && new Date(request.expires_at).getTime() > Date.now()
    && proposal.status === 'sent'
    && active.length === 0;
  const canWithdraw = viewerRole === 'owner' && proposal.status === 'sent';
  const canSendNew = viewerRole === 'owner'
    && latestProposal?.id === proposal.id
    && request.status === 'open'
    && ['withdrawn', 'expired', 'rejected'].includes(proposal.status);

  return {
    proposal_id: proposal.id,
    viewer_role: viewerRole,
    request_status: request.status,
    request_expires_at: request.expires_at,
    current_booking_id: current?.id ?? null,
    current_booking_status: current ? current.status : null,
    current_booking_created_at: null,
    payment_hold_expires_at: current?.payment_hold_expires_at ?? null,
    delivery_status: null,
    can_accept: canAccept,
    can_withdraw: canWithdraw,
    can_send_new: canSendNew,
    can_message: ['open', 'closed'].includes(request.status),
  };
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
    const serviceDue = proposal.proposal_schedule
      .filter((row) => row.due_rule === 'at_booking'
        || row.due_at != null && new Date(row.due_at).getTime() <= Date.now())
      .reduce((sum, row) => sum + row.amount, 0);
    const platformFee = Math.min(49900, Math.max(9900, Math.round(proposal.total * 0.01)));
    return { platform_fee: platformFee, service_due: serviceDue, total_today: serviceDue + platformFee };
  }
  const { data, error } = await supabase.rpc('get_proposal_fee_preview', { p_proposal_id: proposalId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Proposal fee preview is unavailable');
  return row as ProposalFeePreview;
}

export async function getProposalViewState(proposalId: string): Promise<ProposalViewState> {
  if (isDemoMode) return getDemoProposalViewState(proposalId);
  const { data, error } = await supabase.rpc('get_proposal_view_state', { p_proposal_id: proposalId });
  if (error) throw new Error(error.message);
  if (!isProposalViewState(data)) throw new Error('Proposal view state is unavailable');
  return data;
}

export async function acceptProposalWithFeePreview(
  proposalId: string,
  addressId: string | null,
  preview: ProposalFeePreview,
): Promise<string> {
  if (isDemoMode) return appApi.acceptProposal(proposalId, addressId);
  const { data, error } = await supabase.rpc('accept_proposal', {
    p_proposal_id: proposalId,
    p_address_id: addressId,
    p_expected_platform_fee: preview.platform_fee,
    p_expected_service_due: preview.service_due,
  });
  if (error) throw new Error(error.message);
  return data as string;
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
