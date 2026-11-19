import { cancellationPreviewCopy } from '../cancellationCopy';

describe('cancellationPreviewCopy', () => {
  it('uses the server refund in exact paise', () => {
    expect(cancellationPreviewCopy({ refund_amount: 7500, charged_amount: 2500 }))
      .toBe("You'll be refunded ₹75.");
  });

  it('shows the charged amount when no refund is due', () => {
    expect(cancellationPreviewCopy({ refund_amount: 0, charged_amount: 20000 }))
      .toBe('₹200 will be charged.');
  });

  it('says no charge when the booking has not been paid', () => {
    expect(cancellationPreviewCopy({ refund_amount: 0, charged_amount: 0 }))
      .toBe('No charge — you have not paid yet.');
  });

  it('uses cautious copy when the preview is unavailable', () => {
    expect(cancellationPreviewCopy(null))
      .toBe('Refund depends on the cancellation policy — see Payments after cancelling.');
  });
});
