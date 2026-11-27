import { buildProposalComparison, proposalCompareRows } from '../comparePresentation';
import { getLowestQuoteId } from '../../../components/market/compareModel';
import type { Proposal, ProposalViewState, ServiceRequest } from '../../../lib/types';

describe('proposal comparison presentation', () => {
  const now = new Date('2026-11-27T18:00:00.000Z').getTime();

  function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
      id: 'proposal-1',
      request_id: 'request-1',
      provider_id: 'provider-1',
      provider_service_id: 'service-1',
      version: 1,
      status: 'sent',
      total: 125000,
      valid_until: '2027-01-15T12:00:00.000Z',
      note: null,
      deliverables: [],
      created_at: '2026-11-01T10:00:00.000Z',
      proposal_items: [],
      proposal_schedule: [],
      providers: null,
      ...overrides,
    };
  }

  function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequest {
    return {
      id: 'request-1',
      customer_id: 'customer-1',
      category_id: 'category-1',
      city: 'Pune',
      area: 'Koregaon Park',
      event_start: '2027-02-01T10:00:00.000Z',
      event_end: '2027-02-01T12:00:00.000Z',
      intake: {},
      budget_min: null,
      budget_max: null,
      status: 'open',
      expires_at: '2027-01-01T00:00:00.000Z',
      created_at: '2026-11-01T10:00:00.000Z',
      ...overrides,
    };
  }

  function makeViewState(proposal: Proposal, overrides: Partial<ProposalViewState> = {}): ProposalViewState {
    return {
      proposal_id: proposal.id,
      viewer_role: 'customer',
      request_status: 'open',
      request_expires_at: '2027-01-01T00:00:00.000Z',
      current_booking_id: null,
      current_booking_status: null,
      current_booking_created_at: null,
      payment_hold_expires_at: null,
      delivery_status: null,
      can_accept: true,
      can_withdraw: false,
      can_send_new: false,
      can_message: true,
      ...overrides,
    };
  }

  function snapshot(comparison: ReturnType<typeof buildProposalComparison>) {
    return {
      rows: comparison.rows.map(({ id, pricePaise }) => ({ id, pricePaise })),
      history: comparison.history.map(({ id, version, status }) => ({ id, version, status })),
      selectableIds: [...comparison.selectableIds].sort(),
      excludedFromLowestIds: [...comparison.excludedFromLowestIds].sort(),
      warnings: comparison.warnings,
      lowestId: getLowestQuoteId(comparison.rows, (id) => comparison.excludedFromLowestIds.has(id)),
      currentBooking: comparison.currentBooking
        ? {
          id: comparison.currentBooking.bookingId,
          status: comparison.currentBooking.state.current_booking_status,
        }
        : null,
    };
  }

  it('maps proposal totals, providers, payment counts, validity and ratings', () => {
    const proposals = [{
      id: 'proposal-1',
      total: 125000,
      valid_until: '2027-01-15T12:00:00.000Z',
      proposal_schedule: [{}, {}],
      providers: { rating_avg: 4.8, rating_count: 12, profiles: { full_name: 'Asha Studio' } },
    }];

    expect(proposalCompareRows(proposals)).toEqual([{
      id: 'proposal-1',
      who: 'Asha Studio',
      pricePaise: 125000,
      detail1: '2 payments',
      detail2: new Date('2027-01-15T12:00:00.000Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }),
      rating: 4.8,
    }]);
  });

  it('uses the existing provider fallback when the profile is unavailable', () => {
    const proposals = [{
      id: 'proposal-2',
      total: 90000,
      valid_until: '2027-02-01T12:00:00.000Z',
      proposal_schedule: [],
      providers: null,
    }];

    expect(proposalCompareRows(proposals)[0]).toMatchObject({
      id: 'proposal-2',
      who: 'Verified provider',
      pricePaise: 90000,
      detail1: '0 payments',
      rating: null,
    });
  });

  it('SV-COMPARE-01 excludes expired, withdrawn and rejected offers from actionable Lowest', () => {
    const expired = makeProposal({
      id: 'expired-cheapest',
      provider_id: 'provider-expired',
      total: 1000,
      valid_until: '2026-11-27T17:59:59.000Z',
    });
    const withdrawn = makeProposal({
      id: 'withdrawn-cheap',
      provider_id: 'provider-withdrawn',
      total: 2000,
      status: 'withdrawn',
    });
    const rejected = makeProposal({
      id: 'rejected-cheap',
      provider_id: 'provider-rejected',
      total: 3000,
      status: 'rejected',
    });
    const wrongViewer = makeProposal({
      id: 'wrong-viewer-cheap',
      provider_id: 'provider-wrong-viewer',
      total: 4000,
    });
    const valid = makeProposal({
      id: 'current-valid',
      provider_id: 'provider-valid',
      total: 8000,
    });
    const proposals = [expired, withdrawn, rejected, wrongViewer, valid];
    const comparison = buildProposalComparison(
      proposals,
      Object.fromEntries(proposals.map((proposal) => [
        proposal.id,
        makeViewState(proposal, {
          can_accept: proposal.id === valid.id,
          viewer_role: proposal.id === wrongViewer.id ? 'owner' : 'customer',
          current_booking_id: proposal.id === valid.id ? 'old-expired-booking' : null,
          current_booking_status: proposal.id === valid.id ? 'expired' : null,
        }),
      ])),
      makeRequest(),
      now,
    );

    expect(JSON.stringify(snapshot(comparison))).toBe(JSON.stringify({
      rows: proposals.map(({ id, total }) => ({ id, pricePaise: total })),
      history: [],
      selectableIds: ['current-valid'],
      excludedFromLowestIds: ['expired-cheapest', 'rejected-cheap', 'withdrawn-cheap', 'wrong-viewer-cheap'],
      warnings: {
        'expired-cheapest': ['Expired'],
        'withdrawn-cheap': ['Withdrawn'],
        'rejected-cheap': ['Declined'],
        'wrong-viewer-cheap': ['Not currently available'],
      },
      lowestId: 'current-valid',
      currentBooking: null,
    }));
  });

  it('SV-COMPARE-02 keeps only the newest provider version actionable and preserves older history', () => {
    const older = makeProposal({
      id: 'older-cheapest',
      version: 1,
      total: 1000,
    });
    const current = makeProposal({
      id: 'current-version',
      version: 2,
      total: 9000,
      created_at: '2026-11-02T10:00:00.000Z',
    });
    const otherProvider = makeProposal({
      id: 'other-provider',
      provider_id: 'provider-2',
      total: 10000,
    });
    const proposals = [older, current, otherProvider];
    const comparison = buildProposalComparison(
      proposals,
      Object.fromEntries(proposals.map((proposal) => [
        proposal.id,
        makeViewState(proposal),
      ])),
      makeRequest(),
      now,
    );

    expect(JSON.stringify(snapshot(comparison))).toBe(JSON.stringify({
      rows: [
        { id: 'current-version', pricePaise: 9000 },
        { id: 'other-provider', pricePaise: 10000 },
      ],
      history: [{ id: 'older-cheapest', version: 1, status: 'sent' }],
      selectableIds: ['current-version', 'other-provider'],
      excludedFromLowestIds: [],
      warnings: {},
      lowestId: 'current-version',
      currentBooking: null,
    }));
  });

  it('SV-COMPARE-03 shows the exact hold booking and no actionable Lowest for a booked request', () => {
    const accepted = makeProposal({
      id: 'accepted-proposal',
      status: 'accepted',
      total: 5000,
    });
    const unavailable = makeProposal({
      id: 'unavailable-proposal',
      provider_id: 'provider-2',
      total: 1000,
    });
    const proposals = [accepted, unavailable];
    const comparison = buildProposalComparison(
      proposals,
      {
        [accepted.id]: makeViewState(accepted, {
          request_status: 'booked',
          current_booking_id: 'booking-exact',
          current_booking_status: 'pending_payment',
          can_accept: false,
          can_message: false,
        }),
        [unavailable.id]: makeViewState(unavailable, {
          request_status: 'booked',
          can_accept: false,
          can_message: false,
        }),
      },
      makeRequest({ status: 'booked' }),
      now,
    );

    expect(JSON.stringify(snapshot(comparison))).toBe(JSON.stringify({
      rows: [
        { id: 'accepted-proposal', pricePaise: 5000 },
        { id: 'unavailable-proposal', pricePaise: 1000 },
      ],
      history: [],
      selectableIds: [],
      excludedFromLowestIds: ['accepted-proposal', 'unavailable-proposal'],
      warnings: {
        'accepted-proposal': ['Already accepted'],
        'unavailable-proposal': ['Request already booked'],
      },
      lowestId: null,
      currentBooking: { id: 'booking-exact', status: 'pending_payment' },
    }));
  });
});
