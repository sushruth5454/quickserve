import type { AdminFeature } from './adminApi';
import { FEATURE_PARENTS } from './featureFlagModel';

export function isAdminRulesEditorEnabled(isOn: (key: string) => boolean): boolean {
  return isOn('admin_rules_editor');
}

export interface AdminFeaturePresentation {
  parentKey: string | null;
  parentLabel: string | null;
  indentLevel: 0 | 1;
  disabledByParent: boolean;
  switchDisabledByParent: boolean;
  explanation: string | null;
}

export function getAdminFeaturePresentation(
  feature: AdminFeature,
  allFeatures: AdminFeature[],
  featureStates: Record<string, unknown>,
): AdminFeaturePresentation {
  const parentKey = FEATURE_PARENTS[feature.key] ?? null;
  if (!parentKey) {
    return {
      parentKey: null,
      parentLabel: null,
      indentLevel: 0,
      disabledByParent: false,
      switchDisabledByParent: false,
      explanation: null,
    };
  }

  const parentLabel = allFeatures.find((row) => row.key === parentKey)?.label ?? parentKey;
  const childEnabled = featureStates[feature.key] === true;
  let blockedByKey: string | null = null;
  let ancestorKey: string | undefined = parentKey;
  while (ancestorKey !== undefined) {
    if (featureStates[ancestorKey] !== true) {
      blockedByKey = ancestorKey;
      break;
    }
    ancestorKey = FEATURE_PARENTS[ancestorKey];
  }
  const disabledByParent = blockedByKey !== null;
  const blockedByLabel = blockedByKey
    ? allFeatures.find((row) => row.key === blockedByKey)?.label ?? blockedByKey
    : null;
  return {
    parentKey,
    parentLabel,
    indentLevel: 1,
    disabledByParent,
    switchDisabledByParent: disabledByParent && !childEnabled,
    explanation: disabledByParent
      ? childEnabled
        ? `You can turn this child off while ${blockedByLabel} is off; enable it first to turn the child back on.`
        : `Enable ${blockedByLabel} first; this child switch cannot be turned on while its parent is off.`
      : null,
  };
}
