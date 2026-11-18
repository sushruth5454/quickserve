const FEATURE_PARENTS: Record<string, string> = {
  recurring_skip_pause: 'recurring_bookings',
  recurring_reschedule: 'recurring_bookings',
  recurring_plan_acceptance: 'recurring_bookings',
  recurring_reminders: 'recurring_bookings',
  recurring_billing: 'recurring_bookings',
  recurring_prepaid_packages: 'recurring_bookings',
  sports_online_payments: 'sports',
  sports_instant_booking: 'sports',
  sports_capacity_slots: 'sports',
  sports_multi_slot: 'sports',
};

export function isFeatureOn(features: Record<string, unknown>, key: string): boolean {
  return features[key] === true && (!FEATURE_PARENTS[key] || isFeatureOn(features, FEATURE_PARENTS[key]!));
}
