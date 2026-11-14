import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props {
  value: number;
  size?: number;
  onChange?: (value: number) => void;
  /** Accessible context, e.g. "Overall" or "Punctuality". */
  label?: string;
  count?: number;
  /** Interactive only: 40×44 cells instead of 48×48 (for compact sub-rating rows). */
  compact?: boolean;
}

/** Read-only (half-star precision) or interactive star rating. */
export function RatingStars({ value, size = 16, onChange, label, count, compact }: Props) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const a11y = onChange
    ? `${label ? label + ': ' : ''}${value ? `${value} out of 5 stars` : 'not rated'}`
    : `${label ? label + ': ' : ''}Rated ${value.toFixed(1)} out of 5${count != null ? ` from ${count} reviews` : ''}`;

  if (!onChange) {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={a11y} style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const name = value >= n - 0.25 ? 'star' : value >= n - 0.75 ? 'star-half' : 'star-outline';
          return <Ionicons key={n} name={name} size={size} color={name === 'star-outline' ? t.colors.outline : t.colors.star} />;
        })}
      </View>
    );
  }

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={a11y}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, value + 1));
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(1, value - 1));
      }}
      style={{ flexDirection: 'row' }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="button"
          accessibilityLabel={`${label ? label + ' ' : ''}${n} star${n > 1 ? 's' : ''}`}
          accessibilityState={{ selected: n <= value }}
          onPress={() => {
            haptics.select();
            onChange(n);
          }}
          style={({ pressed }) => ({
            minWidth: compact ? 40 : Math.max(t.minTouch, size + 8),
            minHeight: compact ? 44 : Math.max(t.minTouch, size + 8),
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed && !reduceMotion ? 0.88 : 1 }],
          })}
        >
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? t.colors.star : t.colors.outline} />
        </Pressable>
      ))}
    </View>
  );
}
