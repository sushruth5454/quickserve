import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type Dispatch, type SetStateAction } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../components/CategoryIcon';
import { SkillBadge } from '../../components/ProviderCard';
import { Badge, Button, Card, Chip, InlineAlert, Input, Screen, SegmentedControl, Text, useConfirm, useToast } from '../../components/ui';
import { addRateCardItem, deleteService } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { formatINR } from '../../lib/money';
import { onboardingApi, type CategorySkill, type PriceGuidance, type ProfileSchema } from '../../lib/onboarding';
import { SERVICE_EDITOR_COPY, SKILL_LEVEL_INFO } from '../../lib/onboarding/copy';
import { parseRupees } from '../../lib/onboarding/validation';
import type { RateUnit, ServicePackage, SkillLevel, TravelFeeMode } from '../../lib/types';
import { useTheme } from '../../theme';
import { FieldLabel, Intro, MultiChips, ProgressBar, SectionFooter, type SectionProps } from './parts';
import { ProviderPackageEditor } from './ProviderPackageEditor';
import {
  attributeExample,
  configuredExpertiseCount,
  configuredFieldIsExpertise,
  EMPTY_SERVICE_EDITOR_STATE,
  expertiseGroups,
  expertiseSelected,
  humanize,
  selectedExpertiseCount,
  serviceExpertiseLabels,
  toggleExpertise,
  type ExpertiseGroup,
  type ExpertiseOption,
  profileFieldOptions,
  selectServiceCategory,
  SERVICE_EDITOR_STEPS,
  serviceEditorStateFromService,
  skillsForCategory,
  type EditableService,
  type ServiceEditorErrors,
  type ServiceEditorState,
  type ServiceEditorStep,
  validateServiceEditor,
  validateServiceEditorStep,
} from './serviceEditor';

const LEVELS: SkillLevel[] = ['beginner', 'skilled', 'expert', 'certified'];

export function ServicesSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const services = data.services as EditableService[];
  const active = services.filter((service) => service.active);
  const removed = services.filter((service) => !service.active);
  const [showRemoved, setShowRemoved] = useState(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const schemaFor = (categoryId: string) =>
    (data.categories.find((item) => item.id === categoryId)?.profile_schema ?? { type: 'object', properties: {} }) as unknown as ProfileSchema;
  const [ed, setEd] = useState<ServiceEditorState>({ ...EMPTY_SERVICE_EDITOR_STATE });
  const [stepIndex, setStepIndex] = useState(0);
  const [editorOpen, setEditorOpen] = useState(active.length === 0);
  const [errors, setErrors] = useState<ServiceEditorErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guidance, setGuidance] = useState<PriceGuidance | null>(null);
  const selected = useSelectedLocation();
  const city = data.state.provider?.city || (selected.location.source !== 'default' ? selected.location.city : '');
  const category = data.categories.find((item) => item.id === ed.categoryId);
  const step = SERVICE_EDITOR_STEPS[stepIndex] ?? SERVICE_EDITOR_STEPS[0];
  const stepCopy = SERVICE_EDITOR_COPY.steps[stepIndex] ?? SERVICE_EDITOR_COPY.steps[0];
  const schema = (category?.profile_schema ?? { type: 'object', properties: {} }) as unknown as ProfileSchema;
  const radiusKm = data.state.provider?.service_radius_km ?? 0;
  const editingService = services.find((service) => service.id === ed.serviceId);

  useEffect(() => {
    setGuidance(null);
    if (!ed.categoryId || !city) return;
    let live = true;
    onboardingApi.getPriceGuidance(ed.categoryId, city, ed.unit).then((value) => live && setGuidance(value)).catch(() => undefined);
    return () => { live = false; };
  }, [ed.categoryId, ed.unit, city]);

  const open = (service?: EditableService) => {
    setEd(serviceEditorStateFromService(service));
    setStepIndex(0);
    setErrors({});
    setError(null);
    setEditorOpen(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const goToStep = (index: number) => {
    setStepIndex(index);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // "My services" rows link here with ?edit=<service id> to open that service in the full editor.
  const { edit: editParam } = useLocalSearchParams<{ edit?: string }>();
  const openedFromRoute = useRef(false);
  useEffect(() => {
    if (!editParam || openedFromRoute.current) return;
    const target = services.find((service) => service.id === editParam);
    if (!target) return;
    openedFromRoute.current = true;
    open(target);
  }, [editParam, services]);

  const close = () => {
    setEditorOpen(false);
    setEd({ ...EMPTY_SERVICE_EDITOR_STATE });
    setStepIndex(0);
    setErrors({});
  };

  const validateStep = (candidate: ServiceEditorStep) => {
    const nextErrors = validateServiceEditorStep(candidate, ed, schema, data.skills, radiusKm);
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const continueStep = () => {
    if (!validateStep(step)) return;
    setErrors({});
    goToStep(Math.min(stepIndex + 1, SERVICE_EDITOR_STEPS.length - 1));
  };

  const firstErrorStep = (validation: ServiceEditorErrors) => {
    if (validation.category) return 0;
    if (validation.expertise) return 1;
    if (validation.attributes) return 2;
    if (validation.visitFee || validation.labourRate) return 3;
    if (validation.travel) return 4;
    return 5;
  };

  const save = async () => {
    const validation = validateServiceEditor(ed, schema, data.skills, radiusKm);
    setErrors(validation);
    if (Object.keys(validation).length) {
      goToStep(firstErrorStep(validation));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onboardingApi.saveService({
        serviceId: ed.serviceId ?? undefined,
        categoryId: ed.categoryId!,
        skillLevel: ed.level,
        visitFee: parseRupees(ed.visitFee)!,
        labourRate: parseRupees(ed.labour)!,
        rateUnit: ed.unit,
        specialisations: ed.specialisations,
        brands: ed.brands,
        tools: ed.tools,
        attributes: ed.attributes,
        maxTravelKm: ed.travelFeeMode === 'none' ? null : Number(ed.maxTravel),
        travelFeeMode: ed.travelFeeMode,
        travelFeeFlat: ed.travelFeeMode === 'flat' ? parseRupees(ed.travelFlat) ?? 0 : 0,
        travelFeePerKm: ed.travelFeeMode === 'per_km' ? parseRupees(ed.travelPerKm) ?? 0 : 0,
      });
      await reload();
      close();
      toast({ message: `${category?.name ?? 'Service'} saved`, tone: 'success' });
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: 'specialisations' | 'brands' | 'tools', value: string) =>
    setEd((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));

  const continueNext = async () => {
    if (editorOpen) return setError('Save or cancel the open service editor first.');
    if (active.length === 0) return setError('Add at least one service to continue.');
    if (mode === 'wizard') await onboardingApi.setStep(2).catch(() => undefined);
    onDone();
  };

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      scrollRef={scrollRef}
      footer={(
        <SectionFooter
          primary={mode === 'wizard' ? 'Continue' : 'Done'}
          onPrimary={() => void continueNext()}
          disabled={active.length === 0 || editorOpen}
          onBack={onBack}
        />
      )}
    >
      <Intro
        title="Services & skills"
        subtitle={editorOpen ? undefined : 'Add each trade you offer, then tick the exact jobs you do. Customers are matched on these.'}
      />
      <InlineAlert message={error} />

      {!editorOpen && active.length ? (
        <Button title="Add another service" variant="outline" leftIcon="add" onPress={() => open()} />
      ) : null}

      {!editorOpen ? active.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          skillLabels={serviceExpertiseLabels(service, data.skills, schemaFor(service.category_id))}
          expertiseAvailable={expertiseGroups(data.skills, service.category_id, schemaFor(service.category_id)).length > 0}
          rateSuggestions={data.skills.filter((skill) => skill.category_id === service.category_id && skill.kind === 'rate_item').map((skill) => skill.label)}
          onEdit={() => open(service)}
          onRemove={async () => {
            const ok = await confirm({ title: `Remove ${service.categories?.name}?`, message: 'Customers will no longer find you for this service.', confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            await deleteService(service.id).catch((removeError: Error) => setError(removeError.message));
            await reload();
          }}
          onChanged={reload}
        />
      )) : null}

      {!editorOpen && removed.length ? (
        <Card gap={t.spacing.sm}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showRemoved }}
            onPress={() => setShowRemoved((value) => !value)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }}
          >
            <Text variant="calloutStrong">Removed services ({removed.length})</Text>
            <Text variant="footnoteStrong" color="primaryText">{showRemoved ? 'Hide' : 'Show'}</Text>
          </Pressable>
          {showRemoved ? removed.map((service) => (
            <View key={service.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 44 }}>
              <CategoryIcon icon={iconForSlug(service.categories?.slug)} size={32} />
              <Text variant="callout" style={{ flex: 1 }}>{service.categories?.name}</Text>
              <Button title="Restore" size="sm" variant="ghost" accessibilityLabel={`Restore ${service.categories?.name}`} onPress={() => open(service)} />
            </View>
          )) : null}
        </Card>
      ) : null}

      {active.length === 0 && !editorOpen ? (
        <Card gap={t.spacing.md} variant="elevated" style={{ alignItems: 'center', paddingVertical: t.spacing.xl }}>
          <CategoryIcon icon={iconForSlug('service')} size={56} />
          <Text variant="title3" accessibilityRole="header">{SERVICE_EDITOR_COPY.emptyTitle}</Text>
          <Text variant="callout" color="muted" style={{ textAlign: 'center' }}>{SERVICE_EDITOR_COPY.emptyBody}</Text>
          <Button title="Add a service" leftIcon="add" onPress={() => open()} />
        </Card>
      ) : null}

      {editorOpen ? (
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
              selectedId={ed.categoryId}
              locked={!!ed.serviceId}
              activeCategoryIds={new Set(active.map((service) => service.category_id))}
              error={errors.category}
              onSelect={(categoryId) => {
                const existing = services.find((service) => service.category_id === categoryId);
                if (!ed.serviceId && existing) {
                  setEd(serviceEditorStateFromService(existing));
                  toast({ message: `${existing.categories?.name ?? 'This service'} is already on your profile — editing it`, tone: 'default' });
                  return;
                }
                setEd((current) => selectServiceCategory(current, categoryId));
              }}
            />
          ) : null}

          {step === 'expertise' ? (
            <ExpertiseStep
              state={ed}
              schema={schema}
              skills={data.skills}
              error={errors.expertise}
              onState={setEd}
              onToggle={toggle}
            />
          ) : null}

          {step === 'details' ? (
            <DetailsStep state={ed} schema={schema} skills={data.skills} error={errors.attributes} onState={setEd} onToggle={toggle} />
          ) : null}

          {step === 'pricing' ? (
            <View style={{ gap: t.spacing.lg }}>
              <SegmentedControl<RateUnit>
                options={[{ value: 'job', label: 'Per job' }, { value: 'hour', label: 'Per hour' }]}
                value={ed.unit}
                onChange={(unit) => setEd((current) => ({ ...current, unit }))}
                accessibilityLabel="Labour rate unit"
              />
              <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                <Input label="Visit fee" prefix="₹" keyboardType="decimal-pad" value={ed.visitFee} onChangeText={(value) => setEd((current) => ({ ...current, visitFee: value.replace(/[^\d.]/g, '') }))} error={errors.visitFee} helper="Credited in the final bill" containerStyle={{ flex: 1 }} accessibilityLabel="Visit fee in rupees" />
                <Input label={`Labour / ${ed.unit}`} prefix="₹" keyboardType="decimal-pad" value={ed.labour} onChangeText={(value) => setEd((current) => ({ ...current, labour: value.replace(/[^\d.]/g, '') }))} error={errors.labourRate} containerStyle={{ flex: 1 }} accessibilityLabel={`Labour rate per ${ed.unit} in rupees`} />
              </View>
              <PriceGuidanceCard guidance={guidance} city={city} hasCategory={!!ed.categoryId} />
              <InlineAlert tone="info" message={SERVICE_EDITOR_COPY.packageHint} />
            </View>
          ) : null}

          {step === 'coverage' ? (
            <CoverageStep state={ed} radiusKm={radiusKm} error={errors.travel} onState={setEd} />
          ) : null}

          {step === 'review' ? (
            <ServiceDraftSummary
              state={ed}
              categoryName={category?.name ?? 'Service'}
              skills={data.skills}
              schema={schema}
              packageCount={editingService?.service_packages?.length ?? 0}
            />
          ) : null}

          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Button title={stepIndex === 0 ? 'Cancel' : 'Back'} variant="outline" onPress={() => stepIndex === 0 ? close() : goToStep(stepIndex - 1)} style={{ flex: 1 }} />
            {step === 'review' ? (
              <Button title={ed.serviceId ? 'Save changes' : 'Save service'} leftIcon="checkmark" loading={saving} onPress={() => void save()} style={{ flex: 2 }} />
            ) : (
              <Button title="Next" rightIcon="arrow-forward" onPress={continueStep} style={{ flex: 2 }} />
            )}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function CategoryStep({ categories, selectedId, locked, activeCategoryIds, error, onSelect }: {
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

function ExpertiseStep({ state, schema, skills, error, onState, onToggle }: {
  state: ServiceEditorState;
  schema: ProfileSchema;
  skills: CategorySkill[];
  error?: string;
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
  onToggle: (key: 'specialisations' | 'brands' | 'tools', value: string) => void;
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

function DetailsStep({ state, schema, skills, error, onState, onToggle }: {
  state: ServiceEditorState;
  schema: ProfileSchema;
  skills: CategorySkill[];
  error?: string;
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
  onToggle: (key: 'specialisations' | 'brands' | 'tools', value: string) => void;
}) {
  const t = useTheme();
  const brandOptions = skillsForCategory(skills, state.categoryId, 'brand');
  const toolOptions = skillsForCategory(skills, state.categoryId, 'tool');
  const remainingFields = Object.entries(schema.properties).filter(([key, field]) => !configuredFieldIsExpertise(key, field));
  const legacyBrands = state.brands.filter((value) => !brandOptions.some((option) => option.value === value));
  const legacyTools = state.tools.filter((value) => !toolOptions.some((option) => option.value === value));
  const legacyAttributes = Object.keys(state.attributes).filter((key) => !(key in schema.properties));
  return (
    <View style={{ gap: t.spacing.lg }}>
      <FieldLabel error={error}>Configured service details</FieldLabel>
      {brandOptions.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <FieldLabel hint="Choose only brands you know and regularly service.">Brands</FieldLabel>
          <MultiChips label="Brands you service" options={brandOptions} selected={state.brands} onToggle={(value) => onToggle('brands', value)} />
        </View>
      ) : null}
      {toolOptions.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <FieldLabel hint="Choose tools you can bring to the job.">Tools</FieldLabel>
          <MultiChips label="Tools you carry" options={toolOptions} selected={state.tools} onToggle={(value) => onToggle('tools', value)} />
        </View>
      ) : null}
      {legacyBrands.length || legacyTools.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert tone="warning" message="These saved selections are no longer in the category configuration. Remove them before saving." />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {legacyBrands.map((value) => <Chip key={`brand-${value}`} label={`${value} · remove`} selected onPress={() => onToggle('brands', value)} />)}
            {legacyTools.map((value) => <Chip key={`tool-${value}`} label={`${value} · remove`} selected onPress={() => onToggle('tools', value)} />)}
          </View>
        </View>
      ) : null}
      {remainingFields.map(([key, field]) => (
        <ProfileField key={key} fieldKey={key} field={field} value={state.attributes[key]} onChange={(value) => onState((current) => {
          const attributes = { ...current.attributes };
          if (value === undefined) delete attributes[key]; else attributes[key] = value;
          return { ...current, attributes };
        })} />
      ))}
      {legacyAttributes.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert tone="warning" message="These saved fields are no longer configured. Remove them before saving; all other fields are preserved." />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {legacyAttributes.map((key) => (
              <Chip
                key={key}
                label={`${humanize(key)} · remove`}
                selected
                onPress={() => onState((current) => {
                  const attributes = { ...current.attributes };
                  delete attributes[key];
                  return { ...current, attributes };
                })}
              />
            ))}
          </View>
        </View>
      ) : null}
      {brandOptions.length === 0 && toolOptions.length === 0 && remainingFields.length === 0 ? (
        <InlineAlert tone="info" message="There are no extra configured fields for this category." />
      ) : null}
      <Text variant="footnote" color="muted">{SERVICE_EDITOR_COPY.safeTextHint}</Text>
    </View>
  );
}

function ProfileField({ fieldKey, field, value, onChange }: {
  fieldKey: string;
  field: ProfileSchema['properties'][string];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useTheme();
  const label = humanize(fieldKey);
  const options = profileFieldOptions(field);
  if (field.type === 'array' && options.length) {
    const selected = Array.isArray(value) ? value as string[] : [];
    return (
      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel hint={attributeExample(fieldKey, field)}>{label}</FieldLabel>
        <MultiChips label={label} options={options.map((item) => ({ value: item, label: humanize(item) }))} selected={selected} onToggle={(item) => onChange(selected.includes(item) ? selected.filter((current) => current !== item) : [...selected, item])} />
      </View>
    );
  }
  if (field.type === 'string' && field.enum?.length) {
    return (
      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel hint={attributeExample(fieldKey, field)}>{label}</FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {field.enum.map((item) => <Chip key={item} label={humanize(item)} selected={value === item} accessibilityLabel={`${label}: ${humanize(item)}`} onPress={() => onChange(value === item ? undefined : item)} />)}
        </View>
      </View>
    );
  }
  if (field.type === 'boolean') {
    return (
      <View style={{ gap: t.spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <FieldLabel>{label}</FieldLabel>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Chip label="Yes" selected={value === true} onPress={() => onChange(true)} />
          <Chip label="No" selected={value === false} onPress={() => onChange(false)} />
        </View>
      </View>
    );
  }
  return (
    <Input
      label={label}
      helper={attributeExample(fieldKey, field)}
      keyboardType={field.type === 'integer' || field.type === 'number' ? 'numeric' : 'default'}
      value={field.type === 'array' ? (Array.isArray(value) ? value : []).join(', ') : value == null ? '' : String(value)}
      onChangeText={(text) => {
        if (field.type === 'integer' || field.type === 'number') {
          const cleaned = text.replace(field.type === 'integer' ? /[^\d-]/g : /[^\d.-]/g, '');
          const numeric = cleaned.trim() === '' ? undefined : Number(cleaned);
          onChange(numeric != null && Number.isFinite(numeric) ? numeric : undefined);
        } else if (field.type === 'array') onChange(text.split(',').map((item) => item.trim()).filter(Boolean));
        else onChange(text || undefined);
      }}
    />
  );
}

function CoverageStep({ state, radiusKm, error, onState }: {
  state: ServiceEditorState;
  radiusKm: number;
  error?: string;
  onState: Dispatch<SetStateAction<ServiceEditorState>>;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="calloutStrong">Travel beyond your normal {radiusKm || 0} km area</Text>
      <SegmentedControl<TravelFeeMode>
        options={[{ value: 'none', label: 'No extra travel' }, { value: 'flat', label: 'Flat fee' }, { value: 'per_km', label: 'Per km' }]}
        value={state.travelFeeMode}
        onChange={(travelFeeMode) => onState((current) => ({ ...current, travelFeeMode }))}
        accessibilityLabel="Travel fee mode"
      />
      {state.travelFeeMode !== 'none' ? (
        <>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Input label="Maximum distance" right={<Text variant="footnote" color="muted">km</Text>} keyboardType="number-pad" value={state.maxTravel} onChangeText={(value) => onState((current) => ({ ...current, maxTravel: value.replace(/[^\d]/g, '') }))} error={error} containerStyle={{ flex: 1 }} accessibilityLabel="Maximum travel distance in kilometres" />
            {state.travelFeeMode === 'flat' ? (
              <Input label="Travel fee" prefix="₹" keyboardType="decimal-pad" value={state.travelFlat} onChangeText={(value) => onState((current) => ({ ...current, travelFlat: value.replace(/[^\d.]/g, '') }))} error={error} containerStyle={{ flex: 1 }} />
            ) : (
              <Input label="Fee beyond normal area" prefix="₹" right={<Text variant="footnote" color="muted">/km</Text>} keyboardType="decimal-pad" value={state.travelPerKm} onChangeText={(value) => onState((current) => ({ ...current, travelPerKm: value.replace(/[^\d.]/g, '') }))} error={error} containerStyle={{ flex: 1 }} />
            )}
          </View>
          <InlineAlert tone="info" message={travelPreview(radiusKm, state.travelFeeMode, state.travelFlat, state.travelPerKm)} />
        </>
      ) : <InlineAlert tone="info" message="Customers outside your normal area will not be shown this service." />}
    </View>
  );
}

function ServiceDraftSummary({ state, categoryName, skills, schema, packageCount }: {
  state: ServiceEditorState;
  categoryName: string;
  skills: CategorySkill[];
  schema: ProfileSchema;
  packageCount: number;
}) {
  const t = useTheme();
  const expertise = serviceExpertiseLabels(
    { category_id: state.categoryId ?? '', specialisations: state.specialisations, attributes: state.attributes } as unknown as EditableService,
    skills,
    schema,
  );
  const travel = state.travelFeeMode === 'none'
    ? 'Normal service area only'
    : `${state.maxTravel} km, ${state.travelFeeMode === 'flat' ? `${formatINR(parseRupees(state.travelFlat) ?? 0)} flat` : `${formatINR(parseRupees(state.travelPerKm) ?? 0)}/km`}`;
  return (
    <Card gap={t.spacing.md} style={{ borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft }} accessibilityLabel="Service summary">
      <Text variant="title3" color="primaryText">{categoryName}</Text>
      <SummaryRow label="Experience" value={SKILL_LEVEL_INFO[state.level].title} />
      <SummaryRow label="Expertise" value={expertise.length ? expertise.join(' · ') : 'Add exact expertise'} />
      {state.brands.length ? <SummaryRow label="Brands" value={state.brands.join(' · ')} /> : null}
      {state.tools.length ? <SummaryRow label="Tools" value={state.tools.join(' · ')} /> : null}
      <SummaryRow label="Pricing" value={`${formatINR(parseRupees(state.visitFee) ?? 0)} visit · ${formatINR(parseRupees(state.labour) ?? 0)}/${state.unit}`} />
      <SummaryRow label="Coverage" value={travel} />
      <SummaryRow label="Packages" value={packageCount ? `${packageCount} package${packageCount === 1 ? '' : 's'} saved` : 'Can be added after saving'} />
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
      <Text variant="footnoteStrong" color="muted" style={{ width: 82 }}>{label}</Text>
      <Text variant="callout" style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}

function travelPreview(radiusKm: number, mode: TravelFeeMode, flat: string, perKm: string): string {
  const amount = mode === 'flat' ? parseRupees(flat) ?? 0 : Math.round(Math.max(15 - radiusKm, 0) * (parseRupees(perKm) ?? 0));
  return `A customer 15 km away pays ${formatINR(amount)} extra. You approve the request before they can book.`;
}

function PriceGuidanceCard({ guidance, city, hasCategory }: { guidance: PriceGuidance | null; city: string; hasCategory: boolean }) {
  const t = useTheme();
  if (!hasCategory) return null;
  let body: string;
  if (!city) body = 'Set your service area to see local prices.';
  else if (!guidance) body = 'Checking local prices…';
  else if (!guidance.visit_fee && !guidance.labour_rate) body = `No local data yet for ${city}. Prices appear once ${guidance.min_points}+ pros or completed jobs exist here.`;
  else {
    const parts: string[] = [];
    if (guidance.visit_fee) parts.push(`Visit fee: typical ${formatINR(guidance.visit_fee.p25)}–${formatINR(guidance.visit_fee.p75)}, median ${formatINR(guidance.visit_fee.median)} (${guidance.visit_fee.n} data points)`);
    if (guidance.labour_rate) parts.push(`Labour: typical ${formatINR(guidance.labour_rate.p25)}–${formatINR(guidance.labour_rate.p75)}, median ${formatINR(guidance.labour_rate.median)} (${guidance.labour_rate.n} pros)`);
    body = parts.join('\n');
  }
  return (
    <View style={{ backgroundColor: t.colors.infoSoft, borderRadius: t.radii.md, padding: t.spacing.md, gap: 4 }} accessibilityLabel={`Local price guidance for ${city || 'your city'}`}>
      <Text variant="footnoteStrong" color="infoText">Local prices in {city || 'your city'}</Text>
      <Text variant="footnote" color="textSecondary">{body}</Text>
    </View>
  );
}
function ServiceCard(props: {
  service: EditableService;
  skillLabels: string[];
  expertiseAvailable: boolean;
  rateSuggestions: string[];
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTheme();
  const { service: s } = props;
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [adding, setAdding] = useState(false);
  const [packageEditing, setPackageEditing] = useState<ServicePackage | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items = s.rate_card_items ?? [];
  const unusedSuggestions = useMemo(() => props.rateSuggestions.filter((r) => !items.some((i) => i.title === r)), [props.rateSuggestions, items]);

  const add = async () => {
    const p = parseRupees(price);
    if (!title.trim() || p == null || p <= 0) return setErr('Enter a name and a price.');
    setBusy(true);
    try {
      await addRateCardItem(s.id, title.trim(), p);
      setTitle('');
      setPrice('');
      setAdding(false);
      setErr(null);
      await props.onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card gap={t.spacing.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View style={{ opacity: s.active ? 1 : 0.5 }}>
          <CategoryIcon icon={iconForSlug(s.categories?.slug)} size={44} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title3">{s.categories?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <SkillBadge level={s.skill_level} />
            {!s.active ? <Badge label="Removed" tone="neutral" /> : null}
          </View>
        </View>
        <Button title="Edit" size="sm" variant="ghost" onPress={props.onEdit} />
      </View>
      <Text variant="footnote" color="textSecondary" tabular>
        Visit {formatINR(s.visit_fee)} · Labour {formatINR(s.labour_rate)}/{s.rate_unit}
      </Text>
      {props.skillLabels.length ? (
        <Text variant="footnote" color="textSecondary" numberOfLines={3} accessibilityLabel={`Expertise: ${props.skillLabels.join(', ')}`}>
          {props.skillLabels.slice(0, 8).join(' · ')}
          {props.skillLabels.length > 8 ? ` · +${props.skillLabels.length - 8} more` : ''}
        </Text>
      ) : props.expertiseAvailable ? (
        <Pressable accessibilityRole="button" onPress={props.onEdit}>
          <Text variant="footnote" color="warningText">
            No expertise selected — customers can’t match you to specific jobs. Tap to add.
          </Text>
        </Pressable>
      ) : null}
      {items.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          <Text variant="callout" style={{ flex: 1 }}>
            {r.title}
          </Text>
          <Text variant="calloutStrong" tabular>
            {formatINR(r.price)}
          </Text>
          <Button
            title="Remove"
            size="sm"
            variant="destructiveGhost"
            accessibilityLabel={`Remove ${r.title}`}
            onPress={() => void onboardingApi.deleteRateCardItem(r.id).then(props.onChanged).catch((e: Error) => setErr(e.message))}
          />
        </View>
      ))}
      <View style={{ gap: t.spacing.md, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="footnoteStrong" color="muted">
            Packages
          </Text>
          {!packageEditing ? (
            <Button title="Add package" size="sm" variant="ghost" leftIcon="add" onPress={() => setPackageEditing('new')} />
          ) : null}
        </View>
        {(s.service_packages ?? []).map((item) => (
          <View key={item.id} style={{ gap: 6, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text variant="calloutStrong" style={{ flex: 1 }}>
                {item.title}
              </Text>
              {!item.active ? <Badge label="Hidden" tone="neutral" /> : null}
              <Button title="Edit" size="sm" variant="ghost" onPress={() => setPackageEditing(item)} />
            </View>
            <Text variant="footnoteStrong" color="primaryText">
              {packagePriceLabel(item)}
            </Text>
            {item.deliverables.length ? (
              <Text variant="footnote" color="textSecondary">
                {item.deliverables.map((deliverable) => `${deliverable.qty} × ${deliverable.type} — ${deliverable.spec}`).join('\n')}
              </Text>
            ) : null}
            <Button
              title="Delete package"
              size="sm"
              variant="destructiveGhost"
              onPress={() =>
                void onboardingApi
                  .deleteServicePackage(item.id)
                  .then(props.onChanged)
                  .then(() => setPackageEditing(null))
                  .catch((e: Error) => setErr(e.message))
              }
            />
          </View>
        ))}
        {packageEditing ? (
          <ProviderPackageEditor
            key={packageEditing === 'new' ? 'new' : packageEditing.id}
            providerServiceId={s.id}
            servicePackage={packageEditing === 'new' ? undefined : packageEditing}
            onCancel={() => setPackageEditing(null)}
            onSaved={async () => {
              setPackageEditing(null);
              await props.onChanged();
            }}
          />
        ) : null}
      </View>
      <InlineAlert message={err} />
      {adding ? (
        <View style={{ gap: t.spacing.sm }}>
          {unusedSuggestions.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {unusedSuggestions.map((r) => (
                <Chip key={r} label={r} selected={title === r} onPress={() => setTitle(r)} />
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Input placeholder="e.g. Gas refill" value={title} onChangeText={setTitle} containerStyle={{ flex: 2 }} accessibilityLabel="Rate card item" maxLength={80} />
            <Input prefix="₹" keyboardType="decimal-pad" value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))} containerStyle={{ flex: 1 }} accessibilityLabel="Price" />
          </View>
          <Button title="Add to rate card" size="sm" onPress={() => void add()} loading={busy} />
        </View>
      ) : s.active ? (
        <Button title="Add rate card item" size="sm" variant="ghost" leftIcon="add" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {s.active ? <Button title="Remove service" size="sm" variant="destructiveGhost" onPress={props.onRemove} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

function packagePriceLabel(servicePackage: ServicePackage) {
  if (servicePackage.price_type === 'quote') return 'Price on request';
  if (servicePackage.price_type === 'range') {
    return `${formatINR(servicePackage.price_min ?? 0)}–${formatINR(servicePackage.price_max ?? 0)} / ${servicePackage.unit}`;
  }
  if (servicePackage.price_type === 'from') return `From ${formatINR(servicePackage.price_min ?? 0)} / ${servicePackage.unit}`;
  return `${formatINR(servicePackage.price ?? servicePackage.price_min ?? 0)} / ${servicePackage.unit}`;
}
