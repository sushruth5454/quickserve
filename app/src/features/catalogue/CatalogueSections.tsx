import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Badge, Section, Text } from '../../components/ui';
import type { Category } from '../../lib/types';
import { useTheme } from '../../theme';
import type { CatalogueVertical } from './model';

export function CatalogueSections({
  verticals,
  filter,
}: {
  verticals: CatalogueVertical[];
  filter: string;
}) {
  const t = useTheme();
  const query = filter.trim().toLowerCase();
  const visible = verticals.map((vertical) => ({
    ...vertical,
    categories: vertical.categories.filter((category) => category.name.toLowerCase().includes(query)),
  })).filter((vertical) => vertical.categories.length > 0);

  return (
    <View style={{ gap: t.spacing.xl }}>
      {visible.map((vertical, verticalIndex) => (
        <Section key={vertical.slug} title={vertical.label}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -t.spacing.lg }} contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}>
            {vertical.categories.map((category, index) => (
              <Animated.View key={category.id} entering={FadeInDown.delay(Math.min(verticalIndex * 5 + index, 10) * 20).duration(220)} style={{ width: 92 }}>
                <CategoryTile category={category} />
              </Animated.View>
            ))}
          </ScrollView>
        </Section>
      ))}
    </View>
  );
}

function CategoryTile({ category }: { category: Category }) {
  const t = useTheme();
  const action = category.archetype === 'proposal' ? 'Compare quotes' : category.archetype === 'time_based' ? 'Sessions' : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${category.name}${action ? `, ${action}` : ''}`}
      onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: category.slug, name: category.name } })}
      style={({ pressed }) => ({ alignItems: 'center', gap: 8, opacity: pressed ? 0.65 : 1 })}
    >
      <CategoryIcon icon={category.icon} size={64} />
      <Text variant="caption" color="textSecondary" align="center" numberOfLines={2} style={{ minHeight: 32 }}>{category.name}</Text>
      {action ? <Badge label={action} tone="neutral" /> : null}
    </Pressable>
  );
}
