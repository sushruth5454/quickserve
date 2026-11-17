import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import {
  getCommissionConfig,
  listCommissionCategories,
  setCategoryCommission,
  setCommissionConfig,
  type AdminCommissionCategory,
  type AdminCommissionConfig,
} from '../../src/lib/adminApi';
import { useTheme } from '../../src/theme';

interface CommissionDraft {
  foundingDays: string;
  tiers: { id: string; minJobs: string; bp: string }[];
  timeBasedOneOffBp: string;
  timeBasedRecurringBp: string;
  repeatDiscountBp: string;
  repeatFloorBp: string;
}

let nextTierId = 0;

function toDraft(config: AdminCommissionConfig): CommissionDraft {
  return {
    foundingDays: String(config.founding_days),
    tiers: [...config.tiers]
      .sort((a, b) => b.min_jobs - a.min_jobs)
      .map((tier, index) => ({ id: `saved-${index}`, minJobs: String(tier.min_jobs), bp: String(tier.bp) })),
    timeBasedOneOffBp: String(config.time_based.one_off_bp),
    timeBasedRecurringBp: String(config.time_based.recurring_bp),
    repeatDiscountBp: String(config.repeat_discount_bp),
    repeatFloorBp: String(config.repeat_floor_bp),
  };
}

function wholeNumber(value: string, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function parseDraft(draft: CommissionDraft): AdminCommissionConfig {
  const founding_days = wholeNumber(draft.foundingDays, 'Founding days', 0, 365);
  const tiers = draft.tiers.map((tier) => ({
    min_jobs: wholeNumber(tier.minJobs, 'Tier job threshold'),
    bp: wholeNumber(tier.bp, 'Tier rate', 0, 3000),
  }));
  if (tiers.length === 0) throw new Error('Add at least one commission tier.');
  if (new Set(tiers.map((tier) => tier.min_jobs)).size !== tiers.length) throw new Error('Tier job thresholds must be unique.');
  tiers.sort((a, b) => b.min_jobs - a.min_jobs);
  if (tiers.at(-1)?.min_jobs !== 0) throw new Error('Include a base tier starting at 0 jobs.');
  return {
    founding_days,
    tiers,
    time_based: {
      one_off_bp: wholeNumber(draft.timeBasedOneOffBp, 'One-off session rate', 0, 3000),
      recurring_bp: wholeNumber(draft.timeBasedRecurringBp, 'Recurring session rate', 0, 3000),
    },
    repeat_discount_bp: wholeNumber(draft.repeatDiscountBp, 'Repeat discount', 0, 3000),
    repeat_floor_bp: wholeNumber(draft.repeatFloorBp, 'Repeat floor', 0, 3000),
  };
}

function categoryValue(value: string): number | null {
  if (!value.trim()) return null;
  return wholeNumber(value, 'Category commission', 0, 3000);
}

export default function AdminCommissionScreen() {
  const t = useTheme();
  const toast = useToast();
  const [draft, setDraft] = useState<CommissionDraft | null>(null);
  const [categories, setCategories] = useState<AdminCommissionCategory[] | null>(null);
  const [categoryValues, setCategoryValues] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    setDraft(null);
    setCategories(null);
    void Promise.all([getCommissionConfig(), listCommissionCategories()])
      .then(([config, rows]) => {
        setDraft(toDraft(config));
        setCategories(rows);
        setCategoryValues(Object.fromEntries(rows.map((row) => [row.id, row.commission_bp == null ? '' : String(row.commission_bp)])));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  useFocusEffect(load);

  const saveConfig = async () => {
    setFormError(null);
    let config: AdminCommissionConfig;
    try {
      if (!draft) return;
      config = parseDraft(draft);
    } catch (e) {
      setFormError((e as Error).message);
      return;
    }
    setSavingConfig(true);
    try {
      const saved = await setCommissionConfig(config);
      setDraft(toDraft(saved));
      toast({ message: 'Commission policy saved', tone: 'success' });
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const saveCategory = async (category: AdminCommissionCategory) => {
    setCategoryError(null);
    let bp: number | null;
    try {
      bp = categoryValue(categoryValues[category.id] ?? '');
    } catch (e) {
      setCategoryError(`${category.name}: ${(e as Error).message}`);
      return;
    }
    setSavingCategory(category.id);
    try {
      await setCategoryCommission(category.id, bp);
      setCategories((rows) => rows?.map((row) => row.id === category.id ? { ...row, commission_bp: bp } : row) ?? null);
      toast({ message: `${category.name} commission saved`, tone: 'success' });
    } catch (e) {
      setCategoryError((e as Error).message);
    } finally {
      setSavingCategory(null);
    }
  };

  return (
    <Screen header={<Header title="Commission" subtitle="Provider rates and category overrides" />}>
      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !draft || !categories ? (
        <Skeleton height={420} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="title3">Default policy</Text>
            <Text variant="footnote" color="muted">Rates and discounts are in basis points (100 bp = 1%). Add up to 10 tiers; the server remains authoritative.</Text>
            <Input
              label="Founding period (days)"
              keyboardType="number-pad"
              value={draft.foundingDays}
              onChangeText={(foundingDays) => setDraft((current) => current ? { ...current, foundingDays } : current)}
            />
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="subheadStrong">Standard job tiers</Text>
              {[...draft.tiers]
                .sort((a, b) => Number(b.minJobs) - Number(a.minJobs))
                .map((tier) => (
                <View key={tier.id} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
                  <Input
                    label="Minimum jobs"
                    keyboardType="number-pad"
                    value={tier.minJobs}
                    containerStyle={{ flex: 1 }}
                    onChangeText={(minJobs) => setDraft((current) => current ? {
                      ...current,
                      tiers: current.tiers.map((item) => item.id === tier.id ? { ...item, minJobs } : item),
                    } : current)}
                  />
                  <Input
                    label="Rate (bp)"
                    keyboardType="number-pad"
                    value={tier.bp}
                    containerStyle={{ flex: 1 }}
                    onChangeText={(bp) => setDraft((current) => current ? {
                      ...current,
                      tiers: current.tiers.map((item) => item.id === tier.id ? { ...item, bp } : item),
                    } : current)}
                  />
                  <Button
                    title="Remove"
                    variant="ghost"
                    size="sm"
                    disabled={draft.tiers.length === 1}
                    onPress={() => setDraft((current) => current ? { ...current, tiers: current.tiers.filter((item) => item.id !== tier.id) } : current)}
                  />
                </View>
                ))}
              <Button
                title="Add tier"
                variant="outline"
                size="sm"
                disabled={draft.tiers.length >= 10}
                onPress={() => setDraft((current) => current ? { ...current, tiers: [...current.tiers, { id: `new-${++nextTierId}`, minJobs: '', bp: '' }] } : current)}
              />
            </View>
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="subheadStrong">Time-based session rates</Text>
              <Text variant="footnote" color="muted">Default rates, separate from standard job tiers; repeat-customer discounts do not apply.</Text>
              <Input
                label="One-off session (bp)"
                keyboardType="number-pad"
                value={draft.timeBasedOneOffBp}
                onChangeText={(timeBasedOneOffBp) => setDraft((current) => current ? { ...current, timeBasedOneOffBp } : current)}
              />
              <Input
                label="Recurring session (bp)"
                keyboardType="number-pad"
                value={draft.timeBasedRecurringBp}
                onChangeText={(timeBasedRecurringBp) => setDraft((current) => current ? { ...current, timeBasedRecurringBp } : current)}
              />
            </View>
            <Text variant="subheadStrong">Repeat-customer adjustment · standard jobs</Text>
            <Input
              label="Repeat customer discount (bp)"
              keyboardType="number-pad"
              value={draft.repeatDiscountBp}
              onChangeText={(repeatDiscountBp) => setDraft((current) => current ? { ...current, repeatDiscountBp } : current)}
            />
            <Input
              label="Repeat customer floor (bp)"
              keyboardType="number-pad"
              value={draft.repeatFloorBp}
              onChangeText={(repeatFloorBp) => setDraft((current) => current ? { ...current, repeatFloorBp } : current)}
            />
            <InlineAlert message={formError} />
            <Button title="Save commission policy" loading={savingConfig} onPress={() => void saveConfig()} />
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Category overrides</Text>
            <Text variant="footnote" color="muted">Leave a field empty to use the default commission schedule for that category.</Text>
            {categories.map((category) => (
              <View key={category.id} style={{ gap: t.spacing.sm, paddingVertical: t.spacing.sm }}>
                <View>
                  <Text variant="bodyStrong">{category.name}</Text>
                  <Text variant="caption" color="muted">{category.archetype.replace('_', ' ')} · {category.active ? 'Active' : 'Inactive'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
                  <Input
                    label="Commission (bp)"
                    placeholder="Default policy"
                    keyboardType="number-pad"
                    value={categoryValues[category.id] ?? ''}
                    containerStyle={{ flex: 1 }}
                    onChangeText={(value) => setCategoryValues((current) => ({ ...current, [category.id]: value }))}
                  />
                  <Button
                    title="Save"
                    size="sm"
                    loading={savingCategory === category.id}
                    disabled={savingCategory != null && savingCategory !== category.id}
                    onPress={() => void saveCategory(category)}
                  />
                </View>
              </View>
            ))}
            <InlineAlert message={categoryError} />
          </Card>
        </>
      )}
    </Screen>
  );
}
