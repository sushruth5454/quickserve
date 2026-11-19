import { randomUUID } from 'node:crypto';

const FIXED_AT = '2026-12-15T10:00:00.000Z';

export function buildCategory(overrides = {}) {
  return {
    id: randomUUID(),
    slug: `fixture-${randomUUID()}`,
    name: 'Fixture category',
    icon: 'tool',
    pricing_mode: 'quote',
    sort_order: 0,
    active: true,
    requires_docs: [],
    recommended_docs: [],
    profile_schema: { type: 'object', properties: {} },
    review_tags: [],
    vertical: 'home-repairs',
    archetype: 'inspect_quote',
    location_modes: ['at_customer'],
    pricing_units: ['job'],
    intake_schema: { type: 'object', properties: {} },
    payment_template: 'visit_then_balance',
    cancellation_policy: 'standard_visit',
    min_lead_hours: 1,
    max_lead_days: 7,
    restricted: false,
    config_version: 1,
    exclusive: true,
    deliverable_acceptance_hours: 72,
    recurrence_allowed: false,
    allowed_frequencies: [],
    ...overrides,
  };
}

export function buildBooking(overrides = {}) {
  const categoryId = overrides.category_id ?? randomUUID();
  const categoryVersion = overrides.category_config_version ?? 1;
  const visitFee = overrides.visit_fee ?? 19900;
  const platformFee = overrides.platform_fee ?? 2900;
  return {
    id: randomUUID(),
    customer_id: randomUUID(),
    provider_id: randomUUID(),
    category_id: categoryId,
    provider_service_id: randomUUID(),
    address_id: randomUUID(),
    description: 'Fixture booking',
    photos: [],
    scheduled_at: null,
    status: 'pending_payment',
    visit_fee: visitFee,
    platform_fee: platformFee,
    refund_amount: 0,
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
    coin_discount: 0,
    booking_origin: 'marketplace',
    archetype: 'inspect_quote',
    category_config_version: categoryVersion,
    location_mode: 'at_customer',
    pricing_snapshot: {
      key: `category:${categoryId}:v${categoryVersion}`,
      pricing_mode: 'quote',
      pricing_units: ['job'],
      visit_fee_paise: visitFee,
      platform_fee_paise: platformFee,
    },
    payment_template_snapshot: { key: 'visit_then_balance', version: categoryVersion },
    cancellation_snapshot: { key: 'standard_visit', version: categoryVersion, legacy: true },
    platform_fee_rule_snapshot: { key: 'legacy_flat', amount_paise: platformFee },
    exclusive: true,
    delivery_status: 'not_applicable',
    delivery_snapshot: [],
    delivery_links: [],
    revisions_allowed: 1,
    revisions_used: 0,
    ...overrides,
  };
}

export function buildPaymentSchedule(overrides = {}) {
  return {
    id: randomUUID(),
    booking_id: randomUUID(),
    seq: 1,
    obligation_type: 'service',
    label: 'Fixture service payment',
    amount: 1000,
    due_rule: 'at_booking',
    due_at: FIXED_AT,
    status: 'upcoming',
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
    purpose: 'milestone',
    obligation_kind: 'service',
    ...overrides,
  };
}
