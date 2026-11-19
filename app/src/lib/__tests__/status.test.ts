jest.mock('../../components/ui', () => ({ Badge: () => null }));

import { nextStepCopy, statusLabel } from '../../components/status';

describe('pending payment status copy', () => {
  it('uses archetype-neutral language', () => {
    expect(statusLabel.pending_payment).toBe('Payment pending');
    expect(nextStepCopy.pending_payment).toBe('Complete payment to send your booking');
  });
});
