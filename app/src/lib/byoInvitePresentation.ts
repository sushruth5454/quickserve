export type ByoInvitePresentation<TPreview> =
  | { token: string; requestId: number; status: 'loading' }
  | { token: string; requestId: number; status: 'available'; preview: TPreview }
  | { token: string; requestId: number; status: 'unavailable' }
  | { token: string; requestId: number; status: 'error'; reason: 'preview' | 'claim'; message: string }
  | {
      token: string;
      requestId: number;
      status: 'claimed';
      preview: TPreview;
      bookingId: string;
      paymentStatus: 'starting' | 'cancelled' | 'error';
      paymentError?: string;
    };

export type ByoInviteAction = 'none' | 'sign-in' | 'claim' | 'recover';

export function loadingByoInvite<TPreview>(token: string, requestId: number): ByoInvitePresentation<TPreview> {
  return { token, requestId, status: 'loading' };
}

export function resolveByoInvitePreview<TPreview>(
  current: ByoInvitePresentation<TPreview>,
  token: string,
  requestId: number,
  preview: TPreview | null,
): ByoInvitePresentation<TPreview> {
  if (current.status !== 'loading' || current.token !== token || current.requestId !== requestId) return current;
  return preview === null
    ? { token, requestId, status: 'unavailable' }
    : { token, requestId, status: 'available', preview };
}

export function failByoInvitePreview<TPreview>(
  current: ByoInvitePresentation<TPreview>,
  token: string,
  requestId: number,
  message: string,
): ByoInvitePresentation<TPreview> {
  if (current.status !== 'loading' || current.token !== token || current.requestId !== requestId) return current;
  return { token, requestId, status: 'error', reason: 'preview', message };
}

export function failByoInviteClaim<TPreview>(
  current: ByoInvitePresentation<TPreview>,
  token: string,
  requestId: number,
  message: string,
): ByoInvitePresentation<TPreview> {
  if (current.status !== 'available' || current.token !== token || current.requestId !== requestId) return current;
  return { token, requestId, status: 'error', reason: 'claim', message };
}

export function byoInviteAction<TPreview>(
  presentation: ByoInvitePresentation<TPreview>,
  token: string,
  authenticated: boolean,
): ByoInviteAction {
  if (presentation.token !== token) return 'none';
  if (presentation.status === 'claimed') return 'recover';
  if (presentation.status !== 'available') return 'none';
  return authenticated ? 'claim' : 'sign-in';
}

export function commitByoInviteClaim<TPreview>(
  current: ByoInvitePresentation<TPreview>,
  token: string,
  requestId: number,
  bookingId: string,
): ByoInvitePresentation<TPreview> {
  if (
    current.status !== 'available' ||
    current.token !== token ||
    current.requestId !== requestId ||
    !bookingId
  ) return current;
  return {
    token,
    requestId,
    status: 'claimed',
    preview: current.preview,
    bookingId,
    paymentStatus: 'starting',
  };
}

export function startByoPayment<TPreview>(
  current: ByoInvitePresentation<TPreview>,
  token: string,
  bookingId: string,
): ByoInvitePresentation<TPreview> {
  if (current.status !== 'claimed' || current.token !== token || current.bookingId !== bookingId) return current;
  return { ...current, paymentStatus: 'starting', paymentError: undefined };
}

export function recordByoPaymentIssue<TPreview>(
  current: ByoInvitePresentation<TPreview>,
  token: string,
  bookingId: string,
  issue: { status: 'cancelled' } | { status: 'error'; message: string },
): ByoInvitePresentation<TPreview> {
  if (current.status !== 'claimed' || current.token !== token || current.bookingId !== bookingId) return current;
  return issue.status === 'cancelled'
    ? { ...current, paymentStatus: 'cancelled', paymentError: undefined }
    : { ...current, paymentStatus: 'error', paymentError: issue.message };
}
