import { nearestFutureRfqDeadlineMs, rfqViewState } from '../rfqStateModel';

const nowMs = Date.parse('2026-11-24T10:00:00.000Z');
const deadline = '2026-11-24T10:01:00.000Z';

describe('RFQ parent and quote view state', () => {
  it('allows supplier reply strictly before the RFQ deadline', () => {
    const state = rfqViewState({
      status: 'open',
      expiresAt: deadline,
      quoteStatus: null,
      myOutcome: null,
      canSendQuote: true,
      nowMs,
    });

    expect(state).toEqual({
      rawStatus: 'open',
      rfqLabel: 'Open',
      quoteLabel: 'No quote sent',
      canReply: true,
      blockReason: null,
    });
  });

  it.each([
    ['at', Date.parse(deadline)],
    ['after', Date.parse(deadline) + 1],
  ])('fails closed %s the RFQ deadline without claiming persisted expiry', (_boundary, clockMs) => {
    const state = rfqViewState({
      status: 'open',
      expiresAt: deadline,
      quoteStatus: null,
      myOutcome: null,
      canSendQuote: true,
      nowMs: clockMs,
    });

    expect(state).toMatchObject({
      rawStatus: 'open',
      rfqLabel: 'Open · deadline passed',
      canReply: false,
      blockReason: 'rfq_expired',
    });
  });

  it('shows parent and quote outcomes independently, preserving terminal outcomes', () => {
    const cancelled = rfqViewState({
      status: 'cancelled',
      expiresAt: deadline,
      quoteStatus: 'rejected',
      myOutcome: 'rejected',
      canSendQuote: false,
      nowMs,
    });
    const expired = rfqViewState({
      status: 'expired',
      expiresAt: deadline,
      quoteStatus: 'expired',
      myOutcome: 'expired',
      canSendQuote: false,
      nowMs,
    });
    const selected = rfqViewState({
      status: 'closed',
      expiresAt: deadline,
      quoteStatus: 'selected',
      myOutcome: 'selected',
      canSendQuote: false,
      nowMs,
    });

    expect(cancelled).toMatchObject({ rfqLabel: 'Cancelled', quoteLabel: 'Not selected (rejected)', canReply: false });
    expect(expired).toMatchObject({ rfqLabel: 'Expired', quoteLabel: 'Quote expired', canReply: false });
    expect(selected).toMatchObject({ rfqLabel: 'Closed', quoteLabel: 'Selected', canReply: false });
  });

  it('fails closed for missing deadlines and server-blocked sends', () => {
    const missingDeadline = rfqViewState({
      status: 'open',
      expiresAt: 'not-a-date',
      quoteStatus: 'sent',
      myOutcome: 'sent',
      canSendQuote: true,
      nowMs,
    });
    const serverBlocked = rfqViewState({
      status: 'open',
      expiresAt: deadline,
      quoteStatus: 'sent',
      myOutcome: 'sent',
      canSendQuote: false,
      nowMs,
    });

    expect(missingDeadline).toMatchObject({
      rfqLabel: 'Open · deadline unavailable',
      canReply: false,
      blockReason: 'deadline_unavailable',
    });
    expect(serverBlocked).toMatchObject({ canReply: false, blockReason: 'server_blocked' });
  });

  it('returns only the nearest deadline strictly after the supplied clock', () => {
    expect(nearestFutureRfqDeadlineMs([
      '2026-11-24T09:59:00.000Z',
      '2026-11-24T10:00:00.000Z',
      '2026-11-24T10:05:00.000Z',
      '2026-11-24T10:02:00.000Z',
      'invalid',
    ], nowMs)).toBe(Date.parse('2026-11-24T10:02:00.000Z'));
    expect(nearestFutureRfqDeadlineMs(['2026-11-24T10:00:00.000Z'], nowMs)).toBeNull();
  });
});
