export const FEATURE_PARENTS: Readonly<Record<string, string>> = Object.freeze({
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
  branding_runtime: 'oorva_brand',
  branding_editor: 'branding_runtime',
  oorva_launch_animation: 'oorva_brand',
  oorva_home_ux: 'oorva_brand',
  oorva_auth_ux: 'oorva_brand',
  oorva_catalogue_ux: 'oorva_brand',
  oorva_booking_ux: 'oorva_brand',
  oorva_recurring_ux: 'oorva_brand',
  oorva_shops_ux: 'oorva_brand',
  oorva_rfq_ux: 'oorva_brand',
  oorva_sports_ux: 'oorva_brand',
  oorva_creators_ux: 'oorva_brand',
  oorva_account_ux: 'oorva_brand',
  oorva_comms_ux: 'oorva_brand',
  oorva_provider_ux: 'oorva_brand',
  oorva_onboarding_ux: 'oorva_brand',
  oorva_merchant_shop_ux: 'oorva_brand',
  oorva_business_staff_ux: 'oorva_brand',
  oorva_venue_ops_ux: 'oorva_brand',
  oorva_admin_ops_ux: 'oorva_brand',
  oorva_admin_config_ux: 'oorva_brand',
  oorva_admin_money_ux: 'oorva_brand',
  oorva_ai_ux: 'oorva_brand',
  oorva_external_brand: 'oorva_brand',
});

export function isFeatureOn(features: Record<string, unknown>, key: string): boolean {
  if (features[key] !== true) return false;
  const parent = FEATURE_PARENTS[key];
  return parent === undefined || isFeatureOn(features, parent);
}
