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
  tone = 'primary',
  compact,
  style,
}: EmptyProps) {
  const t = useTheme();
  const soft = { primary: t.colors.primarySoft, danger: t.colors.dangerSoft, warning: t.colors.warningSoft, success: t.colors.successSoft }[tone];
  const size = compact ? 56 : 80;
  return (
    <View
      style={[
        { alignItems: 'center', paddingVertical: compact ? t.spacing.xl : t.spacing.huge, paddingHorizontal: t.spacing.xl, gap: t.spacing.sm },
        style,
      ]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: soft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: t.spacing.sm,
        }}
      >
        <Ionicons name={icon} size={size * 0.45} color={t.colors[tone]} />
      </View>
      <Text variant="title3" align="center" accessibilityRole="header">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" color="muted" align="center" style={{ maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="secondary" size="sm" style={{ marginTop: t.spacing.md }} />
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
      tone="danger"
      title={title}
      message={message ?? 'Check your connection and try again.'}
      actionLabel={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
      compact={compact}
    />
  );
}

/** Inline, dismiss-free error banner for form/action errors. */
export function InlineAlert({
  message,
  tone = 'danger',
  icon,
  title,
}: {
  message: string | null | undefined;
  tone?: 'danger' | 'warning' | 'info' | 'success';
  icon?: IconName;
  title?: string;
}) {
  const t = useTheme();
  if (!message) return null;
  const map = {
    danger: { bg: t.colors.dangerSoft, fg: t.colors.dangerText, icon: 'alert-circle' as IconName },
    warning: { bg: t.colors.warningSoft, fg: t.colors.warningText, icon: 'warning' as IconName },
    info: { bg: t.colors.primarySoft, fg: t.colors.primary, icon: 'information-circle' as IconName },
    success: { bg: t.colors.successSoft, fg: t.colors.successText, icon: 'checkmark-circle' as IconName },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={{
        flexDirection: 'row',
        gap: t.spacing.sm,
        backgroundColor: map.bg,
        borderRadius: t.radii.md,
        padding: t.spacing.md,
        alignItems: 'flex-start',
      }}
    >
      <Ionicons name={icon ?? map.icon} size={18} color={map.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="subhead" style={{ color: map.fg }}>
            {title}
          </Text>
        ) : null}
        <Text variant="caption" style={{ color: map.fg }}>
          {message}
        </Text>
      </View>
    </View>
  );
}
