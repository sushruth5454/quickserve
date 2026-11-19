export interface ProviderCardModelProps {
  visitFeeLabel: string;
  isOnline: boolean;
  mode?: 'visit' | 'proposal';
}

export interface ProviderCardModel {
  priceLabel: string;
  ctaLabel: string;
}

export function providerCardModel({
  visitFeeLabel,
  isOnline,
  mode = 'visit',
}: ProviderCardModelProps): ProviderCardModel {
  const proposal = mode === 'proposal';
  return {
    priceLabel: proposal ? 'Fixed quote for your brief' : `Visit fee ${visitFeeLabel} · adjusted in bill`,
    ctaLabel: proposal ? 'Request proposal' : isOnline ? 'Book' : 'Schedule',
  };
}
