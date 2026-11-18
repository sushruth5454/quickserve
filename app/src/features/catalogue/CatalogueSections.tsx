import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon, iconForCategory } from '../../components/CategoryIcon';
import { Card, EmptyState, Section, Text } from '../../components/ui';
import { useFeature } from '../../lib/featureFlags';
import type { Category } from '../../lib/types';
import { useTheme } from '../../theme';
import { buildCatalogueSections, type CatalogueVertical } from './model';

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
  const catalogueV2Enabled = useFeature('home_services_catalogue_v2');
  const allowedVerticals = verticalSlugs ? new Set(verticalSlugs) : null;
  const selectedVerticals = verticals.filter((vertical) => !allowedVerticals || allowedVerticals.has(vertical.slug));
  const sections = buildCatalogueSections(selectedVerticals, catalogueV2Enabled, filter);

  if (sections.length === 0) {
    return (
      <EmptyState
        compact
        icon="search"
        title={filter.trim() ? 'No matching service' : 'No services available'}
        message={filter.trim() ? `We don't have "${filter.trim()}" yet. Try another word.` : 'There are no services available in this group right now.'}
      />
    );
  }

  return (
    <View style={{ gap: t.spacing.xl }}>
      {sections.map((section, sectionIndex) => (
        <Section key={section.slug} title={section.label}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
            {section.categories.map((category, index) => (
              <Animated.View key={category.id} entering={FadeInDown.delay(Math.min(sectionIndex * 5 + index, 10) * 20).duration(220)} style={{ width: '47%' }}>
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
