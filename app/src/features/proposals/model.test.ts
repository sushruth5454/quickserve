import {
  packageProposalPrefill,
  parseDeliveryDate,
  proposalAmountError,
  proposalFeeChanged,
  proposalFeeLabel,
} from './model';

describe('creator package proposal prefill', () => {
  it('carries price, deliverables, revision count, and turnaround date', () => {
    const result = packageProposalPrefill({
      title: 'Reel editing',
      price_min: 125000,
      turnaround_days: 14,
      revisions_included: 2,
      deliverables: [{ type: 'edited_reel', qty: 10, spec: '1080p exports' }],
      raw_files_included: true,
      usage_rights: { organic_posting: true, paid_ads_days: 30, exclusivity_days: 7 },
    }, '2027-03-25T04:30:00.000Z');

    expect(result).toEqual({
      title: 'Reel editing',
      totalPaise: 125000,
      deliveryDate: '2027-04-08',
      revisions: 2,
      deliverables: [
        { type: 'edited_reel', qty: 10, spec: '1080p exports' },
        { type: 'raw_files', qty: 1, spec: 'Raw files included' },
        { type: 'usage_rights', qty: 1, spec: 'Organic posting; Paid ads for 30 days; Exclusivity for 7 days' },
        { type: 'revisions', qty: 2, spec: 'Revision rounds' },
      ],
    });
  });

  describe('proposal money copy and validation', () => {
    it('rejects a NaN total and an advance above the configured cap', () => {
      expect(proposalAmountError(Number.NaN, 25, 2500)).toBe('Enter a valid fixed total and advance');
      expect(proposalAmountError(1000, 30, 2500)).toBe('Advance can be at most 25%');
    });

    it('shows the server fee and total due today without adding tax', () => {
      expect(proposalFeeLabel({ platform_fee: 9900, total_today: 34900 }))
        .toBe('Platform fee ₹99 · Total today ₹349');
    });

    it('detects a fee or due-now change since the proposal was displayed', () => {
      const shown = { platform_fee: 9900, service_due: 25000, total_today: 34900 };
      expect(proposalFeeChanged(shown, { ...shown })).toBe(false);
      expect(proposalFeeChanged(shown, { ...shown, platform_fee: 12000, total_today: 37000 })).toBe(true);
      expect(proposalFeeChanged(shown, { ...shown, service_due: 30000, total_today: 39900 })).toBe(true);
    });

    it('rejects malformed or impossible delivery dates', () => {
      expect(parseDeliveryDate('2027-03-25')?.toISOString()).toBe('2027-03-25T18:29:59.000Z');
      expect(parseDeliveryDate('2027-02-31')).toBeNull();
      expect(parseDeliveryDate('03/25/2027')).toBeNull();
    });
  });
});
