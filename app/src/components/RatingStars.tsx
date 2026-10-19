import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouch } from '../lib/theme';

interface Props {
  value: number;
  size?: number;
  onChange?: (value: number) => void;
  label?: string;
}

export function RatingStars({ value, size = 16, onChange, label }: Props) {
  const rounded = Math.round(value);
  return (
    <View
      style={styles.row}
      accessibilityRole={onChange ? 'adjustable' : 'text'}
      accessibilityLabel={`${label ? label + ': ' : ''}${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const star = (
          <Text style={{ fontSize: size, color: n <= rounded ? colors.warning : colors.border }}>★</Text>
        );
        return onChange ? (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
            style={styles.touch}
          >
            {star}
          </Pressable>
        ) : (
          <View key={n}>{star}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  touch: { minWidth: minTouch, minHeight: minTouch, alignItems: 'center', justifyContent: 'center' },
});
