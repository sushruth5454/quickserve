import type { Dispatch, SetStateAction } from 'react';
import { Pressable, View } from 'react-native';
import { Badge, Chip, InlineAlert, Text } from '../../../components/ui';
import type { CategorySkill, ProfileSchema } from '../../../lib/onboarding';
import { SKILL_LEVEL_INFO } from '../../../lib/onboarding/copy';
import { useTheme } from '../../../theme';
import { FieldLabel, MultiChips } from '../parts';
import {
  expertiseGroups,
  expertiseSelected,
  selectedExpertiseCount,
  toggleExpertise,
  type ExpertiseGroup,
  type ExpertiseOption,
  type ServiceEditorState,
} from '../serviceEditor';

const LEVELS: ServiceEditorState['level'][] = ['beginner', 'skilled', 'expert', 'certified'];

export function ExpertiseStep({ state, schema, skills, error, onState }: {
  state: ServiceEditorState;
  schema: ProfileSchema;
  skills: CategorySkill[];
  error?: string;
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
}) {
  const t = useTheme();
  const groups = expertiseGroups(skills, state.categoryId, schema);
  const selectedCount = selectedExpertiseCount(groups, state);
  const isSelected = (group: ExpertiseGroup, option: ExpertiseOption) =>
    expertiseSelected(group, option, state.specialisations, state.attributes);
  const toggleOption = (group: ExpertiseGroup, option: ExpertiseOption) => onState((current) => toggleExpertise(current, group, option));
  const selectAll = (group: ExpertiseGroup) => {
    const all = group.options.every((option) => isSelected(group, option));
    onState((current) =>
      group.options.reduce(
        (next, option) => (all === expertiseSelected(group, option, next.specialisations, next.attributes) ? toggleExpertise(next, group, option) : next),
        current,
      ),
    );
  };
  return (
    <View style={{ gap: t.spacing.lg }}>
      {groups.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="footnote" color="muted" style={{ flex: 1 }}>Tap every job you can do on your own.</Text>
          <Badge label={`${selectedCount} selected`} tone={selectedCount ? 'success' : 'neutral'} />
        </View>
      ) : (
        <InlineAlert tone="info" message="This category has no expertise list. Just choose your experience level." />
      )}
      {error ? <Text variant="footnote" color="dangerText" accessibilityLiveRegion="polite">{error}</Text> : null}
      {groups.map((group) => {
        const all = group.options.every((option) => isSelected(group, option));
        return (
          <View key={group.key} style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="subheadStrong">{group.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`${all ? 'Clear' : 'Select all'} ${group.title}`} onPress={() => selectAll(group)} hitSlop={8}>
                <Text variant="footnoteStrong" color="primaryText">{all ? 'Clear' : 'Select all'}</Text>
              </Pressable>
            </View>
            <MultiChips
              label={group.title}
              options={group.options}
              selected={group.options.filter((option) => isSelected(group, option)).map((option) => option.value)}
              onToggle={(value) => {
                const option = group.options.find((item) => item.value === value);
                if (option) toggleOption(group, option);
              }}
            />
          </View>
        );
      })}
      <View style={{ gap: t.spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Experience level">
        <Text variant="subheadStrong">Experience level</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {LEVELS.map((level) => (
            <Chip
              key={level}
              label={SKILL_LEVEL_INFO[level].title}
              selected={state.level === level}
              accessibilityLabel={`Experience level ${SKILL_LEVEL_INFO[level].title}`}
              onPress={() => onState((current) => ({ ...current, level }))}
            />
          ))}
        </View>
        <Text variant="footnote" color="muted">{SKILL_LEVEL_INFO[state.level].description}</Text>
      </View>
    </View>
  );
}
