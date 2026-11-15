export type CancellationActor = 'customer' | 'provider' | 'platform' | 'system';
export type CancellationReason =
  | 'customer_choice'
  | 'provider_fault'
  | 'provider_cancellation'
  | 'provider_no_show'
  | 'customer_payment_default'
  | 'customer_no_show'
  | 'platform';

type CancellationRule = {
  name: string;
  priority: number;
  match: {
    actors?: string[];
    reasons?: string[];
    statuses?: string[];
    min_hours_before_start?: number;
    max_hours_before_start?: number;
    max_hours_since_booking?: number;
  };
  result: {
    principal_bp?: number;
    advance_bp?: number;
    milestone_bp?: number;
    platform_bp?: number;
    credit_paise?: number;
    retained_paise_max?: number;
    retained_principal_bp?: number;
  };
};

export type CancellationPolicySnapshot = {
  key: string;
  label: string;
  version: number;
  rules: CancellationRule[];
};

export type CancellationDisplayInput = {
  actor: CancellationActor;
  reason: CancellationReason;
  status: string;
  createdAt: string | Date;
  scheduledAt: string | Date | null;
  at: string | Date;
  principalPaid: number;
  platformFeePaid: number;
  advancePaid: number;
  priorRefunds?: number;
};

export type CancellationDisplayOutcome = {
  rule: string;
  refundAmount: number;
  serviceRefund: number;
  platformRefund: number;
  providerCompensation: number;
  customerCredit: number;
};

const hoursBetween = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / 3_600_000;

function matches(rule: CancellationRule, input: CancellationDisplayInput): boolean {
  const match = rule.match;
  const at = new Date(input.at);
  const scheduled = input.scheduledAt == null ? null : new Date(input.scheduledAt);
  const hoursBefore = scheduled == null ? null : hoursBetween(scheduled, at);
  const hoursSince = Math.max(0, hoursBetween(at, new Date(input.createdAt)));
  if (match.actors && !match.actors.includes(input.actor)) return false;
  if (match.reasons && !match.reasons.includes(input.reason)) return false;
  if (match.statuses && !match.statuses.includes(input.status)) return false;
  if (match.min_hours_before_start != null && (hoursBefore == null || hoursBefore < match.min_hours_before_start)) return false;
  if (match.max_hours_before_start != null && (hoursBefore == null || hoursBefore >= match.max_hours_before_start)) return false;
  if (match.max_hours_since_booking != null && hoursSince > match.max_hours_since_booking) return false;
  return true;
}

/** Display-only mirror of _cancellation_outcome. Server SQL remains authoritative. */
export function cancellationDisplayOutcome(
  snapshot: CancellationPolicySnapshot,
  input: CancellationDisplayInput,
): CancellationDisplayOutcome {
  const rule = [...snapshot.rules]
    .filter((candidate) => matches(candidate, input))
    .sort((a, b) => b.priority - a.priority)[0];
  if (!rule) throw new Error('This cancellation policy does not define an outcome.');

  const principal = Math.max(0, input.principalPaid);
  const advance = Math.min(Math.max(0, input.advancePaid), principal);
  const milestones = Math.max(0, principal - advance);
  const result = rule.result;
  let serviceRefund =
    result.advance_bp != null || result.milestone_bp != null
      ? Math.floor((advance * (result.advance_bp ?? 0)) / 10_000)
        + Math.floor((milestones * (result.milestone_bp ?? 0)) / 10_000)
      : Math.floor((principal * (result.principal_bp ?? 0)) / 10_000);
  let platformRefund = Math.floor(
    (Math.max(0, input.platformFeePaid) * (result.platform_bp ?? 0)) / 10_000,
  );

  if (result.retained_principal_bp != null) {
    let retained = Math.floor((principal * result.retained_principal_bp) / 10_000);
    if (result.retained_paise_max != null) retained = Math.min(retained, result.retained_paise_max);
    serviceRefund = Math.min(serviceRefund, Math.max(0, principal - retained));
  }

  const refundable = Math.max(0, principal + Math.max(0, input.platformFeePaid) - (input.priorRefunds ?? 0));
  serviceRefund = Math.max(0, Math.min(serviceRefund, refundable));
  platformRefund = Math.max(0, Math.min(platformRefund, Math.max(0, refundable - serviceRefund)));
  const adjustedPrincipal = Math.max(0, principal - Math.min(input.priorRefunds ?? 0, principal));

  return {
    rule: rule.name,
    refundAmount: serviceRefund + platformRefund,
    serviceRefund,
    platformRefund,
    providerCompensation: Math.max(0, adjustedPrincipal - serviceRefund),
    customerCredit: result.credit_paise ?? 0,
  };
}
