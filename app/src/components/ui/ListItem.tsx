import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

interface Props {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconTint?: string;
  left?: ReactNode;
  right?: ReactNode;
  value?: string;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
}

export function ListItem({ title, subtitle, icon, iconTint, left, right, value, chevron, destructive, onPress, accessibilityHint }: Props) {
  const t = useTheme();
  const tint = destructive ? t.colors.danger : (iconTint ?? t.colors.primary);
  const content = (
    <>
      {left ??
        (icon ? (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: t.radii.md,
              backgroundColor: destructive ? t.colors.dangerSoft : tint + (t.dark ? '2E' : '17'),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={20} color={tint} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={destructive ? 'dangerText' : 'text'} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="muted" numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="muted">
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={t.colors.subtle} /> : null}
    </>
  );
  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.md,
    minHeight: 60,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
  };
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: t.colors.surfaceAlt }]}
    >
      {content}
    </Pressable>
  );
}
