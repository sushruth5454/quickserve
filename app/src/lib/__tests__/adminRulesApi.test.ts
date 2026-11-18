import { supabase } from '../supabase';
import {
  formatBasisPointsForInput,
  formatPaiseForInput,
  getAdminRules,
  parsePercentToBasisPoints,
  parseRecurringRulesDraft,
  parseRupeesToPaise,
  parseSportsRulesDraft,
  saveAdminRules,
  type RecurringRulesDraft,
  type SportsRulesDraft,
} from '../adminRulesApi';

jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const rpc = supabase.rpc as jest.Mock;

const recurringDraft: RecurringRulesDraft = {
  frequencies: ['weekly', 'monthly'],
  horizonDays: '28',
  maxPlanDays: '365',
  skipCutoffHours: '12',
  rescheduleCutoffHours: '12',
  reminderHoursBefore: '12',
  paymentDueHoursBefore: '24',
  billingGraceHours: '24',
  paymentFrequencies: ['per_visit', 'weekly'],
  recurringDiscountPercent: '0',
};

const sportsDraft: SportsRulesDraft = {
  paymentHoldMinutes: '10',
  approvalPayWindowMinutes: '60',
  commissionPercent: '10',
  customerFeeRupees: '19.90',
  fullRefundHours: '24',
  partialRefundHours: '6',
  partialRefundPercent: '50',
  releaseAfterHours: '24',
};

describe('admin rules editor (H1-SC-02, H1-SC-03)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('formats paise and basis points as exact human-unit inputs (H1-SC-02)', () => {
    expect(formatPaiseForInput(1990)).toBe('19.90');
    expect(formatPaiseForInput(0)).toBe('0.00');
    expect(formatBasisPointsForInput(1250)).toBe('12.5');
    expect(formatBasisPointsForInput(1000)).toBe('10');
  });

  it('converts rupees and percentages to integer storage units without rounding (H1-SC-03)', () => {
    expect(parseRupeesToPaise('19.90', 'Customer fee')).toBe(1990);
    expect(parsePercentToBasisPoints('12.50', 'Commission')).toBe(1250);
    expect(() => parseRupeesToPaise('19.901', 'Customer fee')).toThrow('at most two decimal places');
    expect(() => parsePercentToBasisPoints('12.501', 'Commission')).toThrow('at most two decimal places');
  });

  it('serializes every recurring rule in the W0 RPC contract (H1-SC-03)', () => {
    expect(parseRecurringRulesDraft(recurringDraft)).toEqual({
      frequencies: ['weekly', 'monthly'],
      horizon_days: 28,
      max_plan_days: 365,
      skip_cutoff_hours: 12,
      reschedule_cutoff_hours: 12,
      reminder_hours_before: 12,
      payment_due_hours_before: 24,
      billing_grace_hours: 24,
      payment_frequencies: ['per_visit', 'weekly'],
      recurring_discount_bp: 0,
    });
  });

  it('serializes sports paise and basis-point rules in the W0 RPC contract (H1-SC-03)', () => {
    expect(parseSportsRulesDraft(sportsDraft)).toEqual({
      payment_hold_minutes: 10,
      approval_pay_window_minutes: 60,
      commission_bp: 1000,
      customer_fee_paise: 1990,
      full_refund_hours: 24,
      partial_refund_hours: 6,
      partial_refund_bp: 5000,
      release_after_hours: 24,
    });
  });

  it('rejects invalid ranges, unsupported options, and inconsistent refund windows (H1-SC-03)', () => {
    expect(() => parseRecurringRulesDraft({ ...recurringDraft, horizonDays: '91' })).toThrow('between 1 and 90');
    expect(() => parseRecurringRulesDraft({ ...recurringDraft, frequencies: [] })).toThrow('Select at least one frequency');
    expect(() => parseRecurringRulesDraft({ ...recurringDraft, recurringDiscountPercent: '50.01' })).toThrow('between 0 and 50');
    expect(() => parseSportsRulesDraft({ ...sportsDraft, customerFeeRupees: '-1' })).toThrow('whole non-negative number');
    expect(() => parseSportsRulesDraft({ ...sportsDraft, partialRefundPercent: '50.01' })).toThrow('between 0 and 50');
    expect(() => parseSportsRulesDraft({ ...sportsDraft, fullRefundHours: '5', partialRefundHours: '6' })).toThrow(
      'Full refund hours must be greater than or equal to partial refund hours.',
    );
  });

  it('loads both rules using the existing admin_get_rules contract (H1-SC-02)', async () => {
    const recurring = { horizon_days: 28 };
    const sports = { payment_hold_minutes: 10 };
    rpc.mockResolvedValueOnce({ data: recurring, error: null }).mockResolvedValueOnce({ data: sports, error: null });

    await expect(getAdminRules()).resolves.toEqual({ recurring, sports });
    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_get_rules', { p_key: 'recurring_rules' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_get_rules', { p_key: 'sports_rules' });
  });

  it('saves a typed rules object using the existing admin_set_rules contract (H1-SC-03)', async () => {
    const saved = {
      payment_hold_minutes: 10,
      approval_pay_window_minutes: 60,
      commission_bp: 1000,
      customer_fee_paise: 1990,
      full_refund_hours: 24,
      partial_refund_hours: 6,
      partial_refund_bp: 5000,
      release_after_hours: 24,
    };
    rpc.mockResolvedValueOnce({ data: saved, error: null });

    await expect(saveAdminRules('sports_rules', saved)).resolves.toEqual(saved);
    expect(rpc).toHaveBeenCalledWith('admin_set_rules', { p_key: 'sports_rules', p_value: saved });
  });

  it('preserves server load/save errors for the screen error state (H1-SC-02, H1-SC-03)', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'admin only' } })
      .mockResolvedValueOnce({ data: {}, error: null });
    await expect(getAdminRules()).rejects.toThrow('admin only');

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'partial_refund_bp must be between 0 and 5000' } });
    await expect(saveAdminRules('sports_rules', {
      payment_hold_minutes: 10,
      approval_pay_window_minutes: 60,
      commission_bp: 1000,
      customer_fee_paise: 1990,
      full_refund_hours: 24,
      partial_refund_hours: 6,
      partial_refund_bp: 5001,
      release_after_hours: 24,
    })).rejects.toThrow(
      'partial_refund_bp must be between 0 and 5000',
    );
  });
});
