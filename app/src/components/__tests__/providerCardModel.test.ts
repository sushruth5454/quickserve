import { providerCardModel } from '../providerCardModel';

describe('provider card model', () => {
  it('keeps the normal visit-fee label and availability CTA', () => {
    expect(
      providerCardModel({
        visitFeeLabel: '₹500',
        isOnline: false,
      }),
    ).toEqual({
      priceLabel: 'Visit fee ₹500 · adjusted in bill',
      ctaLabel: 'Schedule',
    });
  });

  it('keeps the proposal label and request CTA', () => {
    expect(
      providerCardModel({
        visitFeeLabel: '₹500',
        isOnline: true,
        mode: 'proposal',
      }),
    ).toEqual({
      priceLabel: 'Fixed quote for your brief',
      ctaLabel: 'Request proposal',
    });
  });
});
