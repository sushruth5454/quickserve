import { View } from 'react-native';
import { isSeedDemoMode } from '../lib/config';
import { useTheme } from '../theme';
import { Text } from './ui';

export function DemoDataIndicator() {
  const t = useTheme();
  if (!isSeedDemoMode) return null;
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Demo data only. No real payments."
      style={{
        position: 'absolute',
        right: t.spacing.sm,
        bottom: t.spacing.xl,
        zIndex: 100,
        borderRadius: t.radii.pill,
        paddingHorizontal: t.spacing.sm,
        paddingVertical: 5,
        backgroundColor: t.colors.warning,
      }}
    >
      <Text variant="micro" style={{ color: '#111827' }}>DEMO DATA</Text>
    </View>
  );
}
