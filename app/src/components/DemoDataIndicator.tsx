import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSeedDemoMode } from '../lib/config';
import { useTheme } from '../theme';
import { Text } from './ui/Text';

export const DEMO_DISCLOSURE_CONTENT_HEIGHT = 40;

export function getDemoDisclosureSlotHeight(bottomInset: number, enabled = isSeedDemoMode): number {
  return enabled ? DEMO_DISCLOSURE_CONTENT_HEIGHT + Math.max(0, bottomInset) : 0;
}

export function DemoDataIndicator() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!isSeedDemoMode) return null;
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Demo data only. No real payments."
      style={{
        height: getDemoDisclosureSlotHeight(insets.bottom),
        paddingBottom: insets.bottom,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.colors.bg,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.colors.border,
      }}
    >
      <View style={{ borderRadius: t.radii.pill, paddingHorizontal: t.spacing.sm, paddingVertical: t.spacing.xs, backgroundColor: t.colors.warningSoft }}>
        <Text variant="micro" color="warningText">DEMO DATA</Text>
      </View>
    </View>
  );
}
