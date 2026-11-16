import { invokeFunction, SESSION_EXPIRED_MESSAGE } from '../invokeFunction';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, auth: { refreshSession: jest.fn() } },
}));

const invoke = supabase.functions.invoke as jest.Mock;
const refresh = supabase.auth.refreshSession as jest.Mock;
const unauthorized = { data: null, error: { message: 'non-2xx', context: { status: 401 } } };

describe('invokeFunction', () => {
  beforeEach(() => jest.resetAllMocks());

  it('refreshes the login once and retries after a 401', async () => {
    invoke.mockResolvedValueOnce(unauthorized).mockResolvedValueOnce({ data: { id: 's1' }, error: null });
    refresh.mockResolvedValue({ data: { session: { access_token: 'new' } }, error: null });
    await expect(invokeFunction('provider-service', { body: {} })).resolves.toMatchObject({ data: { id: 's1' }, error: null });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('reports an expired login when the session cannot be refreshed', async () => {
    invoke.mockResolvedValue(unauthorized);
    refresh.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token' } });
    const result = await invokeFunction('create-payment', { body: {} });
    expect(result.error?.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('passes other errors through without refreshing', async () => {
    const conflict = { data: null, error: { message: 'non-2xx', context: { status: 409 } } };
    invoke.mockResolvedValue(conflict);
    await expect(invokeFunction('create-payment', { body: {} })).resolves.toBe(conflict);
    expect(refresh).not.toHaveBeenCalled();
  });
});
