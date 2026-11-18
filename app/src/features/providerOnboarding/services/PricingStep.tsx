import type { Dispatch, SetStateAction } from 'react';
import { View } from 'react-native';
import { InlineAlert, Input, SegmentedControl, Text } from '../../../components/ui';
import type { PriceGuidance } from '../../../lib/onboarding';
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
      <PriceGuidanceCard guidance={guidance} city={city} hasCategory={!!state.categoryId} />
      <InlineAlert tone="info" message={SERVICE_EDITOR_COPY.packageHint} />
    </View>
  );
}

function PriceGuidanceCard({ guidance, city, hasCategory }: { guidance: PriceGuidance | null; city: string; hasCategory: boolean }) {
  const t = useTheme();
  if (!hasCategory) return null;
  let body: string;
  if (!city) body = 'Set your service area to see local prices.';
  else if (!guidance) body = 'Checking local prices…';
  else if (!guidance.visit_fee && !guidance.labour_rate) body = `No local data yet for ${city}. Prices appear once ${guidance.min_points}+ pros or completed jobs exist here.`;
  else {
    const parts: string[] = [];
    if (guidance.visit_fee) parts.push(`Visit fee: typical ${formatINR(guidance.visit_fee.p25)}–${formatINR(guidance.visit_fee.p75)}, median ${formatINR(guidance.visit_fee.median)} (${guidance.visit_fee.n} data points)`);
    if (guidance.labour_rate) parts.push(`Labour: typical ${formatINR(guidance.labour_rate.p25)}–${formatINR(guidance.labour_rate.p75)}, median ${formatINR(guidance.labour_rate.median)} (${guidance.labour_rate.n} pros)`);
    body = parts.join('\n');
  }
  return (
    <View style={{ backgroundColor: t.colors.infoSoft, borderRadius: t.radii.md, padding: t.spacing.md, gap: 4 }} accessibilityLabel={`Local price guidance for ${city || 'your city'}`}>
      <Text variant="footnoteStrong" color="infoText">Local prices in {city || 'your city'}</Text>
      <Text variant="footnote" color="textSecondary">{body}</Text>
    </View>
  );
}
