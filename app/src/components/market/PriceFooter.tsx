import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { Button, type IconName } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTheme } from '../../theme';

export interface PriceFooterProps {
  caption: string;
  amountLabel: string;
  cta: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    leftIcon?: IconName;
    accessibilityHint?: string;
  };
  note?: { text: string; tone?: 'muted' | 'warningText' } | null;
  above?: ReactNode;
  amountVariant?: 'amount' | 'text';
}

export function PriceFooter({
  caption,
  amountLabel,
  cta,
  note,
  above,
  amountVariant = 'amount',
}: PriceFooterProps): ReactElement {
  const t = useTheme();

  return (
    <View style={{ gap: t.spacing.sm }}>
      {above}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
        <View style={{ flexShrink: 1 }}>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {caption}
          </Text>
          {amountVariant === 'text' ? (
            <Text variant="calloutStrong">{amountLabel}</Text>
          ) : (
            <Text variant="title2" tabular>
              {amountLabel}
            </Text>
          )}
        </View>
        <Button {...cta} size="lg" style={{ flex: 1 }} />
      </View>
      {note ? (
        <Text variant="caption" color={note.tone ?? 'muted'} align="center">
          {note.text}
        </Text>
      ) : null}
    </View>
  );
}
