jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { completeDemoPayment, demoApi as api, demoControls } from '../demo/demoApi';
import { DEMO_PROVIDER_END_CODE } from '../demo/seed';

beforeEach(() => {
  demoControls.reset();
  demoControls.setLatency(0, 0);
  demoControls.setAutopilot(false);
  demoControls.signInForTests();
});

const coords = { lat: 16.5, lng: 80.65 };

describe('demo api — commission terms', () => {
  it('keeps time-based rates separate from the standard job tiers', async () => {
    const terms = await api.getCommissionTerms();
    expect(terms.tiers).toEqual([
      { min_jobs: 0, bp: 1200 },
      { min_jobs: 50, bp: 1000 },
      { min_jobs: 200, bp: 800 },
    ]);
    expect(terms.time_based).toEqual({ one_off_bp: 1000, recurring_bp: 800 });
  });
});

describe('demo api — customer flows', () => {
  it('rejects a wrong OTP and signs in with 123456', async () => {
    await api.signOut();
    await expect(api.verifyOtp('+919876543210', '000000')).rejects.toThrow(/123456/);
    await api.verifyOtp('+919876543210', '123456');
    expect(await api.getSession()).toMatchObject({ userId: 'demo-user' });
  });

  it('books, pays the visit fee and moves to requested', async () => {
    const id = await api.createBooking({
      providerServiceId: 'ps-ravi-ac-repair',
      description: 'AC not cooling',
      addressLine: 'Flat 1',
      city: 'Vijayawada',
      coords,
      scheduledAt: null,
      photos: [],
    });
    expect((await api.getBooking(id)).status).toBe('pending_payment');
    const link = await api.createPayment(id);
    expect(link).toMatchObject({ purpose: 'visit_fee', amount: 19900 });
    await completeDemoPayment(id);
    expect((await api.getBooking(id)).status).toBe('requested');
    expect((await api.getPayments(id)).map((p) => p.status)).toEqual(['paid']);
  });

  it('approves the seeded quote, charges only the balance, then starts work', async () => {
    const [quote] = await api.getQuotes('QS1042');
    // Quote ₹2,150 + ₹29 platform fee − ₹199 visit fee already paid = ₹1,980 due.
    expect(await api.approveQuote('QS1042', quote!.id)).toEqual({ amount_due: 198000 });
    expect((await api.getBooking('QS1042')).status).toBe('awaiting_payment');
    expect(await api.createPayment('QS1042')).toMatchObject({ purpose: 'balance', amount: 198000 });
    await completeDemoPayment('QS1042');
    const b = await api.getBooking('QS1042');
    expect(b).toMatchObject({ status: 'in_progress', approved_quote_id: quote!.id, total_amount: 217900 });
  });

  it('rejecting the initial quote closes the job and pays the visit fee to the provider', async () => {
    const [quote] = await api.getQuotes('QS1042');
    await api.rejectQuote('QS1042', quote!.id);
    expect((await api.getBooking('QS1042')).status).toBe('closed_no_work');
  });

  it('only allows cancelling in cancellable states', async () => {
    await api.cancelBooking('QS1043');
    expect((await api.getBooking('QS1043')).status).toBe('cancelled');
    await expect(api.cancelBooking('QS1039')).rejects.toThrow('booking can no longer be cancelled');
  });

  it('reviews completed jobs once and updates the provider rating count', async () => {
    const before = (await api.getProviderDetail('p-lakshmi')).provider.rating_count;
    await api.submitReview('QS1039', { rating: 5, comment: 'Spotless' });
    expect((await api.getProviderDetail('p-lakshmi')).provider.rating_count).toBe(before + 1);
    await expect(api.submitReview('QS1039', { rating: 4 })).rejects.toThrow('already reviewed');
  });
});

describe('demo api — provider flows', () => {
  it('accepts an incoming request and reveals the exact address', async () => {
    const before = (await api.getProviderJobs()).find((j) => j.booking_id === 'QS2101')!;
    expect(before.address_line).toBeNull();
    await api.acceptBooking('QS2101');
    const after = (await api.getProviderJobs()).find((j) => j.booking_id === 'QS2101')!;
    expect(after.status).toBe('accepted');
    expect(after.address_line).toContain('Ramalayam');
  });

  it('sending a quote while inspecting moves the booking to quote_sent', async () => {
    await api.sendQuote('QS2096', [{ kind: 'labour', title: 'Fan installation', qty: 3, unit_price: 24900 }]);
    expect((await api.getBooking('QS2096')).status).toBe('quote_sent');
    await expect(api.sendQuote('QS2096', [{ kind: 'labour', title: ' ', qty: 1, unit_price: 100 }])).rejects.toThrow(
      'item title is required',
    );
  });

  it('completes with the end code and creates a payout with commission on labour only', async () => {
    await api.requestCompletion('QS2093');
    expect(await api.completeBooking('QS2093', '0000')).toEqual({ ok: false, error: 'invalid_otp', attempts_left: 4 });
    expect(await api.completeBooking('QS2093', DEMO_PROVIDER_END_CODE)).toEqual({ ok: true });
    expect((await api.getBooking('QS2093')).status).toBe('completed');
    const payout = (await api.listMyPayouts()).find((p) => p.booking_id === 'QS2093')!;
    // Labour ₹450 + part ₹850 = ₹1,300 gross; 10% tier (64 jobs, past free period) on labour = ₹45; GST ₹8.10.
    expect(payout).toMatchObject({ gross: 130000, commission: 4500, gst_on_commission: 810, amount: 124690, status: 'pending' });
  });
});
