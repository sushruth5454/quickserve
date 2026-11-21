import {
  byoInviteAction,
  commitByoInviteClaim,
  failByoInviteClaim,
  failByoInvitePreview,
  loadingByoInvite,
  recordByoPaymentIssue,
  resolveByoInvitePreview,
  startByoPayment,
} from '../byoInvitePresentation';

function expectJson(actual: unknown, expected: unknown) {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

describe('BYO invite presentation', () => {
  const preview = { total_paise: 10300 };

  it('keeps a preview transport failure retryable and distinct from a successful null', () => {
    const loading = loadingByoInvite<typeof preview>('invite-a', 1);
    const failed = failByoInvitePreview(loading, 'invite-a', 1, 'Network unavailable');
    const unavailable = resolveByoInvitePreview(loading, 'invite-a', 1, null);

    expectJson(failed, {
      token: 'invite-a',
      requestId: 1,
      status: 'error',
      reason: 'preview',
      message: 'Network unavailable',
    });
    expectJson(unavailable, { token: 'invite-a', requestId: 1, status: 'unavailable' });
    expectJson(byoInviteAction(failed, 'invite-a', true), 'none');
    expectJson(byoInviteAction(unavailable, 'invite-a', true), 'none');
  });

  it('ignores a prior token response and cannot enable its claim action for the new token', () => {
    const current = loadingByoInvite<typeof preview>('invite-b', 2);
    const stale = resolveByoInvitePreview(current, 'invite-a', 1, preview);
    const retried = loadingByoInvite<typeof preview>('invite-a', 2);
    const staleRetry = resolveByoInvitePreview(retried, 'invite-a', 1, preview);

    expectJson(stale, current);
    expectJson(staleRetry, retried);
    expectJson(byoInviteAction(stale, 'invite-b', true), 'none');
  });

  it('replaces claim with recovery after the committed booking survives payment error or cancellation', () => {
    const available = resolveByoInvitePreview(
      loadingByoInvite<typeof preview>('invite-a', 4),
      'invite-a',
      4,
      preview,
    );
    const claimed = commitByoInviteClaim(available, 'invite-a', 4, 'booking-123');
    const afterError = recordByoPaymentIssue(claimed, 'invite-a', 'booking-123', {
      status: 'error',
      message: 'Payment service unavailable',
    });
    const retrying = startByoPayment(afterError, 'invite-a', 'booking-123');
    const afterCancel = recordByoPaymentIssue(retrying, 'invite-a', 'booking-123', { status: 'cancelled' });

    expectJson(byoInviteAction(available, 'invite-a', true), 'claim');
    expectJson(byoInviteAction(claimed, 'invite-a', true), 'recover');
    expectJson(afterError, {
      token: 'invite-a',
      requestId: 4,
      status: 'claimed',
      preview,
      bookingId: 'booking-123',
      paymentStatus: 'error',
      paymentError: 'Payment service unavailable',
    });
    expectJson(afterCancel, {
      token: 'invite-a',
      requestId: 4,
      status: 'claimed',
      preview,
      bookingId: 'booking-123',
      paymentStatus: 'cancelled',
    });
    expectJson(byoInviteAction(afterError, 'invite-a', true), 'recover');
    expectJson(byoInviteAction(afterCancel, 'invite-a', true), 'recover');
    expectJson(commitByoInviteClaim(afterCancel, 'invite-a', 4, 'booking-456'), afterCancel);
  });

  it('shows contextual sign-in only for an available preview', () => {
    const available = resolveByoInvitePreview(
      loadingByoInvite<typeof preview>('invite-a', 1),
      'invite-a',
      1,
      preview,
    );

    expectJson(byoInviteAction(available, 'invite-a', false), 'sign-in');
    expectJson(byoInviteAction(available, 'other-token', false), 'none');
  });

  it('requires a fresh server preview before retrying an unconfirmed claim', () => {
    const available = resolveByoInvitePreview(
      loadingByoInvite<typeof preview>('invite-a', 1),
      'invite-a',
      1,
      preview,
    );
    const rejected = failByoInviteClaim(available, 'invite-a', 1, 'Invite has already been used');

    expectJson(rejected, {
      token: 'invite-a',
      requestId: 1,
      status: 'error',
      reason: 'claim',
      message: 'Invite has already been used',
    });
    expectJson(byoInviteAction(rejected, 'invite-a', true), 'none');
    expectJson(
      resolveByoInvitePreview(loadingByoInvite<typeof preview>('invite-a', 2), 'invite-a', 2, null),
      { token: 'invite-a', requestId: 2, status: 'unavailable' },
    );
    const refreshed = resolveByoInvitePreview(
      loadingByoInvite<typeof preview>('invite-a', 2),
      'invite-a',
      2,
      preview,
    );
    expectJson(refreshed, {
      token: 'invite-a',
      requestId: 2,
      status: 'available',
      preview,
    });
    expectJson(byoInviteAction(refreshed, 'invite-a', true), 'claim');
  });
});
