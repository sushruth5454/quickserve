import {
  amountDue,
  commissionRateBp,
  formatINR,
  paiseToRupees,
  quoteSubtotals,
  rupeesToPaise,
  settleQuotedJob,
  settleVisitOnly,
} from '../money';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

describe('doc 03 section 4 worked example (AC gas refill, provider past free period)', () => {
  // Hand-computed from doc 03: visit fee 199 credited, labour 1,500, parts 650, platform fee 29.
  // Customer total = 1,500 + 650 + 29 = 2,179 -> 199 at booking + 1,980 balance.
  // Commission = 12% x 1,500 = 180; GST 18% x 180 = 32.40; provider = 1,500 + 650 - 180 - 32.40 = 1,937.60.
  const result = settleQuotedJob({
    items: [
      { kind: 'labour', qty: 1, unitPrice: 150000 },
      { kind: 'part', qty: 1, unitPrice: 65000 },
    ],
    visitFee: 19900,
    platformFee: 2900,
    rateBp: 1200,
  });

  it('splits subtotals with parts as pass-through', () => {
    expect(result.subtotals).toEqual({ labour: 150000, parts: 65000, other: 0, total: 215000 });
  });
  it('customer pays 2,179 in total and 1,980 after the visit fee', () => {
    expect(result.customerTotal).toBe(217900);
    expect(result.balanceAfterVisitFee).toBe(198000);
  });
  it('commission 180 on labour only, GST 32.40', () => {
    expect(result.commission).toBe(18000);
    expect(result.gst).toBe(3240);
  });
  it('provider receives 1,937.60', () => {
    expect(result.providerPayout).toBe(193760);
    expect(formatINR(result.providerPayout)).toBe('₹1,937.60');
  });
  it('platform gross revenue 209', () => {
    expect(result.platformRevenue).toBe(20900);
  });
});

describe('commissionRateBp tiers and free period', () => {
  const old = daysAgo(400);
  it.each([
    [0, 1200],
    [49, 1200],
    [50, 1000],
    [199, 1000],
    [200, 800],
    [1000, 800],
  ])('%i completed jobs -> %i bp', (jobs, bp) => {
    expect(commissionRateBp({ jobsCompleted: jobs, providerCreatedAt: old, at: NOW })).toBe(bp);
  });

  it('is 0% within the first 30 days regardless of jobs', () => {
    expect(commissionRateBp({ jobsCompleted: 0, providerCreatedAt: daysAgo(29), at: NOW })).toBe(0);
    expect(commissionRateBp({ jobsCompleted: 250, providerCreatedAt: daysAgo(1), at: NOW })).toBe(0);
  });

  it('free period ends exactly at 30 days', () => {
    const created = new Date(NOW.getTime() - 30 * DAY);
    expect(commissionRateBp({ jobsCompleted: 0, providerCreatedAt: created, at: NOW })).toBe(1200);
    const justInside = new Date(NOW.getTime() - 30 * DAY + 1);
    expect(commissionRateBp({ jobsCompleted: 0, providerCreatedAt: justInside, at: NOW })).toBe(0);
  });

  it('free-period job: provider keeps everything, no GST', () => {
    const r = settleQuotedJob({
      items: [
        { kind: 'labour', qty: 1, unitPrice: 150000 },
        { kind: 'part', qty: 1, unitPrice: 65000 },
      ],
      visitFee: 19900,
      platformFee: 2900,
      rateBp: 0,
    });
    expect(r.commission).toBe(0);
    expect(r.gst).toBe(0);
    expect(r.providerPayout).toBe(215000);
  });

  it('8% tier on 1,500 labour: commission 120, GST 21.60, provider 2,008.40', () => {
    const r = settleQuotedJob({
      items: [
        { kind: 'labour', qty: 1, unitPrice: 150000 },
        { kind: 'part', qty: 1, unitPrice: 65000 },
      ],
      visitFee: 19900,
      platformFee: 2900,
      rateBp: 800,
    });
    expect(r.commission).toBe(12000);
    expect(r.gst).toBe(2160);
    expect(r.providerPayout).toBe(200840);
  });
});

describe('balance and change orders', () => {
  it('initial balance = quote total + platform fee - visit fee already paid', () => {
    expect(amountDue({ quoteTotal: 215000, visitFee: 19900, platformFee: 2900, alreadyPaid: 19900 })).toBe(198000);
  });
  it('change order charges only the increment (2,650 after 2,179 paid -> 500)', () => {
    expect(amountDue({ quoteTotal: 265000, visitFee: 19900, platformFee: 2900, alreadyPaid: 217900 })).toBe(50000);
  });
  it('a cheaper change order needs no payment', () => {
    expect(amountDue({ quoteTotal: 150000, visitFee: 19900, platformFee: 2900, alreadyPaid: 217900 })).toBe(0);
  });
  it('quote below the visit fee: visit fee is the floor, platform fee still due', () => {
    expect(amountDue({ quoteTotal: 10000, visitFee: 19900, platformFee: 2900, alreadyPaid: 19900 })).toBe(2900);
  });
  it('other items are not commissionable', () => {
    const r = settleQuotedJob({
      items: [
        { kind: 'labour', qty: 2, unitPrice: 50000 },
        { kind: 'other', qty: 1, unitPrice: 20000 },
      ],
      visitFee: 19900,
      platformFee: 2900,
      rateBp: 1200,
    });
    // labour 1,000 -> commission 120, GST 21.60; gross 1,200 -> provider 1,058.40
    expect(r.commission).toBe(12000);
    expect(r.gst).toBe(2160);
    expect(r.providerPayout).toBe(105840);
  });
});

describe('visit-only settlement (quote rejected / cancelled after en route)', () => {
  it('199 visit fee at 12%: commission 23.88, GST 4.30 (4.2984 rounded), provider 170.82', () => {
    expect(settleVisitOnly({ visitFee: 19900, rateBp: 1200 })).toEqual({
      gross: 19900,
      commission: 2388,
      gst: 430,
      payout: 17082,
    });
  });
});

describe('formatting helpers', () => {
  it('formats paise in Indian grouping', () => {
    expect(formatINR(198000)).toBe('₹1,980');
    expect(formatINR(3240)).toBe('₹32.40');
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(19900, { alwaysShowPaise: true })).toBe('₹199.00');
    expect(formatINR(0)).toBe('₹0');
  });
  it('converts rupees and paise', () => {
    expect(rupeesToPaise(1937.6)).toBe(193760);
    expect(paiseToRupees(193760)).toBe(1937.6);
  });
  it('rounds fractional quantities per line', () => {
    expect(quoteSubtotals([{ kind: 'labour', qty: 1.5, unitPrice: 33333 }]).labour).toBe(50000);
  });
});
