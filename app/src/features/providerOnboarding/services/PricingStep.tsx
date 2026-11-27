import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { View } from 'react-native';
import { Button, InlineAlert, Input, SegmentedControl, Text } from '../../../components/ui';
import { onboardingApi, type PriceGuidance } from '../../../lib/onboarding';
import { SERVICE_EDITOR_COPY } from '../../../lib/onboarding/copy';
import { formatINR } from '../../../lib/money';
import type { RateUnit } from '../../../lib/types';
import type { ServiceEditorState } from '../serviceEditor';
import { useTheme } from '../../../theme';

export function PricingStep({ state, city, guidance, errors, onState }: {
  state: ServiceEditorState;
  city: string;
  guidance: PriceGuidance | null;
  errors: { visitFee?: string; labourRate?: string };
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
}) {
  const t = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; value: PriceGuidance | null }>({
    key: '',
    status: 'loading',
    value: null,
  });
  const key = `${state.categoryId ?? ''}:${city}:${state.unit}`;

  useEffect(() => {
    if (!state.categoryId || !city) {
      setRead({ key, status: 'ready', value: null });
      return;
    }
    let active = true;
    setRead({ key, status: 'loading', value: null });
    onboardingApi
      .getPriceGuidance(state.categoryId, city, state.unit)
      .then((value) => {
        if (active) setRead({ key, status: 'ready', value });
      })
      .catch(() => {
        if (active) setRead({ key, status: 'error', value: null });
      });
    return () => {
      active = false;
    };
  }, [attempt, city, key, state.categoryId, state.unit]);

  const currentRead = read.key === key ? read : { key, status: 'loading' as const, value: null };
  const displayedGuidance = currentRead.status === 'ready' ? currentRead.value ?? guidance : guidance;

  return (
    <View style={{ gap: t.spacing.lg }}>
      <SegmentedControl<RateUnit>
        options={[{ value: 'job', label: 'Per job' }, { value: 'hour', label: 'Per hour' }]}
        value={state.unit}
        onChange={(unit) => onState((current) => ({ ...current, unit }))}
        accessibilityLabel="Labour rate unit"
      />
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Input label="Visit fee" prefix="₹" keyboardType="decimal-pad" value={state.visitFee} onChangeText={(value) => onState((current) => ({ ...current, visitFee: value.replace(/[^\d.]/g, '') }))} error={errors.visitFee} helper="Credited in the final bill" containerStyle={{ flex: 1 }} accessibilityLabel="Visit fee in rupees" />
        <Input label={`Labour / ${state.unit}`} prefix="₹" keyboardType="decimal-pad" value={state.labour} onChangeText={(value) => onState((current) => ({ ...current, labour: value.replace(/[^\d.]/g, '') }))} error={errors.labourRate} containerStyle={{ flex: 1 }} accessibilityLabel={`Labour rate per ${state.unit} in rupees`} />
      </View>
      <PriceGuidanceCard
        guidance={displayedGuidance}
        city={city}
        hasCategory={!!state.categoryId}
        status={currentRead.status}
        onRetry={() => setAttempt((value) => value + 1)}
      />
      <InlineAlert tone="info" message={SERVICE_EDITOR_COPY.packageHint} />
    </View>
  );
}

export function PriceGuidanceCard({
  guidance,
  city,
  hasCategory,
  status,
  onRetry,
}: {
  guidance: PriceGuidance | null;
  city: string;
  hasCategory: boolean;
  status: 'loading' | 'ready' | 'error';
  onRetry: () => void;
}) {
  const t = useTheme();
  if (!hasCategory) return null;
  let body: string;
  if (!city) body = 'Set your service area to see local prices.';
  else if (status === 'error') body = 'Local price guidance is unavailable.';
  else if (status === 'loading') body = 'Checking local prices…';
  else if (!guidance || (!guidance.visit_fee && !guidance.labour_rate)) body = guidance
    ? `No local data yet for ${city}. Prices appear once ${guidance.min_points}+ pros or completed jobs exist here.`
    : `No local price data is available yet for ${city}.`;
  else {
    const parts: string[] = [];
    if (guidance.visit_fee) parts.push(`Visit fee: typical ${formatINR(guidance.visit_fee.p25)}–${formatINR(guidance.visit_fee.p75)}, median ${formatINR(guidance.visit_fee.median)} (${guidance.visit_fee.n} data points)`);
    if (guidance.labour_rate) parts.push(`Labour: typical ${formatINR(guidance.labour_rate.p25)}–${formatINR(guidance.labour_rate.p75)}, median ${formatINR(guidance.labour_rate.median)} (${guidance.labour_rate.n} pros)`);
    body = parts.join('\n');
  }
  return (
    <View style={{ backgroundColor: t.colors.infoSoft, borderRadius: t.radii.md, padding: t.spacing.md, gap: t.spacing.xs }} accessibilityLabel={`Local price guidance for ${city || 'your city'}`}>
      <Text variant="footnoteStrong" color="infoText">Local prices in {city || 'your city'}</Text>
      <Text variant="footnote" color="textSecondary">{body}</Text>
      {status === 'error' ? <Button title="Retry" size="sm" variant="outline" onPress={onRetry} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}
