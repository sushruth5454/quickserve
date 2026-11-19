import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../../components/ui';
import { useTheme } from '../../../theme';

export function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="title3" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="footnote" color="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function ModeCard(props: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: !!props.disabled }}
      accessibilityLabel={`${props.title}. ${props.subtitle}`}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: t.spacing.md,
        borderRadius: t.radii.md,
        borderWidth: props.selected ? 1.5 : 1,
        borderColor: props.selected ? t.colors.primary : t.colors.border,
        backgroundColor: props.selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
        gap: 4,
        opacity: props.disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={props.icon} size={20} color={props.selected ? t.colors.primaryText : t.colors.textSecondary} />
      <Text variant="subheadStrong" color={props.selected ? 'primaryText' : 'text'}>
        {props.title}
      </Text>
      <Text variant="caption" color="muted">
        {props.subtitle}
      </Text>
    </Pressable>
  );
}
