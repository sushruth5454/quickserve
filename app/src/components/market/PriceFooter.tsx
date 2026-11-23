import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { Button, type IconName } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTheme } from '../../theme';
import type { CardPresentation } from './listingModel';

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
  presentation?: CardPresentation;
}

export function PriceFooter({
  caption,
  amountLabel,
  cta,
  note,
  above,
  amountVariant = 'amount',
  presentation = 'legacy',
}: PriceFooterProps): ReactElement {
  const t = useTheme();
  const isOorva = presentation === 'oorva';

  return (
    <View style={{ gap: t.spacing.sm }}>
      {above}
      <View
        style={{
          flexDirection: isOorva ? 'column' : 'row',
          alignItems: isOorva ? 'stretch' : 'center',
          gap: t.spacing.lg,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text variant="caption" color="muted" numberOfLines={isOorva ? undefined : 1}>
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
        <Button {...cta} size="lg" style={isOorva ? { alignSelf: 'stretch' } : { flex: 1 }} />
      </View>
      {note ? (
        <Text variant="caption" color={note.tone ?? 'muted'} align="center">
          {note.text}
        </Text>
      ) : null}
    </View>
  );
}
