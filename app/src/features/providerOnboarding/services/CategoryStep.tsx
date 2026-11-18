import { Pressable, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../../components/CategoryIcon';
import { InlineAlert, Text } from '../../../components/ui';
import { SERVICE_EDITOR_COPY } from '../../../lib/onboarding/copy';
import { useTheme } from '../../../theme';
import { FieldLabel } from '../parts';
import type { SectionProps } from '../parts';

export function CategoryStep({ categories, selectedId, locked, activeCategoryIds, error, onSelect }: {
  categories: SectionProps['data']['categories'];
  selectedId: string | null;
  locked: boolean;
  activeCategoryIds: Set<string>;
  error?: string;
  onSelect: (id: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <FieldLabel error={error}>{locked ? 'Current category' : 'Service category'}</FieldLabel>
      {locked ? <InlineAlert tone="info" message={SERVICE_EDITOR_COPY.existingCategoryHint} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }} accessibilityRole="radiogroup" accessibilityLabel="Service category">
        {categories.filter((category) => !locked || category.id === selectedId).map((category) => {
          const selected = category.id === selectedId;
          return (
            <Pressable
              key={category.id}
              accessibilityRole="radio"
              accessibilityLabel={`${category.name}${activeCategoryIds.has(category.id) ? ', already added' : ''}`}
              accessibilityState={{ checked: selected, disabled: locked }}
              disabled={locked}
              onPress={() => onSelect(category.id)}
              style={{
                minHeight: 88,
                minWidth: 148,
                flexGrow: 1,
                flexBasis: '45%',
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.md,
                borderWidth: selected ? 1.5 : 1,
                borderColor: selected ? t.colors.primary : t.colors.border,
                borderRadius: t.radii.lg,
                padding: t.spacing.md,
                backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
              }}
            >
              <CategoryIcon icon={iconForSlug(category.slug)} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text variant="calloutStrong" color={selected ? 'primaryText' : 'text'}>{category.name}</Text>
                <Text variant="footnote" color="muted">{activeCategoryIds.has(category.id) ? 'Already added · tap to edit' : 'Choose this service'}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
