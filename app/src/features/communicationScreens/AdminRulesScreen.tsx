import { router, useFocusEffect } from 'expo-router';
import { useCallback, useReducer } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
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
} from '../../lib/adminRulesApi';
import { isAdminRulesEditorEnabled } from '../../lib/adminFeaturePresentation';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useTheme } from '../../theme';

interface AdminRulesEditorState {
  recurring: RecurringRulesDraft | null;
  savedRecurring: RecurringRulesDraft | null;
  sports: SportsRulesDraft | null;
  savedSports: SportsRulesDraft | null;
  loadError: string | null;
  saveError: string | null;
  saving: boolean;
}

type AdminRulesEditorAction =
  | { type: 'load-start' }
  | { type: 'load-success'; rules: AdminRules }
  | { type: 'load-error'; message: string }
  | { type: 'change-recurring'; update: (draft: RecurringRulesDraft) => RecurringRulesDraft }
  | { type: 'change-sports'; update: (draft: SportsRulesDraft) => SportsRulesDraft }
  | { type: 'recurring-saved'; draft: RecurringRulesDraft }
  | { type: 'sports-saved'; draft: SportsRulesDraft }
  | { type: 'save-start' }
  | { type: 'save-error'; message: string }
  | { type: 'save-finish' }
  | { type: 'discard' };

const initialState: AdminRulesEditorState = {
  recurring: null,
  savedRecurring: null,
  sports: null,
  savedSports: null,
  loadError: null,
  saveError: null,
  saving: false,
};

function sameDraft<T>(left: T | null, right: T | null): boolean {
  return left !== null && right !== null && JSON.stringify(left) === JSON.stringify(right);
}

function isClean<T>(draft: T | null, saved: T | null): boolean {
  return draft === null || saved === null || sameDraft(draft, saved);
}

function adminRulesEditorReducer(
  state: AdminRulesEditorState,
  action: AdminRulesEditorAction,
): AdminRulesEditorState {
  switch (action.type) {
    case 'load-start':
      return { ...state, loadError: null, saveError: null };
    case 'load-success': {
      const recurringIsClean = isClean(state.recurring, state.savedRecurring);
      const sportsIsClean = isClean(state.sports, state.savedSports);
      const recurring = recurringIsClean ? toRecurringRulesDraft(action.rules.recurring) : state.recurring;
      const sports = sportsIsClean ? toSportsRulesDraft(action.rules.sports) : state.sports;
      return {
        ...state,
        recurring,
        savedRecurring: recurringIsClean ? recurring : state.savedRecurring,
        sports,
        savedSports: sportsIsClean ? sports : state.savedSports,
      };
    }
    case 'load-error':
      return { ...state, loadError: action.message };
    case 'change-recurring':
      return state.recurring ? { ...state, recurring: action.update(state.recurring) } : state;
    case 'change-sports':
      return state.sports ? { ...state, sports: action.update(state.sports) } : state;
    case 'recurring-saved':
      return { ...state, recurring: action.draft, savedRecurring: action.draft };
    case 'sports-saved':
      return { ...state, sports: action.draft, savedSports: action.draft };
    case 'save-start':
      return { ...state, saveError: null, saving: true };
    case 'save-error':
      return { ...state, saveError: action.message };
    case 'save-finish':
      return { ...state, saving: false };
    case 'discard':
      return {
        ...state,
        recurring: state.savedRecurring,
        sports: state.savedSports,
        saveError: null,
      };
    default:
      return state;
  }
}

function useAdminRulesController() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const flags = useAppFeatureFlags();
  const enabled = isAdminRulesEditorEnabled(flags.isOn);
  const [state, dispatch] = useReducer(adminRulesEditorReducer, initialState);

  const load = useCallback(() => {
    if (!enabled) return;
    dispatch({ type: 'load-start' });
    void getAdminRules()
      .then((rules: AdminRules) => dispatch({ type: 'load-success', rules }))
      .catch((error: Error) => dispatch({ type: 'load-error', message: error.message }));
  }, [enabled]);
  useFocusEffect(load);

  const save = async () => {
    if (!enabled || !state.recurring || !state.sports || state.saving) return;

    let recurringRules: RecurringRules;
    let sportsRules: SportsRules;
    try {
      recurringRules = parseRecurringRulesDraft(state.recurring);
      sportsRules = parseSportsRulesDraft(state.sports);
    } catch (error) {
      dispatch({ type: 'save-error', message: (error as Error).message });
      return;
    }

    dispatch({ type: 'save-start' });
    try {
      const savedRecurring = await saveAdminRules('recurring_rules', recurringRules);
      dispatch({ type: 'recurring-saved', draft: toRecurringRulesDraft(savedRecurring) });
    } catch (error) {
      dispatch({ type: 'save-error', message: (error as Error).message });
      dispatch({ type: 'save-finish' });
      return;
    }

    try {
      const savedSports = await saveAdminRules('sports_rules', sportsRules);
      dispatch({ type: 'sports-saved', draft: toSportsRulesDraft(savedSports) });
      toast({ message: 'Booking rules saved', tone: 'success' });
    } catch (error) {
      dispatch({
        type: 'save-error',
        message: `Recurring rules were saved. Sports rules were not saved: ${(error as Error).message}`,
      });
    } finally {
      dispatch({ type: 'save-finish' });
    }
  };

  const dirty = !isClean(state.recurring, state.savedRecurring) || !isClean(state.sports, state.savedSports);
  const continueNavigation = async (navigate: () => void) => {
    if (state.saving) return;
    if (dirty) {
      const discard = await confirm({
        title: 'Discard unsaved changes?',
        message: 'Your booking rule changes have not been saved.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        destructive: true,
      });
      if (!discard) return;
      dispatch({ type: 'discard' });
    }
    navigate();
  };

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  };

  const navigateTo = (path: '/admin/services' | '/admin/commission' | '/admin/geography') => {
    void continueNavigation(() => router.push(path));
  };

  return {
    enabled,
    flags,
    state,
    t,
    load,
    save,
    changeRecurring: (update: (draft: RecurringRulesDraft) => RecurringRulesDraft) => dispatch({ type: 'change-recurring', update }),
    changeSports: (update: (draft: SportsRulesDraft) => SportsRulesDraft) => dispatch({ type: 'change-sports', update }),
    navigateTo,
    back: () => { void continueNavigation(back); },
  };
}

export default function AdminRulesScreen() {
  const controller = useAdminRulesController();
  const { enabled, flags, state, t } = controller;

  if (!enabled) {
    return (
      <Screen header={<Header title="Booking rules" subtitle="Recurring and sports policies" onBack={controller.back} />}>
        <Card gap={t.spacing.md}>
          <Text variant="title3">Booking rules are unavailable</Text>
          <Text variant="body">The admin rules editor is disabled. No booking rules were loaded or changed.</Text>
          <Button title="Back to admin" onPress={controller.back} />
        </Card>
      </Screen>
    );
  }

  const { recurring, sports, loadError, saveError, saving } = state;
  const changeRecurring = controller.changeRecurring;
  const changeSports = controller.changeSports;

  return (
    <Screen header={<Header title="Booking rules" subtitle="Recurring and sports policies" onBack={controller.back} />}>
      {loadError ? (
        <ErrorState title="Booking rules unavailable" message={loadError} onRetry={controller.load} />
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
              onChange={(frequencies) => changeRecurring((current) => ({ ...current, frequencies }))}
            />
            <RuleInput label="Booking horizon (days)" value={recurring.horizonDays} onChange={(horizonDays) => changeRecurring((current) => ({ ...current, horizonDays }))} />
            <RuleInput label="Maximum plan length (days)" value={recurring.maxPlanDays} onChange={(maxPlanDays) => changeRecurring((current) => ({ ...current, maxPlanDays }))} />
            <RuleInput label="Skip cutoff (hours)" value={recurring.skipCutoffHours} onChange={(skipCutoffHours) => changeRecurring((current) => ({ ...current, skipCutoffHours }))} />
            <RuleInput label="Reschedule cutoff (hours)" value={recurring.rescheduleCutoffHours} onChange={(rescheduleCutoffHours) => changeRecurring((current) => ({ ...current, rescheduleCutoffHours }))} />
            <RuleInput label="Reminder lead time (hours)" value={recurring.reminderHoursBefore} onChange={(reminderHoursBefore) => changeRecurring((current) => ({ ...current, reminderHoursBefore }))} />
            <RuleInput label="Payment due lead time (hours)" value={recurring.paymentDueHoursBefore} onChange={(paymentDueHoursBefore) => changeRecurring((current) => ({ ...current, paymentDueHoursBefore }))} />
            <RuleInput label="Billing grace period (hours)" value={recurring.billingGraceHours} onChange={(billingGraceHours) => changeRecurring((current) => ({ ...current, billingGraceHours }))} />
            <ChoiceList
              title="Allowed payment frequencies"
              options={PAYMENT_FREQUENCIES}
              values={recurring.paymentFrequencies}
              onChange={(paymentFrequencies) => changeRecurring((current) => ({ ...current, paymentFrequencies }))}
            />
            <RuleInput label="Default recurring discount (%)" value={recurring.recurringDiscountPercent} onChange={(recurringDiscountPercent) => changeRecurring((current) => ({ ...current, recurringDiscountPercent }))} decimal />
            <Text variant="caption" color="muted">Per-category cancellation rules are managed in the category editor.</Text>
            {flags.isOn('admin_category_editor') ? (
              <Button title="Open category editor" variant="outline" onPress={() => controller.navigateTo('/admin/services')} />
            ) : null}
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Sports rules</Text>
            <Text variant="footnote" color="muted">Sports payment and refund settings are stored as paise and basis points.</Text>
            <RuleInput label="Payment hold (minutes)" value={sports.paymentHoldMinutes} onChange={(paymentHoldMinutes) => changeSports((current) => ({ ...current, paymentHoldMinutes }))} />
            <RuleInput label="Approval payment window (minutes)" value={sports.approvalPayWindowMinutes} onChange={(approvalPayWindowMinutes) => changeSports((current) => ({ ...current, approvalPayWindowMinutes }))} />
            <RuleInput label="Maximum active bookings per customer" value={sports.maxActiveHoldsPerCustomer} onChange={(maxActiveHoldsPerCustomer) => changeSports((current) => ({ ...current, maxActiveHoldsPerCustomer }))} />
            <RuleInput label="Request response window (minutes)" value={sports.requestResponseMinutes} onChange={(requestResponseMinutes) => changeSports((current) => ({ ...current, requestResponseMinutes }))} />
            <RuleInput label="Minimum booking lead time (minutes)" value={sports.minLeadMinutes} onChange={(minLeadMinutes) => changeSports((current) => ({ ...current, minLeadMinutes }))} />
            <RuleInput label="Sports commission (%)" value={sports.commissionPercent} onChange={(commissionPercent) => changeSports((current) => ({ ...current, commissionPercent }))} decimal />
            <RuleInput label="Customer fee" value={sports.customerFeeRupees} onChange={(customerFeeRupees) => changeSports((current) => ({ ...current, customerFeeRupees }))} decimal prefix="₹" />
            <RuleInput label="Full refund window (hours)" value={sports.fullRefundHours} onChange={(fullRefundHours) => changeSports((current) => ({ ...current, fullRefundHours }))} />
            <RuleInput label="Partial refund window (hours)" value={sports.partialRefundHours} onChange={(partialRefundHours) => changeSports((current) => ({ ...current, partialRefundHours }))} />
            <RuleInput label="Partial refund amount (%)" value={sports.partialRefundPercent} onChange={(partialRefundPercent) => changeSports((current) => ({ ...current, partialRefundPercent }))} decimal />
            <RuleInput label="Payout release delay (hours)" value={sports.releaseAfterHours} onChange={(releaseAfterHours) => changeSports((current) => ({ ...current, releaseAfterHours }))} />
            <Text variant="caption" color="muted">Commission tiers and geography remain in their existing admin screens.</Text>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button title="Commission settings" variant="outline" onPress={() => controller.navigateTo('/admin/commission')} />
              <Button title="Geography" variant="outline" onPress={() => controller.navigateTo('/admin/geography')} />
            </View>
          </Card>

          <InlineAlert message={saveError} />
          <Button title="Save booking rules" loading={saving} disabled={saving} onPress={() => void controller.save()} />
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
