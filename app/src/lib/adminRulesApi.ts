import { supabase } from './supabase';

export const RECURRING_FREQUENCIES = [
  { value: 'daily', label: 'Every day' },
  { value: 'alternate_days', label: 'Every other day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom', label: 'Custom schedule' },
] as const;

export const PAYMENT_FREQUENCIES = [
  { value: 'per_visit', label: 'Per visit' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'prepaid_package', label: 'Prepaid package' },
] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]['value'];
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number]['value'];

export interface RecurringRules {
  frequencies: RecurringFrequency[];
  horizon_days: number;
  max_plan_days: number;
  skip_cutoff_hours: number;
  reschedule_cutoff_hours: number;
  reminder_hours_before: number;
  payment_due_hours_before: number;
  billing_grace_hours: number;
  payment_frequencies: PaymentFrequency[];
  recurring_discount_bp: number;
}

export interface SportsRules {
  payment_hold_minutes: number;
  approval_pay_window_minutes: number;
  max_active_holds_per_customer: number;
  request_response_minutes: number;
  min_lead_minutes: number;
  commission_bp: number;
  customer_fee_paise: number;
  full_refund_hours: number;
  partial_refund_hours: number;
  partial_refund_bp: number;
  release_after_hours: number;
}

export interface AdminRules {
  recurring: RecurringRules;
  sports: SportsRules;
}

export interface RecurringRulesDraft {
  frequencies: RecurringFrequency[];
  horizonDays: string;
  maxPlanDays: string;
  skipCutoffHours: string;
  rescheduleCutoffHours: string;
  reminderHoursBefore: string;
  paymentDueHoursBefore: string;
  billingGraceHours: string;
  paymentFrequencies: PaymentFrequency[];
  recurringDiscountPercent: string;
}

export interface SportsRulesDraft {
  paymentHoldMinutes: string;
  approvalPayWindowMinutes: string;
  maxActiveHoldsPerCustomer: string;
  requestResponseMinutes: string;
  minLeadMinutes: string;
  commissionPercent: string;
  customerFeeRupees: string;
  fullRefundHours: string;
  partialRefundHours: string;
  partialRefundPercent: string;
  releaseAfterHours: string;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getAdminRules(): Promise<AdminRules> {
  const [recurring, sports] = await Promise.all([
    rpc<RecurringRules>('admin_get_rules', { p_key: 'recurring_rules' }),
    rpc<SportsRules>('admin_get_rules', { p_key: 'sports_rules' }),
  ]);
  return { recurring, sports };
}

type AdminRulesKey = 'recurring_rules' | 'sports_rules';
type RulesFor<K extends AdminRulesKey> = K extends 'recurring_rules' ? RecurringRules : SportsRules;

export async function saveAdminRules<K extends AdminRulesKey>(key: K, value: RulesFor<K>): Promise<RulesFor<K>> {
  return rpc<RulesFor<K>>('admin_set_rules', { p_key: key, p_value: value });
}

export function formatPaiseForInput(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error('Paise must be a non-negative whole number.');
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

export function formatBasisPointsForInput(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) throw new Error('Basis points must be a non-negative whole number.');
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function parseDecimalUnits(value: string, label: string, unitsPerWhole: bigint, maxUnits: number): number {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(input)) {
    throw new Error(`${label} must be a whole non-negative number with at most two decimal places.`);
  }
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > 2) throw new Error(`${label} must have at most two decimal places.`);

  const fractionalUnits = BigInt((fraction + '00').slice(0, 2));
  const units = BigInt(whole!) * unitsPerWhole + fractionalUnits;
  if (units > BigInt(maxUnits)) throw new Error(`${label} is out of range.`);
  return Number(units);
}

export function parseRupeesToPaise(value: string, label: string, maxPaise = Number.MAX_SAFE_INTEGER): number {
  return parseDecimalUnits(value, label, 100n, maxPaise);
}

export function parsePercentToBasisPoints(
  value: string,
  label: string,
  maxBasisPoints = 10000,
): number {
  const basisPoints = parseDecimalUnits(value, label, 100n, Number.MAX_SAFE_INTEGER);
  if (basisPoints > maxBasisPoints) {
    throw new Error(`${label} must be between 0 and ${formatBasisPointsForInput(maxBasisPoints)}.`);
  }
  return basisPoints;
}

function wholeNumber(value: string, label: string, min: number, max: number): number {
  const input = value.trim();
  if (!/^\d+$/.test(input)) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function choiceList<T extends string>(values: T[], options: readonly { value: T; label: string }[], label: string): T[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`Select at least one ${label}.`);
  if (new Set(values).size !== values.length) throw new Error(`${label} cannot contain duplicates.`);
  const allowed = new Set<string>(options.map((option) => option.value));
  if (values.some((value) => !allowed.has(value))) throw new Error(`${label} contains an unsupported option.`);
  return [...values];
}

export function toRecurringRulesDraft(rules: RecurringRules): RecurringRulesDraft {
  return {
    frequencies: [...rules.frequencies],
    horizonDays: String(rules.horizon_days),
    maxPlanDays: String(rules.max_plan_days),
    skipCutoffHours: String(rules.skip_cutoff_hours),
    rescheduleCutoffHours: String(rules.reschedule_cutoff_hours),
    reminderHoursBefore: String(rules.reminder_hours_before),
    paymentDueHoursBefore: String(rules.payment_due_hours_before),
    billingGraceHours: String(rules.billing_grace_hours),
    paymentFrequencies: [...rules.payment_frequencies],
    recurringDiscountPercent: formatBasisPointsForInput(rules.recurring_discount_bp),
  };
}

export function toSportsRulesDraft(rules: SportsRules): SportsRulesDraft {
  return {
    paymentHoldMinutes: String(rules.payment_hold_minutes),
    approvalPayWindowMinutes: String(rules.approval_pay_window_minutes),
    maxActiveHoldsPerCustomer: String(rules.max_active_holds_per_customer),
    requestResponseMinutes: String(rules.request_response_minutes),
    minLeadMinutes: String(rules.min_lead_minutes),
    commissionPercent: formatBasisPointsForInput(rules.commission_bp),
    customerFeeRupees: formatPaiseForInput(rules.customer_fee_paise),
    fullRefundHours: String(rules.full_refund_hours),
    partialRefundHours: String(rules.partial_refund_hours),
    partialRefundPercent: formatBasisPointsForInput(rules.partial_refund_bp),
    releaseAfterHours: String(rules.release_after_hours),
  };
}

export function parseRecurringRulesDraft(draft: RecurringRulesDraft): RecurringRules {
  return {
    frequencies: choiceList(draft.frequencies, RECURRING_FREQUENCIES, 'frequency'),
    horizon_days: wholeNumber(draft.horizonDays, 'Horizon days', 1, 90),
    max_plan_days: wholeNumber(draft.maxPlanDays, 'Maximum plan days', 1, 3650),
    skip_cutoff_hours: wholeNumber(draft.skipCutoffHours, 'Skip cutoff hours', 0, 720),
    reschedule_cutoff_hours: wholeNumber(draft.rescheduleCutoffHours, 'Reschedule cutoff hours', 0, 720),
    reminder_hours_before: wholeNumber(draft.reminderHoursBefore, 'Reminder hours', 0, 720),
    payment_due_hours_before: wholeNumber(draft.paymentDueHoursBefore, 'Payment due hours', 0, 720),
    billing_grace_hours: wholeNumber(draft.billingGraceHours, 'Billing grace hours', 0, 720),
    payment_frequencies: choiceList(draft.paymentFrequencies, PAYMENT_FREQUENCIES, 'payment frequency'),
    recurring_discount_bp: parsePercentToBasisPoints(draft.recurringDiscountPercent, 'Recurring discount', 5000),
  };
}

export function parseSportsRulesDraft(draft: SportsRulesDraft): SportsRules {
  const rules: SportsRules = {
    payment_hold_minutes: wholeNumber(draft.paymentHoldMinutes, 'Payment hold minutes', 5, 1440),
    approval_pay_window_minutes: wholeNumber(draft.approvalPayWindowMinutes, 'Approval pay window minutes', 5, 1440),
    max_active_holds_per_customer: wholeNumber(draft.maxActiveHoldsPerCustomer, 'Maximum active sports bookings per customer', 1, 100),
    request_response_minutes: wholeNumber(draft.requestResponseMinutes, 'Request response window minutes', 5, 1440),
    min_lead_minutes: wholeNumber(draft.minLeadMinutes, 'Minimum booking lead time minutes', 0, 43200),
    commission_bp: parsePercentToBasisPoints(draft.commissionPercent, 'Commission', 5000),
    customer_fee_paise: parseRupeesToPaise(draft.customerFeeRupees, 'Customer fee', 2147483647),
    full_refund_hours: wholeNumber(draft.fullRefundHours, 'Full refund hours', 0, 720),
    partial_refund_hours: wholeNumber(draft.partialRefundHours, 'Partial refund hours', 0, 720),
    partial_refund_bp: parsePercentToBasisPoints(draft.partialRefundPercent, 'Partial refund', 5000),
    release_after_hours: wholeNumber(draft.releaseAfterHours, 'Release after hours', 0, 720),
  };
  if (rules.full_refund_hours < rules.partial_refund_hours) {
    throw new Error('Full refund hours must be greater than or equal to partial refund hours.');
  }
  return rules;
}
