import { estimateQuoteTotals } from '../quoteMath';

describe('estimateQuoteTotals', () => {
  it('matches the server exact-paise fixture with per-line rounding', () => {
    const actual = estimateQuoteTotals([
      { quantity: 2.5, unitPricePaise: 101, gstRateBp: 500, available: true },
      { quantity: 2, unitPricePaise: 1000, gstRateBp: 1200, available: true },
    ], 100);

    expect(actual).toEqual({ subtotal: 2253, gst: 253, total: 2606 });
  });

  it('excludes unavailable lines from subtotal and GST', () => {
    const actual = estimateQuoteTotals([
      { quantity: 2.5, unitPricePaise: 101, gstRateBp: 500, available: true },
      { quantity: 500, unitPricePaise: 1000, gstRateBp: 1800, available: false },
    ], 100);

    expect(actual).toEqual({ subtotal: 253, gst: 13, total: 366 });
  });
});
