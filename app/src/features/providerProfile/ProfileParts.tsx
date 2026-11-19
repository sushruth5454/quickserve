import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Text } from '../../components/ui';
import { useTheme } from '../../theme';

export function TrustBadge({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.colors.successSoft, borderRadius: t.radii.pill, paddingHorizontal: 10, paddingVertical: 4 }}
    >
      <Ionicons name={icon} size={13} color={t.colors.successText} />
      <Text variant="captionStrong" color="successText">
        {label}
      </Text>
    </View>
  );
}

export function MetaChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={14} color={t.colors.muted} />
      <Text variant="footnote" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}

export function Bar({ pct, color }: { pct: number; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

export function Radio({ selected }: { selected: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: selected ? 6 : 1.5,
        borderColor: selected ? t.colors.primary : t.colors.outline,
        backgroundColor: t.colors.surface,
      }}
    />
  );
}

export function StatCell({ value, label, icon }: { value: string; label: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon ? <Ionicons name={icon} size={15} color={t.colors.star} /> : null}
        <Text variant="title3" tabular>
          {value}
        </Text>
      </View>
      <Text variant="caption" color="muted">
        {label}
      </Text>
    </View>
  );
}

export function VDivider() {
  const t = useTheme();
  return <View style={{ width: 1, backgroundColor: t.colors.border, marginVertical: 6 }} />;
}

export function Pill({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.sm, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="calloutStrong" tabular>
        {value}
      </Text>
    </View>
  );
}
