jest.mock('../supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

import { supabase } from '../supabase';
import {
  createProviderDocumentSignedUrl,
  listDocumentQueue,
  listDocumentTypes,
  reviewDocument,
  setProviderReview,
} from '../adminApi';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const storageFrom = supabase.storage.from as jest.Mock;

describe('O2 admin API contracts', () => {
  beforeEach(() => jest.resetAllMocks());

  it('lists pending provider documents through the guarded queue RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(listDocumentQueue()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('admin_list_document_queue', {});
  });

  it('reviews a provider document with the existing RPC argument names', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await reviewDocument('document-1', true, null, '2027-01-31');

    expect(rpc).toHaveBeenCalledWith('admin_review_document', {
      p_document_id: 'document-1',
      p_approve: true,
      p_reason: null,
      p_expires_on: '2027-01-31',
    });
  });

  it('requests provider review without changing payout KYC', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await setProviderReview('provider-1', 'needs_clarification', 'Please update your documents');

    expect(rpc).toHaveBeenCalledWith('admin_set_provider_review', {
      p_provider_id: 'provider-1',
      p_status: 'needs_clarification',
      p_reason: 'Please update your documents',
    });
  });

  it('loads document labels and expiry requirements from the shared document catalog', async () => {
    const order = jest.fn().mockResolvedValue({
      data: [{ code: 'police_verification', label: 'Police verification certificate', has_expiry: true }],
      error: null,
    });
    const select = jest.fn().mockReturnValue({ order });
    from.mockReturnValue({ select });

    await expect(listDocumentTypes()).resolves.toEqual([
      { code: 'police_verification', label: 'Police verification certificate', has_expiry: true },
    ]);
    expect(from).toHaveBeenCalledWith('document_types');
    expect(select).toHaveBeenCalledWith('code, label, has_expiry');
    expect(order).toHaveBeenCalledWith('sort_order');
  });

  it('creates a short-lived signed URL for a private provider document', async () => {
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example/signed-document' },
      error: null,
    });
    storageFrom.mockReturnValue({ createSignedUrl });

    await expect(createProviderDocumentSignedUrl('provider-1/police.pdf'))
      .resolves.toBe('https://storage.example/signed-document');
    expect(storageFrom).toHaveBeenCalledWith('provider-docs');
    expect(createSignedUrl).toHaveBeenCalledWith('provider-1/police.pdf', 300);
  });
});
