import { ScrollView } from 'react-native';
import { Chip } from '../ui/Badge';
import { useTheme } from '../../theme';

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}): JSX.Element {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          check={false}
          onPress={() => onChange(option.value)}
          accessibilityLabel={option.label}
        />
      ))}
    </ScrollView>
  );
}
