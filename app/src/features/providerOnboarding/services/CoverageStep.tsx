import type { Dispatch, SetStateAction } from 'react';
import { View } from 'react-native';
import { InlineAlert, Input, SegmentedControl, Text } from '../../../components/ui';
import type { TravelFeeMode } from '../../../lib/types';
import { useTheme } from '../../../theme';
import { travelPreview } from './model';
import type { ServiceEditorState } from '../serviceEditor';

export function CoverageStep({ state, radiusKm, error, onState }: {
  state: ServiceEditorState;
  radiusKm: number;
  error?: string;
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="calloutStrong">Travel beyond your normal {radiusKm || 0} km area</Text>
      <SegmentedControl<TravelFeeMode>
        options={[{ value: 'none', label: 'No extra travel' }, { value: 'flat', label: 'Flat fee' }, { value: 'per_km', label: 'Per km' }]}
        value={state.travelFeeMode}
        onChange={(travelFeeMode) => onState((current) => ({ ...current, travelFeeMode }))}
        accessibilityLabel="Travel fee mode"
      />
      {state.travelFeeMode !== 'none' ? (
        <>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Input label="Maximum distance" right={<Text variant="footnote" color="muted">km</Text>} keyboardType="number-pad" value={state.maxTravel} onChangeText={(value) => onState((current) => ({ ...current, maxTravel: value.replace(/[^\d]/g, '') }))} error={error} containerStyle={{ flex: 1 }} accessibilityLabel="Maximum travel distance in kilometres" />
            {state.travelFeeMode === 'flat' ? (
              <Input label="Travel fee" prefix="₹" keyboardType="decimal-pad" value={state.travelFlat} onChangeText={(value) => onState((current) => ({ ...current, travelFlat: value.replace(/[^\d.]/g, '') }))} error={error} containerStyle={{ flex: 1 }} />
            ) : (
              <Input label="Fee beyond normal area" prefix="₹" right={<Text variant="footnote" color="muted">/km</Text>} keyboardType="decimal-pad" value={state.travelPerKm} onChangeText={(value) => onState((current) => ({ ...current, travelPerKm: value.replace(/[^\d.]/g, '') }))} error={error} containerStyle={{ flex: 1 }} />
            )}
          </View>
          <InlineAlert tone="info" message={travelPreview(radiusKm, state.travelFeeMode, state.travelFlat, state.travelPerKm)} />
        </>
      ) : <InlineAlert tone="info" message="Customers outside your normal area will not be shown this service." />}
    </View>
  );
}
