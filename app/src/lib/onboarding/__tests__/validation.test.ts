import { validatePayoutForm } from '../validation';
import type { PayoutForm } from '../types';

const payoutForm = (overrides: Partial<PayoutForm> = {}): PayoutForm => ({
  account_type: 'individual',
  legal_name: 'Ravi Kumar',
  pan: 'ABCPK1234F',
  gstin: '',
  email: 'ravi@example.in',
  account_number: '123456789012',
  confirm_account_number: '123456789012',
  ifsc: 'HDFC0001234',
  ...overrides,
});

describe('payout form business identity validation', () => {
  it('continues to accept an individual PAN only for an individual account', () => {
    expect(validatePayoutForm(payoutForm(), 'payouts')).toEqual({});
    expect(validatePayoutForm(payoutForm({ account_type: 'business' }), 'payouts').pan)
      .toBeDefined();
  });

  it('accepts a supported business PAN and matching optional GSTIN', () => {
    const errors = validatePayoutForm(payoutForm({
      account_type: 'business',
      legal_name: 'Acme Services Pvt Ltd',
      pan: 'AAACC1234C',
      gstin: '29AAACC1234C1Z5',
    }), 'payouts');
    expect(errors).toEqual({});
  });

  it('rejects GSTIN with a different embedded PAN or invalid state code', () => {
    const mismatchedPan = validatePayoutForm(payoutForm({
      account_type: 'business',
      legal_name: 'Acme Services Pvt Ltd',
      pan: 'AAACC1234C',
      gstin: '29ABBCD1234E1Z5',
    }), 'payouts');
    expect(mismatchedPan.gstin).toBeDefined();

    const invalidState = validatePayoutForm(payoutForm({
      account_type: 'business',
      legal_name: 'Acme Services Pvt Ltd',
      pan: 'AAACC1234C',
      gstin: '00AAACC1234C1Z5',
    }), 'payouts');
    expect(invalidState.gstin).toBeDefined();
  });

  it('requires a legal business name and matching account confirmation', () => {
    const errors = validatePayoutForm(payoutForm({
      account_type: 'business',
      legal_name: '',
      pan: 'AAACC1234C',
      confirm_account_number: '',
    }), 'payouts');
    expect(errors.legal_name).toBeDefined();
    expect(errors.confirm_account_number).toBeDefined();
  });
});
