import type { Dispatch, SetStateAction } from 'react';
import { View } from 'react-native';
import { Button, Card, Text } from '../../../components/ui';
import type { PriceGuidance, ProfileSchema } from '../../../lib/onboarding';
import { SERVICE_EDITOR_COPY } from '../../../lib/onboarding/copy';
import { SERVICE_EDITOR_STEPS, type EditableService, type ServiceEditorErrors, type ServiceEditorState, type ServiceEditorStep } from '../serviceEditor';
import { ProgressBar, type SectionProps } from '../parts';
import { useTheme } from '../../../theme';
import { CategoryStep } from './CategoryStep';
import { CoverageStep } from './CoverageStep';
import { DetailsStep } from './DetailsStep';
import { ExpertiseStep } from './ExpertiseStep';
import { PricingStep } from './PricingStep';
import { ReviewStep } from './ReviewStep';

export function EditorPanel({
  stepIndex,
  step,
  stepCopy,
  state,
  errors,
  data,
  activeCategoryIds,
  editingService,
  schema,
  categoryName,
  radiusKm,
  city,
  guidance,
  saving,
  onState,
  onToggle,
  onSelectCategory,
  onCancel,
  onBack,
  onContinue,
  onSave,
}: {
  stepIndex: number;
  step: ServiceEditorStep;
  stepCopy: (typeof SERVICE_EDITOR_COPY.steps)[number];
  state: ServiceEditorState;
  errors: ServiceEditorErrors;
  data: SectionProps['data'];
  activeCategoryIds: Set<string>;
  editingService?: EditableService;
  schema: ProfileSchema;
  categoryName: string;
  radiusKm: number;
  city: string;
  guidance: PriceGuidance | null;
  saving: boolean;
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
  onToggle: (key: 'specialisations' | 'brands' | 'tools', value: string) => void;
  onSelectCategory: (id: string) => void;
  onCancel: () => void;
  onBack: () => void;
  onContinue: () => void;
  onSave: () => void;
}) {
  const t = useTheme();
  return (
    <Card gap={t.spacing.lg} variant="elevated">
      <View style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="captionStrong" color="primaryText">Step {stepIndex + 1} of {SERVICE_EDITOR_STEPS.length}</Text>
          <Text variant="caption" color="muted">{stepCopy.label}</Text>
        </View>
        <ProgressBar value={(stepIndex + 1) / SERVICE_EDITOR_STEPS.length} />
        <Text variant="title3" accessibilityRole="header">{editingService ? 'Edit service' : stepCopy.title}</Text>
        <Text variant="callout" color="muted">{stepCopy.hint}</Text>
      </View>

      {step === 'category' ? (
        <CategoryStep
          categories={data.categories}
          selectedId={state.categoryId}
          locked={!!state.serviceId}
          activeCategoryIds={activeCategoryIds}
          error={errors.category}
          onSelect={onSelectCategory}
        />
      ) : null}

      {step === 'expertise' ? (
        <ExpertiseStep state={state} schema={schema} skills={data.skills} error={errors.expertise} onState={onState} />
      ) : null}

      {step === 'details' ? (
        <DetailsStep state={state} schema={schema} skills={data.skills} error={errors.attributes} onState={onState} onToggle={onToggle} />
      ) : null}

      {step === 'pricing' ? (
        <PricingStep state={state} city={city} guidance={guidance} errors={errors} onState={onState} />
      ) : null}

      {step === 'coverage' ? (
        <CoverageStep state={state} radiusKm={radiusKm} error={errors.travel} onState={onState} />
      ) : null}

      {step === 'review' ? (
        <ReviewStep
          state={state}
          categoryName={categoryName}
          skills={data.skills}
          schema={schema}
          packageCount={editingService?.service_packages?.length ?? 0}
        />
      ) : null}

      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Button title={stepIndex === 0 ? 'Cancel' : 'Back'} variant="outline" onPress={stepIndex === 0 ? onCancel : onBack} style={{ flex: 1 }} />
        {step === 'review' ? (
          <Button title={state.serviceId ? 'Save changes' : 'Save service'} leftIcon="checkmark" loading={saving} onPress={onSave} style={{ flex: 2 }} />
        ) : (
          <Button title="Next" rightIcon="arrow-forward" onPress={onContinue} style={{ flex: 2 }} />
        )}
      </View>
    </Card>
  );
}
