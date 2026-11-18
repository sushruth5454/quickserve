import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon, iconForCategory } from '../../components/CategoryIcon';
import { Card, Section, Text } from '../../components/ui';
import type { Category } from '../../lib/types';
import { useTheme } from '../../theme';
import type { CatalogueVertical } from './model';

export function CatalogueSections({
  verticals,
  filter,
  verticalSlugs,
}: {
  verticals: CatalogueVertical[];
  filter: string;
  verticalSlugs?: string[];
}) {
  const t = useTheme();
  const query = filter.trim().toLowerCase();
  const allowedVerticals = verticalSlugs ? new Set(verticalSlugs) : null;
  const visible = verticals.filter((vertical) => !allowedVerticals || allowedVerticals.has(vertical.slug)).map((vertical) => ({
    ...vertical,
    categories: vertical.categories.filter((category) => category.name.toLowerCase().includes(query)),
  })).filter((vertical) => vertical.categories.length > 0);

  return (
    <View style={{ gap: t.spacing.xl }}>
      {visible.map((vertical, verticalIndex) => (
        <Section key={vertical.slug} title={vertical.label}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
            {vertical.categories.map((category, index) => (
              <Animated.View key={category.id} entering={FadeInDown.delay(Math.min(verticalIndex * 5 + index, 10) * 20).duration(220)} style={{ width: '47%' }}>
                <CategoryTile category={category} />
              </Animated.View>
            ))}
          </View>
        </Section>
      ))}
    </View>
  );
}

function CategoryTile({ category }: { category: Category }) {
  const t = useTheme();
  const action =
    category.archetype === 'proposal'
      ? 'Compare quotes'
      : category.archetype === 'time_based'
        ? 'Book a session'
        : category.archetype === 'fixed'
          ? 'View packages'
          : 'Request a quote';
  return (
    <Card
      onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: category.slug, name: category.name } })}
      accessibilityLabel={`${category.name}, ${action}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 56 }}>
        <CategoryIcon icon={iconForCategory(category)} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>{category.name}</Text>
          <Text variant="caption" color="muted">{action}</Text>
        </View>
      </View>
    </Card>
  );
}
