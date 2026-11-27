import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, View, Pressable } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Card, Text } from '../../components/ui';
import { useTheme } from '../../theme';

export type IconName = keyof typeof Ionicons.glyphMap;
export { ACTIVE_PRIORITY, NEXT_STEP, getNextStep, getPrimaryJobAction, getRequestActionState, isActiveProviderJob } from '../../lib/types';

export const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export function OnlineCard({ online, radiusKm, onChange, disabled }: { online: boolean; radiusKm: number | null; onChange: (v: boolean) => void; disabled: boolean }) {
  const t = useTheme();
  /** react-native-web paints the ON thumb teal unless activeThumbColor is set (not in the RN types). */
  const webSwitchThumb = { activeThumbColor: t.colors.onPrimary } as object;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        padding: t.spacing.lg,
        borderRadius: t.radii.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: online ? t.colors.success : t.colors.border,
        backgroundColor: online ? t.colors.successSoft : t.colors.surface,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: online ? t.colors.success : t.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={online ? 'radio' : 'moon-outline'} size={20} color={online ? t.colors.onPrimary : t.colors.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="calloutStrong" color={online ? 'successText' : 'text'}>
          {online ? "You're online" : "You're offline"}
        </Text>
        <Text variant="footnote" color={online ? 'successText' : 'muted'}>
          {online
            ? `Receiving requests${radiusKm ? ` within ${radiusKm} km` : ''}`
            : "Customers can't book you right now"}
        </Text>
      </View>
      <Switch
        value={online}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.colors.success, false: t.colors.outline }}
        thumbColor={t.colors.onPrimary}
        {...webSwitchThumb}
        accessibilityLabel={online ? 'Online. Turn off to stop receiving requests' : 'Offline. Turn on to receive requests'}
      />
    </View>
  );
}
export function StatsStrip({ items }: { items: { label: string; value: string; icon?: IconName; onPress?: () => void }[] }) {
  const t = useTheme();
  return (
    <Card padding={0} gap={0} style={{ flexDirection: 'row' }}>
      {items.map((it, i) => (
        <Pressable
          key={it.label}
          disabled={!it.onPress}
          onPress={it.onPress}
          accessibilityRole={it.onPress ? 'button' : 'text'}
          accessibilityLabel={`${it.label}: ${it.value}`}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: t.spacing.md,
            paddingHorizontal: t.spacing.sm,
            alignItems: 'center',
            gap: 2,
            borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: t.colors.border,
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {it.icon ? <Ionicons name={it.icon} size={13} color={t.colors.star} /> : null}
            <Text variant="calloutStrong" tabular numberOfLines={1} adjustsFontSizeToFit>
              {it.value}
            </Text>
          </View>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

export function CountdownRing({ leftMs }: { leftMs: number }) {
  const t = useTheme();
  const size = 52;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, leftMs / RESPONSE_WINDOW_MS));
  const urgent = leftMs < 3 * 60 * 1000;
  const color = leftMs <= 0 ? t.colors.outline : urgent ? t.colors.danger : t.colors.warning;
  const mm = Math.floor(leftMs / 60000);
  const ss = Math.floor((leftMs % 60000) / 1000);
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel={leftMs > 0 ? `${mm} minutes ${ss} seconds left to accept` : 'Expired'}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - frac)}
        />
      </Svg>
      <Text variant="captionStrong" color={urgent ? 'dangerText' : 'text'} tabular maxFontSizeMultiplier={1}>
        {leftMs > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : '0:00'}
      </Text>
    </View>
  );
}
