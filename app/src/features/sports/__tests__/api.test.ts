import { createSportsPayment } from '../api';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const invoke = supabase.functions.invoke as jest.Mock;

describe('sports payment API', () => {
  beforeEach(() => jest.resetAllMocks());

  it('sends booking_id to create-payment and returns the payment link', async () => {
    const link = { short_url: 'https://pay.test/sports', amount: 20500, purpose: 'fixed' };
    invoke.mockResolvedValueOnce({ data: link, error: null });

    await expect(createSportsPayment('b1')).resolves.toEqual(link);
    expect(invoke).toHaveBeenCalledWith('create-payment', {
      body: { kind: 'sports', booking_id: 'b1' },
    });
  });

  it('rejects a response without a short_url', async () => {
    invoke.mockResolvedValueOnce({ data: { amount: 20500, purpose: 'fixed' }, error: null });

    await expect(createSportsPayment('b1')).rejects.toThrow('No sports payment link returned.');
  });
});
