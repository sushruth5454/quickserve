import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '../../components/ui';
import { useTheme } from '../../theme';
import type { ActivitySegment } from './model';

export interface ActivitySegmentOption {
  value: ActivitySegment;
  label: string;
  badge?: string;
}

export function ActivitySegmentControl({
  options,
  value,
  onChange,
}: {
  options: ActivitySegmentOption[];
  value: ActivitySegment;
  onChange: (segment: ActivitySegment) => void;
}) {
  const t = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: t.spacing.xs, paddingHorizontal: t.spacing.lg }}
      accessibilityRole="tablist"
      accessibilityLabel="Activity segments"
    >
      {options.map((option) => {
        const selected = option.value === value;
        const label = option.badge ? `${option.label}, ${option.badge} unread` : option.label;
        return (
          <Pressable
            key={option.value}
            testID={`activity-segment-${option.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onChange(option.value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: 40,
              paddingHorizontal: t.spacing.md,
              borderRadius: t.radii.md,
              backgroundColor: selected ? t.colors.segmentThumb : t.colors.surfaceAlt,
            }}
          >
            <Text variant={selected ? 'subheadStrong' : 'subhead'} color={selected ? 'text' : 'muted'} numberOfLines={1}>
              {option.label}
            </Text>
            {option.badge ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 5,
                  borderRadius: 9,
                  backgroundColor: selected ? t.colors.primary : t.colors.borderStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="micro" style={{ color: selected ? '#FFFFFF' : t.colors.textSecondary }}>
                  {option.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
