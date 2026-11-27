import type { CompareRow } from '../../components/market/compareModel';
import type { Proposal, ProposalViewState, ServiceRequest, ServiceRequestStatus } from '../../lib/types';

type ProposalCompareInput = Pick<Proposal, 'id' | 'total' | 'valid_until'> & {
  proposal_schedule: readonly unknown[];
  providers?: Proposal['providers'];
};

export interface ProposalComparison {
  rows: CompareRow[];
  history: Proposal[];
  selectableIds: Set<string>;
  excludedFromLowestIds: Set<string>;
  warnings: Record<string, string[]>;
  currentBooking: { proposal: Proposal; state: ProposalViewState; bookingId: string } | null;
}

export function proposalCompareRows(proposals: readonly ProposalCompareInput[]): CompareRow[] {
  return proposals.map((proposal) => ({
    id: proposal.id,
    who: proposal.providers?.profiles?.full_name ?? 'Verified provider',
    pricePaise: proposal.total,
    detail1: `${proposal.proposal_schedule.length} payments`,
    detail2: new Date(proposal.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }),
    rating: proposal.providers?.rating_avg ?? null,
  }));
}

function isNewerVersion(candidate: Proposal, current: Proposal): boolean {
  return candidate.version > current.version
    || candidate.version === current.version && (
      candidate.created_at > current.created_at
      || candidate.created_at === current.created_at && candidate.id.localeCompare(current.id) > 0
    );
}

function requestStatusWarning(status: ServiceRequestStatus): string {
  switch (status) {
    case 'booked':
      return 'Request already booked';
    case 'closed':
      return 'Request closed';
    case 'expired':
      return 'Request expired';
    case 'cancelled':
      return 'Request cancelled';
    case 'open':
      return 'Not currently available';
  }
}

function proposalWarning(
  proposal: Proposal,
  state: ProposalViewState | undefined,
  request: Pick<ServiceRequest, 'status' | 'expires_at'>,
  now: number,
): string | null {
  if (proposal.status === 'withdrawn') return 'Withdrawn';
  if (proposal.status === 'rejected') return 'Declined';
  if (proposal.status === 'expired' || new Date(proposal.valid_until).getTime() <= now) return 'Expired';
  if (proposal.status === 'accepted') return 'Already accepted';
  if (proposal.status !== 'sent') return 'Unavailable';
  if (!state) return 'Availability unavailable';

  if (request.status !== 'open') return requestStatusWarning(request.status);
  if (state.request_status !== 'open') return requestStatusWarning(state.request_status);
  if (
    new Date(request.expires_at).getTime() <= now
    || new Date(state.request_expires_at).getTime() <= now
  ) return 'Request expired';
  if (state.viewer_role !== 'customer' || !state.can_accept) return 'Not currently available';

  return null;
}

function currentBookingForRequest(
  proposals: readonly Proposal[],
  states: Readonly<Record<string, ProposalViewState>>,
  requestStatus: ServiceRequestStatus,
): ProposalComparison['currentBooking'] {
  if (requestStatus !== 'closed' && requestStatus !== 'booked') return null;

  const entries = proposals.flatMap((proposal) => {
    const state = states[proposal.id];
    return state?.current_booking_id ? [{ proposal, state }] : [];
  });
  const acceptedEntries = entries.filter(({ proposal }) => proposal.status === 'accepted');
  const acceptedIds = new Set(acceptedEntries.map(({ state }) => state.current_booking_id));
  const bookingIds = new Set(entries.map(({ state }) => state.current_booking_id));
  const bookingId = acceptedIds.size === 1
    ? [...acceptedIds][0]
    : acceptedIds.size === 0 && bookingIds.size === 1
      ? [...bookingIds][0]
      : null;

  if (!bookingId) return null;
  const entry = acceptedEntries.find(({ state }) => state.current_booking_id === bookingId)
    ?? entries.find(({ state }) => state.current_booking_id === bookingId)
    ?? null;
  return entry ? { ...entry, bookingId } : null;
}

export function buildProposalComparison(
  proposals: readonly Proposal[],
  states: Readonly<Record<string, ProposalViewState>>,
  request: Pick<ServiceRequest, 'status' | 'expires_at'>,
  now = Date.now(),
): ProposalComparison {
  const latestByProvider = new Map<string, Proposal>();
  for (const proposal of proposals) {
    const current = latestByProvider.get(proposal.provider_id);
    if (!current || isNewerVersion(proposal, current)) {
      latestByProvider.set(proposal.provider_id, proposal);
    }
  }

  const currentProposals = [...latestByProvider.values()];
  const currentIds = new Set(currentProposals.map(({ id }) => id));
  const selectableIds = new Set<string>();
  const excludedFromLowestIds = new Set<string>();
  const warnings: Record<string, string[]> = {};

  for (const proposal of currentProposals) {
    const state = states[proposal.id];
    const warning = proposalWarning(proposal, state, request, now);
    if (warning) {
      excludedFromLowestIds.add(proposal.id);
      warnings[proposal.id] = [warning];
    } else if (state?.viewer_role === 'customer' && state.can_message) {
      selectableIds.add(proposal.id);
    }
  }

  return {
    rows: proposalCompareRows(currentProposals),
    history: proposals.filter(({ id }) => !currentIds.has(id)),
    selectableIds,
    excludedFromLowestIds,
    warnings,
    currentBooking: currentBookingForRequest(proposals, states, request.status),
  };
}
