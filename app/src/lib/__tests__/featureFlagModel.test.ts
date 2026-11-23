import { FEATURE_PARENTS, isFeatureOn } from '../featureFlagModel';

describe('feature flag parent model', () => {
  it('exports one immutable map containing the Oorva and existing capability relationships', () => {
    expect(Object.fromEntries(
      Object.entries(FEATURE_PARENTS).filter(([key]) => key.startsWith('branding_') || key.startsWith('oorva_')),
    )).toEqual({
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
    expect(FEATURE_PARENTS).toMatchObject({
      recurring_skip_pause: 'recurring_bookings',
      sports_online_payments: 'sports',
    });
    expect(Object.isFrozen(FEATURE_PARENTS)).toBe(true);
    expect(FEATURE_PARENTS).not.toHaveProperty('oorva_brand');
  });

  it('fails closed across multiple effective ancestors while retaining raw flag values', () => {
    const features = { oorva_brand: false, branding_runtime: true, branding_editor: true };

    expect(features.branding_runtime).toBe(true);
    expect(features.branding_editor).toBe(true);
    expect(isFeatureOn(features, 'branding_editor')).toBe(false);
    expect(isFeatureOn({ oorva_brand: true, branding_runtime: true, branding_editor: true }, 'branding_editor')).toBe(true);
    expect(isFeatureOn({ oorva_brand: true, branding_runtime: false, branding_editor: true }, 'branding_editor')).toBe(false);
    expect(isFeatureOn({ oorva_brand: true, branding_runtime: true, branding_editor: false }, 'branding_editor')).toBe(false);
  });

  it('defaults omitted features OFF and preserves forward-compatible values and archetypes', () => {
    const archetypes = { fixed: true, inspect_quote: false };
    const features = { oorva_brand: true, future_branding_leaf: true, archetypes };

    expect(isFeatureOn(features, 'future_branding_leaf')).toBe(true);
    expect(isFeatureOn(features, 'future_unregistered')).toBe(false);
    expect(features.archetypes).toBe(archetypes);
  });
});
