import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { useFeatureControlState } from '../../branding/FeatureFlagsProvider';
import { Card, ErrorState, Header, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { getAdminFeaturePresentation } from '../../lib/adminFeaturePresentation';
import { getAppFeatures, listFeatures, setFeature, type AdminFeature, type AdminFeatures } from '../../lib/adminApi';
import { isFeatureOn } from '../../lib/featureFlagModel';
import { useTheme } from '../../theme';

const ARCHETYPES = [
  ['inspect_quote', 'Repair & inspection'],
  ['fixed', 'Fixed-price packages'],
  ['time_based', 'Time-based sessions'],
  ['proposal', 'Creators & events'],
  ['remote', 'Remote services'],
] as const;

export function filterAdminFeatureRows(rows: AdminFeature[], query: string): AdminFeature[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((feature) =>
    !needle || `${feature.label} ${feature.description} ${feature.key} ${feature.group_name}`.toLocaleLowerCase().includes(needle));
}

function useAdminFeaturesController() {
  const toast = useToast();
  const { refresh } = useFeatureControlState();
  const [features, setFeatures] = useState<AdminFeatures | null>(null);
  const [featureRows, setFeatureRows] = useState<AdminFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const writeInFlight = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(() => {
    if (writeInFlight.current) return;
    const generation = ++loadGeneration.current;
    setError(null);
    void Promise.all([getAppFeatures(), listFeatures()])
      .then(([nextFeatures, nextRows]) => {
        if (writeInFlight.current || generation !== loadGeneration.current) return;
        setFeatures(nextFeatures);
        setFeatureRows(nextRows);
      })
      .catch((e: Error) => {
        if (writeInFlight.current || generation !== loadGeneration.current) return;
        setError(e.message);
      });
  }, []);
  useFocusEffect(load);

  const change = useCallback(async (key: string, enabled: boolean) => {
    if (writeInFlight.current) return;
    writeInFlight.current = true;
    loadGeneration.current += 1;
    setSaving(true);
    try {
      let canonicalFeatures: AdminFeatures;
      try {
        canonicalFeatures = await setFeature(key, enabled);
      } catch (e) {
        toast({ message: errorMessage(e), tone: 'error' });
        return;
      }

      setFeatures(canonicalFeatures);
      await refresh();
      toast({ message: `${enabled ? 'Enabled' : 'Disabled'}. The app will update shortly.`, tone: 'success' });
    } finally {
      writeInFlight.current = false;
      setSaving(false);
    }
  }, [refresh, toast]);

  return { features, featureRows, error, saving, load, change };
}

export default function AdminFeaturesScreen() {
  const t = useTheme();
  const { features, featureRows, error, saving, load, change } = useAdminFeaturesController();
  const [query, setQuery] = useState('');
  const configUx = isFeatureOn(features ?? {}, 'oorva_admin_config_ux');
  const visibleFeatureRows = filterAdminFeatureRows(featureRows ?? [], configUx ? query : '');
  const groupedFeatures = visibleFeatureRows.reduce<Record<string, AdminFeature[]>>((groups, feature) => {
    (groups[feature.group_name] ??= []).push(feature);
    return groups;
  }, {});

  return (
    <Screen header={<Header title="Features" subtitle="Live switches · changes apply immediately" />}>
      {error ? <ErrorState message={error} onRetry={load} /> : !features || !featureRows ? <Skeleton height={300} radius={t.radii.lg} /> : (
        <>
          {configUx ? (
            <Input
              label="Search feature registry"
              placeholder="Search name, description, key, or group"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          ) : null}
          {visibleFeatureRows.length === 0 ? <Text variant="footnote" color="muted">No matching feature flags.</Text> : null}
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
                <Switch value={!!features.archetypes?.[key]} disabled={saving} onValueChange={(v) => void change(`archetype:${key}`, v)} />
              </View>
            </Card>
          ))}
          <Card
            onPress={() => router.push('/admin/settings')}
            accessibilityLabel="Admin settings"
          >
            <Text variant="calloutStrong">Admin settings</Text>
            <Text variant="footnote" color="muted">Open existing configuration pages and branding settings.</Text>
          </Card>
          <Card
            onPress={() => router.push('/admin/settings/branding?section=history')}
            accessibilityLabel="Branding history and recovery"
          >
            <Text variant="calloutStrong">Branding history & recovery</Text>
            <Text variant="footnote" color="muted">Admin-only history and rollback remain available when branding controls are off.</Text>
          </Card>
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
  saving: boolean;
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
          {presentation.explanation ? (
            <Text variant="caption" color={presentation.disabledByParent ? 'warningText' : 'muted'}>
              {presentation.explanation}
            </Text>
          ) : null}
        </View>
        <Switch
          value={featureStates[feature.key] === true}
          disabled={saving || presentation.switchDisabledByParent}
          onValueChange={(value) => void onChange(feature.key, value)}
        />
      </View>
    </Card>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return String(error);
}
