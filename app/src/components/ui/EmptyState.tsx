import { Ionicons } from '@expo/vector-icons';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type Palette } from '../../theme';
import { Button, type IconName } from './Button';
import { Text } from './Text';

interface EmptyProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Deprecated: empty states use a neutral disc. Ignored. */
  tone?: keyof Pick<Palette, 'primary' | 'danger' | 'warning' | 'success'>;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact,
  style,
}: EmptyProps) {
  const t = useTheme();
  const size = compact ? 48 : 64;
  return (
    <View
      style={[
        { alignItems: 'center', paddingVertical: compact ? t.spacing.lg : t.spacing.huge, paddingHorizontal: t.spacing.xl, gap: t.spacing.sm },
        style,
      ]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: t.spacing.xs,
        }}
      >
        <Ionicons name={icon} size={compact ? 22 : 28} color={t.colors.muted} />
      </View>
      <Text variant="title3" align="center" accessibilityRole="header">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" color="muted" align="center" style={{ maxWidth: 280 }}>
          {message}
        </Text>
      ) : null}
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <View style={{ alignItems: 'center', gap: t.spacing.xs, marginTop: t.spacing.md }}>
          {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} variant="outline" /> : null}
          {secondaryLabel && onSecondary ? <Button title={secondaryLabel} onPress={onSecondary} variant="ghost" /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = 'Something went wrong',
  compact,
}: {
  message?: string | null;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={title}
      message={message ?? 'Check your connection and try again.'}
      actionLabel={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
      compact={compact}
    />
  );
}

/** Inline, dismiss-free banner for form/action errors and contextual notes. */
export function InlineAlert({
  message,
  tone = 'danger',
  icon,
  title,
  actionLabel,
  onAction,
}: {
  message: string | null | undefined;
  tone?: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
  icon?: IconName;
  title?: string;
  /** Optional inline text action ("Open Settings", "Retry"). */
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  if (!message) return null;
  const map = {
    danger: { bg: t.colors.dangerSoft, fg: t.colors.dangerText, icon: 'alert-circle' as IconName },
    warning: { bg: t.colors.warningSoft, fg: t.colors.warningText, icon: 'warning' as IconName },
    info: { bg: t.colors.primarySoft, fg: t.colors.primaryText, icon: 'information-circle' as IconName },
    success: { bg: t.colors.successSoft, fg: t.colors.successText, icon: 'checkmark-circle' as IconName },
    neutral: { bg: t.colors.surfaceAlt, fg: t.colors.textSecondary, icon: 'information-circle-outline' as IconName },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={{
        flexDirection: 'row',
        gap: t.spacing.sm,
        backgroundColor: map.bg,
        borderRadius: t.radii.md,
        paddingVertical: t.spacing.md,
        paddingHorizontal: t.spacing.md,
        alignItems: 'flex-start',
      }}
    >
      <Ionicons name={icon ?? map.icon} size={18} color={map.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="subheadStrong" style={{ color: map.fg }}>
            {title}
          </Text>
        ) : null}
        <Text variant="footnote" style={{ color: tone === 'neutral' ? t.colors.textSecondary : map.fg }}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <Text
            variant="subheadStrong"
            accessibilityRole="button"
            onPress={onAction}
            suppressHighlighting
            style={{ color: map.fg, textDecorationLine: 'underline', marginTop: 4, alignSelf: 'flex-start' }}
          >
            {actionLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
