import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import {
  getAdminRules,
  parseRecurringRulesDraft,
  parseSportsRulesDraft,
  PAYMENT_FREQUENCIES,
  RECURRING_FREQUENCIES,
  saveAdminRules,
  toRecurringRulesDraft,
  toSportsRulesDraft,
  type AdminRules,
  type RecurringRules,
  type RecurringRulesDraft,
  type SportsRules,
  type SportsRulesDraft,
} from '../../src/lib/adminRulesApi';
import { isAdminRulesEditorEnabled } from '../../src/lib/adminFeaturePresentation';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { useTheme } from '../../src/theme';

export default function AdminRulesScreen() {
  const t = useTheme();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const enabled = isAdminRulesEditorEnabled(flags.isOn);
  const [recurring, setRecurring] = useState<RecurringRulesDraft | null>(null);
  const [sports, setSports] = useState<SportsRulesDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!enabled) return;
    setLoadError(null);
    setSaveError(null);
    setRecurring(null);
    setSports(null);
    void getAdminRules()
      .then(({ recurring: recurringRules, sports: sportsRules }: AdminRules) => {
        setRecurring(toRecurringRulesDraft(recurringRules));
        setSports(toSportsRulesDraft(sportsRules));
      })
      .catch((error: Error) => setLoadError(error.message));
  }, [enabled]);
  useFocusEffect(load);

  const save = async () => {
    if (!recurring || !sports) return;
    setSaveError(null);
    let recurringRules: RecurringRules;
    let sportsRules: SportsRules;
    try {
      recurringRules = parseRecurringRulesDraft(recurring);
      sportsRules = parseSportsRulesDraft(sports);
    } catch (error) {
      setSaveError((error as Error).message);
      return;
    }

    setSaving(true);
    try {
      const savedRecurring = await saveAdminRules('recurring_rules', recurringRules);
      setRecurring(toRecurringRulesDraft(savedRecurring));
    } catch (error) {
      setSaveError((error as Error).message);
      setSaving(false);
      return;
    }

    try {
      const savedSports = await saveAdminRules('sports_rules', sportsRules);
      setSports(toSportsRulesDraft(savedSports));
      toast({ message: 'Booking rules saved', tone: 'success' });
    } catch (error) {
      setSaveError(`Recurring rules were saved. Sports rules were not saved: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) return null;

  return (
    <Screen header={<Header title="Booking rules" subtitle="Recurring and sports policies" />}>
      {loadError ? (
        <ErrorState title="Booking rules unavailable" message={loadError} onRetry={load} />
      ) : !recurring || !sports ? (
        <Skeleton height={540} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="title3">Recurring rules</Text>
            <Text variant="footnote" color="muted">These limits and defaults are checked by the server for new recurring plans.</Text>
            <ChoiceList
              title="Allowed visit frequencies"
              options={RECURRING_FREQUENCIES}
              values={recurring.frequencies}
              onChange={(frequencies) => setRecurring((current) => current ? { ...current, frequencies } : current)}
            />
            <RuleInput label="Booking horizon (days)" value={recurring.horizonDays} onChange={(horizonDays) => setRecurring((current) => current ? { ...current, horizonDays } : current)} />
            <RuleInput label="Maximum plan length (days)" value={recurring.maxPlanDays} onChange={(maxPlanDays) => setRecurring((current) => current ? { ...current, maxPlanDays } : current)} />
            <RuleInput label="Skip cutoff (hours)" value={recurring.skipCutoffHours} onChange={(skipCutoffHours) => setRecurring((current) => current ? { ...current, skipCutoffHours } : current)} />
            <RuleInput label="Reschedule cutoff (hours)" value={recurring.rescheduleCutoffHours} onChange={(rescheduleCutoffHours) => setRecurring((current) => current ? { ...current, rescheduleCutoffHours } : current)} />
            <RuleInput label="Reminder lead time (hours)" value={recurring.reminderHoursBefore} onChange={(reminderHoursBefore) => setRecurring((current) => current ? { ...current, reminderHoursBefore } : current)} />
            <RuleInput label="Payment due lead time (hours)" value={recurring.paymentDueHoursBefore} onChange={(paymentDueHoursBefore) => setRecurring((current) => current ? { ...current, paymentDueHoursBefore } : current)} />
            <RuleInput label="Billing grace period (hours)" value={recurring.billingGraceHours} onChange={(billingGraceHours) => setRecurring((current) => current ? { ...current, billingGraceHours } : current)} />
            <ChoiceList
              title="Allowed payment frequencies"
              options={PAYMENT_FREQUENCIES}
              values={recurring.paymentFrequencies}
              onChange={(paymentFrequencies) => setRecurring((current) => current ? { ...current, paymentFrequencies } : current)}
            />
            <RuleInput label="Default recurring discount (%)" value={recurring.recurringDiscountPercent} onChange={(recurringDiscountPercent) => setRecurring((current) => current ? { ...current, recurringDiscountPercent } : current)} decimal />
            <Text variant="caption" color="muted">Per-category cancellation rules are managed in the category editor.</Text>
            {flags.isOn('admin_category_editor') ? (
              <Button title="Open category editor" variant="outline" onPress={() => router.push('/admin/services')} />
            ) : null}
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Sports rules</Text>
            <Text variant="footnote" color="muted">Sports payment and refund settings are stored as paise and basis points.</Text>
            <RuleInput label="Payment hold (minutes)" value={sports.paymentHoldMinutes} onChange={(paymentHoldMinutes) => setSports((current) => current ? { ...current, paymentHoldMinutes } : current)} />
            <RuleInput label="Approval payment window (minutes)" value={sports.approvalPayWindowMinutes} onChange={(approvalPayWindowMinutes) => setSports((current) => current ? { ...current, approvalPayWindowMinutes } : current)} />
            <RuleInput label="Sports commission (%)" value={sports.commissionPercent} onChange={(commissionPercent) => setSports((current) => current ? { ...current, commissionPercent } : current)} decimal />
            <RuleInput label="Customer fee" value={sports.customerFeeRupees} onChange={(customerFeeRupees) => setSports((current) => current ? { ...current, customerFeeRupees } : current)} decimal prefix="₹" />
            <RuleInput label="Full refund window (hours)" value={sports.fullRefundHours} onChange={(fullRefundHours) => setSports((current) => current ? { ...current, fullRefundHours } : current)} />
            <RuleInput label="Partial refund window (hours)" value={sports.partialRefundHours} onChange={(partialRefundHours) => setSports((current) => current ? { ...current, partialRefundHours } : current)} />
            <RuleInput label="Partial refund amount (%)" value={sports.partialRefundPercent} onChange={(partialRefundPercent) => setSports((current) => current ? { ...current, partialRefundPercent } : current)} decimal />
            <RuleInput label="Payout release delay (hours)" value={sports.releaseAfterHours} onChange={(releaseAfterHours) => setSports((current) => current ? { ...current, releaseAfterHours } : current)} />
            <Text variant="caption" color="muted">Commission tiers and geography remain in their existing admin screens.</Text>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button title="Commission settings" variant="outline" onPress={() => router.push('/admin/commission')} />
              <Button title="Geography" variant="outline" onPress={() => router.push('/admin/geography')} />
            </View>
          </Card>

          <InlineAlert message={saveError} />
          <Button title="Save booking rules" loading={saving} disabled={saving} onPress={() => void save()} />
        </>
      )}
    </Screen>
  );
}

function RuleInput({
  label,
  value,
  onChange,
  decimal = false,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
  prefix?: string;
}) {
  return (
    <Input
      label={label}
      value={value}
      onChangeText={onChange}
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
      prefix={prefix}
    />
  );
}

function ChoiceList<T extends string>({
  title,
  options,
  values,
  onChange,
}: {
  title: string;
  options: readonly { value: T; label: string }[];
  values: T[];
  onChange: (values: T[]) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="subheadStrong">{title}</Text>
      {options.map((option) => {
        const checked = values.includes(option.value);
        return (
          <View key={option.value} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="body">{option.label}</Text>
            <Switch
              accessibilityLabel={option.label}
              value={checked}
              onValueChange={(next) => {
                onChange(next
                  ? [...values, option.value]
                  : values.filter((value) => value !== option.value));
              }}
            />
          </View>
        );
      })}
    </View>
  );
}
