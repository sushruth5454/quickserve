import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';
import type { IconName } from './Button';
import { Divider } from './Divider';
import { Text } from './Text';

export interface PriceLine {
  label: string;
  /** Paise. Negative values render as credits ("−₹199"). */
  amount: number;
  hint?: string;
  icon?: IconName;
  emphasis?: 'normal' | 'muted' | 'credit' | 'total';
}

export function PriceRow({ label, amount, hint, icon, emphasis = 'normal' }: PriceLine) {
  const t = useTheme();
  const total = emphasis === 'total';
  const color = emphasis === 'credit' ? 'successText' : emphasis === 'muted' ? 'muted' : 'text';
  const formatted = amount < 0 ? `−${formatINR(-amount)}` : formatINR(amount);
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${formatted}${hint ? `. ${hint}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md, paddingVertical: total ? 2 : 0 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon ? <Ionicons name={icon} size={15} color={t.colors.muted} /> : null}
          <Text variant={total ? 'title3' : 'callout'} color={total ? 'text' : emphasis === 'muted' ? 'muted' : 'textSecondary'} style={{ flexShrink: 1 }}>
            {label}
          </Text>
        </View>
        {hint ? (
          <Text variant="caption" color="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant={total ? 'title3' : 'bodyStrong'} color={color} tabular>
        {formatted}
      </Text>
    </View>
  );
}

/** Itemised money breakdown; the last `total` line is separated by a dashed rule. */
export function PriceBreakdown({ lines, total }: { lines: PriceLine[]; total?: PriceLine }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      {lines.map((l) => (
        <PriceRow key={l.label} {...l} />
      ))}
      {total ? (
        <>
          <Divider dashed />
          <PriceRow {...total} emphasis="total" />
        </>
      ) : null}
    </View>
  );
}
