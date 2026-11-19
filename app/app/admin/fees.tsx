import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, Card, EmptyState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { getPlatformFees, setPlatformFees, type AdminPlatformFees } from '../../src/lib/adminApi';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { parseRupees } from '../../src/lib/onboarding/validation';
import { useTheme } from '../../src/theme';

interface FeeDraft {
  inspectQuote: string;
  timeBasedSession: string;
  pack: string;
  proposalPercent: string;
  proposalMinimum: string;
  proposalMaximum: string;
}

function toDraft(fees: AdminPlatformFees): FeeDraft {
  return {
    inspectQuote: (fees.inspect_quote / 100).toFixed(2),
    timeBasedSession: (fees.time_based_session / 100).toFixed(2),
    pack: (fees.pack / 100).toFixed(2),
    proposalPercent: (fees.proposal.bp / 100).toFixed(2),
    proposalMinimum: (fees.proposal.min / 100).toFixed(2),
    proposalMaximum: (fees.proposal.max / 100).toFixed(2),
  };
}

function amountPaise(value: string, label: string): number {
  const parsed = parseRupees(value);
  if (parsed == null || !Number.isSafeInteger(parsed) || parsed > 100000000) {
    throw new Error(`${label} must be a non-negative rupee amount within the supported range.`);
  }
  return parsed;
}

function percentBp(value: string): number {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value.trim())) {
    throw new Error('Proposal percentage must be a number from 0 to 100 with at most two decimals.');
  }
  const bp = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(bp) || bp > 10000) {
    throw new Error('Proposal percentage must be between 0 and 100.');
  }
  return bp;
}

function parseDraft(draft: FeeDraft): AdminPlatformFees {
  const config = {
    inspect_quote: amountPaise(draft.inspectQuote, 'Inspect booking fee'),
    time_based_session: amountPaise(draft.timeBasedSession, 'Session fee'),
    pack: amountPaise(draft.pack, 'Pack fee'),
    proposal: {
      bp: percentBp(draft.proposalPercent),
      min: amountPaise(draft.proposalMinimum, 'Proposal minimum'),
      max: amountPaise(draft.proposalMaximum, 'Proposal maximum'),
    },
  };
  if (config.proposal.min > config.proposal.max) {
    throw new Error('Proposal minimum cannot exceed its maximum.');
  }
  return config;
}

export default function AdminFeesScreen() {
  const t = useTheme();
  const toast = useToast();
  const feeSettingsEnabled = useAppFeatureFlags().isOn('platform_fee_settings');
  const [config, setConfig] = useState<AdminPlatformFees | null>(null);
  const [draft, setDraft] = useState<FeeDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!feeSettingsEnabled) return;
    setLoadError(null);
    setConfig(null);
    setDraft(null);
    void getPlatformFees()
      .then((fees) => {
        setConfig(fees);
        setDraft(toDraft(fees));
      })
      .catch((error: Error) => setLoadError(error.message));
  }, [feeSettingsEnabled]);
  useFocusEffect(load);

  const set = (key: keyof FeeDraft, value: string) =>
    setDraft((current) => current ? { ...current, [key]: value } : current);

  const save = async () => {
    setFormError(null);
    if (!draft) return;
    let next: AdminPlatformFees;
    try {
      next = parseDraft(draft);
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }
    setSaving(true);
    try {
      const saved = await setPlatformFees(next);
      setConfig(saved);
      setDraft(toDraft(saved));
      toast({ message: 'Platform fees saved', tone: 'success' });
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<Header title="Platform fees" subtitle="New bookings · amounts in rupees" />}>
      {!feeSettingsEnabled ? (
        <EmptyState
          icon="toggle-outline"
          title="Fee settings are off"
          message="Current fees continue to apply. Enable Platform fee settings from Features to edit them."
          actionLabel="Features"
          onAction={() => router.push('/admin/features')}
        />
      ) : loadError ? (
        <EmptyState icon="alert-circle-outline" title="Fee settings unavailable" message={loadError} actionLabel="Retry" onAction={load} />
      ) : !config || !draft ? (
        <Skeleton height={460} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="callout" color="textSecondary">
              Changes apply to new bookings only. Existing bookings keep their saved fee.
            </Text>
            <Input label="Inspect booking platform fee (₹)" value={draft.inspectQuote} onChangeText={(value) => set('inspectQuote', value)} keyboardType="decimal-pad" />
            <Input label="Time-based session fee (₹)" value={draft.timeBasedSession} onChangeText={(value) => set('timeBasedSession', value)} keyboardType="decimal-pad" />
            <Input label="Session pack fee (₹)" value={draft.pack} onChangeText={(value) => set('pack', value)} keyboardType="decimal-pad" />
            <Input label="Proposal fee rate (%)" value={draft.proposalPercent} onChangeText={(value) => set('proposalPercent', value)} keyboardType="decimal-pad" />
            <Input label="Proposal fee minimum (₹)" value={draft.proposalMinimum} onChangeText={(value) => set('proposalMinimum', value)} keyboardType="decimal-pad" />
            <Input label="Proposal fee maximum (₹)" value={draft.proposalMaximum} onChangeText={(value) => set('proposalMaximum', value)} keyboardType="decimal-pad" />
            <InlineAlert message={formError} />
            <Button title="Save fee settings" onPress={() => void save()} loading={saving} />
          </Card>
        </>
      )}
    </Screen>
  );
}
