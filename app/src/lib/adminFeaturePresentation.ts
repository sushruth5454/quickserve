import type { AdminFeature } from './adminApi';

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

export function isAdminRulesEditorEnabled(isOn: (key: string) => boolean): boolean {
  return isOn('admin_rules_editor');
}

export interface AdminFeaturePresentation {
  parentKey: string | null;
  parentLabel: string | null;
  indentLevel: 0 | 1;
  disabledByParent: boolean;
  explanation: string | null;
}

export function getAdminFeaturePresentation(
  feature: AdminFeature,
  allFeatures: AdminFeature[],
  featureStates: Record<string, unknown>,
): AdminFeaturePresentation {
  const parentKey = FEATURE_PARENTS[feature.key] ?? null;
  if (!parentKey) {
    return { parentKey: null, parentLabel: null, indentLevel: 0, disabledByParent: false, explanation: null };
  }

  const parentLabel = allFeatures.find((row) => row.key === parentKey)?.label ?? parentKey;
  const disabledByParent = featureStates[parentKey] !== true;
  return {
    parentKey,
    parentLabel,
    indentLevel: 1,
    disabledByParent,
    explanation: disabledByParent
      ? `Enable ${parentLabel} first; this child switch cannot take effect while its parent is off.`
      : null,
  };
}
