import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

/** Left inset for dividers between list rows with a leading icon tile: 16 padding + 32 tile + 12 gap. */
export const LIST_INSET = 60;

interface Props {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Deprecated: list icons are neutral. Ignored. */
  iconTint?: string;
  left?: ReactNode;
  right?: ReactNode;
  value?: string;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
}

export function ListItem({ title, subtitle, icon, left, right, value, chevron, destructive, onPress, accessibilityHint, testID }: Props) {
  const t = useTheme();
  const content = (
    <>
      {left ??
        (icon ? (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: t.radii.sm,
              backgroundColor: destructive ? t.colors.dangerSoft : t.colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={18} color={destructive ? t.colors.dangerText : t.colors.textSecondary} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" color={destructive ? 'dangerText' : 'text'} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="muted" numberOfLines={1}>
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
    minHeight: subtitle ? 64 : 52,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
  };
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join('. ')}
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
