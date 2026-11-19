import { formatINR } from './money';
import type { CancellationPreview } from './apiTypes';

const FALLBACK_COPY = 'Refund depends on the cancellation policy — see Payments after cancelling.';

export function cancellationPreviewCopy(preview: CancellationPreview | null): string {
  if (
    !preview
    || !Number.isSafeInteger(preview.refund_amount)
    || preview.refund_amount < 0
    || !Number.isSafeInteger(preview.charged_amount)
    || preview.charged_amount < 0
  ) {
    return FALLBACK_COPY;
  }
  if (preview.refund_amount > 0) return `You'll be refunded ${formatINR(preview.refund_amount)}.`;
  if (preview.charged_amount > 0) return `${formatINR(preview.charged_amount)} will be charged.`;
  return 'No charge — you have not paid yet.';
}
