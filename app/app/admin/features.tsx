import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { Card, ErrorState, Header, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { getAdminFeaturePresentation } from '../../src/lib/adminFeaturePresentation';
import { getAppFeatures, listFeatures, setFeature, type AdminFeature, type AdminFeatures } from '../../src/lib/adminApi';
import { useTheme } from '../../src/theme';

const ARCHETYPES = [
  ['inspect_quote', 'Repair & inspection'],
  ['fixed', 'Fixed-price packages'],
  ['time_based', 'Time-based sessions'],
  ['proposal', 'Creators & events'],
] as const;

export default function AdminFeaturesScreen() {
  const t = useTheme();
  const toast = useToast();
  const [features, setFeatures] = useState<AdminFeatures | null>(null);
  const [featureRows, setFeatureRows] = useState<AdminFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void Promise.all([getAppFeatures(), listFeatures()])
      .then(([nextFeatures, nextRows]) => {
        setFeatures(nextFeatures);
        setFeatureRows(nextRows);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);

  const change = async (key: string, enabled: boolean) => {
    setSaving(key);
    try {
      setFeatures(await setFeature(key, enabled));
      toast({ message: `${enabled ? 'Enabled' : 'Disabled'}. The app will update shortly.`, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setSaving(null);
    }
  };
  const groupedFeatures = (featureRows ?? []).reduce<Record<string, AdminFeature[]>>((groups, feature) => {
    (groups[feature.group_name] ??= []).push(feature);
    return groups;
  }, {});

  return (
    <Screen header={<Header title="Features" subtitle="Live switches · changes apply immediately" />}>
      {error ? <ErrorState message={error} onRetry={load} /> : !features || !featureRows ? <Skeleton height={300} radius={t.radii.lg} /> : (
        <>
          {Object.entries(groupedFeatures).map(([groupName, rows]) => (
            <View key={groupName} style={{ gap: t.spacing.sm }}>
              <Text variant="title3">{groupName}</Text>
              {rows.map((feature) => (
                <FeatureRow
                  key={feature.key}
                  feature={feature}
                  allFeatures={featureRows}
                  featureStates={features}
                  saving={saving}
                  onChange={change}
                />
              ))}
            </View>
          ))}
          <Text variant="title3">Service types</Text>
          {ARCHETYPES.map(([key, title]) => (
            <Card key={key}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <Text variant="calloutStrong" style={{ flex: 1 }}>{title}</Text>
                <Switch value={!!features.archetypes?.[key]} disabled={saving === `archetype:${key}`} onValueChange={(v) => void change(`archetype:${key}`, v)} />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

function FeatureRow({
  feature,
  allFeatures,
  featureStates,
  saving,
  onChange,
}: {
  feature: AdminFeature;
  allFeatures: AdminFeature[];
  featureStates: AdminFeatures;
  saving: string | null;
  onChange: (key: string, enabled: boolean) => Promise<void>;
}) {
  const t = useTheme();
  const presentation = getAdminFeaturePresentation(feature, allFeatures, featureStates);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View style={{ flex: 1, gap: 4, marginLeft: presentation.indentLevel ? t.spacing.lg : 0, opacity: presentation.disabledByParent ? 0.55 : 1 }}>
          <Text variant="calloutStrong">{feature.label}</Text>
          <Text variant="footnote" color="muted">{feature.description}</Text>
          {presentation.parentLabel ? (
            <Text variant="caption" color={presentation.disabledByParent ? 'warningText' : 'muted'}>
              {presentation.explanation ?? `Requires ${presentation.parentLabel}`}
            </Text>
          ) : null}
        </View>
        <Switch
          value={featureStates[feature.key] === true}
          disabled={saving === feature.key || presentation.switchDisabledByParent}
          onValueChange={(value) => void onChange(feature.key, value)}
        />
      </View>
    </Card>
  );
}
