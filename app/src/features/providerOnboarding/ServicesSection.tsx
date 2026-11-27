import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../components/CategoryIcon';
import { Button, Card, InlineAlert, Screen, Text, useConfirm, useToast } from '../../components/ui';
import { deleteService } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { onboardingApi, type ProfileSchema } from '../../lib/onboarding';
import { SERVICE_EDITOR_COPY } from '../../lib/onboarding/copy';
import { parseRupees } from '../../lib/onboarding/validation';
import { useTheme } from '../../theme';
import { Intro, SectionFooter, type SectionProps } from './parts';
import {
  EMPTY_SERVICE_EDITOR_STATE,
  expertiseGroups,
  selectServiceCategory,
  SERVICE_EDITOR_STEPS,
  serviceEditorStateFromService,
  serviceExpertiseLabels,
  type EditableService,
  type ServiceEditorErrors,
  type ServiceEditorState,
  type ServiceEditorStep,
  validateServiceEditor,
  validateServiceEditorStep,
} from './serviceEditor';
import { EditorPanel } from './services/EditorPanel';
import { ServiceCard } from './services/ServiceCard';

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
  const selected = useSelectedLocation();
  const city = data.state.provider?.city || (selected.location.source !== 'default' ? selected.location.city : '');
  const category = data.categories.find((item) => item.id === ed.categoryId);
  const step = SERVICE_EDITOR_STEPS[stepIndex] ?? SERVICE_EDITOR_STEPS[0];
  const stepCopy = SERVICE_EDITOR_COPY.steps[stepIndex] ?? SERVICE_EDITOR_COPY.steps[0];
  const schema = (category?.profile_schema ?? { type: 'object', properties: {} }) as unknown as ProfileSchema;
  const radiusKm = data.state.provider?.service_radius_km ?? 0;
  const editingService = services.find((service) => service.id === ed.serviceId);

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
      await reload({ afterMutation: true });
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

  const selectCategory = (categoryId: string) => {
    const existing = services.find((service) => service.category_id === categoryId);
    if (!ed.serviceId && existing) {
      setEd(serviceEditorStateFromService(existing));
      toast({ message: `${existing.categories?.name ?? 'This service'} is already on your profile — editing it`, tone: 'default' });
      return;
    }
    setEd((current) => selectServiceCategory(current, categoryId));
  };

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
          showLinks={mode !== 'wizard' && data.categories.find((item) => item.id === service.category_id)?.archetype === 'proposal'}
          onEdit={() => open(service)}
          onRemove={async () => {
            const ok = await confirm({ title: `Remove ${service.categories?.name}?`, message: 'Customers will no longer find you for this service.', confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            await deleteService(service.id).catch((removeError: Error) => setError(removeError.message));
            await reload();
          }}
          onChanged={() => reload().then(() => undefined)}
        />
      )) : null}

      {!editorOpen && active.some((service) => data.categories.find((item) => item.id === service.category_id)?.archetype === 'proposal') ? (
        <Card variant="tinted" gap={t.spacing.sm}>
          <Text variant="calloutStrong">Show your work</Text>
          <Text variant="footnote" color="textSecondary">
            {mode === 'wizard'
              ? 'Creators and event pros get more requests with an Instagram, YouTube or website link. You can add them in the "Your work" step.'
              : 'Creators and event pros get more requests with an Instagram, YouTube or website link and a few work photos.'}
          </Text>
          {mode !== 'wizard' ? (
            <Button
              title="Add Instagram, YouTube & website links"
              variant="outline"
              leftIcon="link-outline"
              onPress={() => router.push({ pathname: '/provider-profile/[section]', params: { section: 'portfolio', returnTo: 'services' } })}
            />
          ) : null}
        </Card>
      ) : null}

      {!editorOpen && removed.length ? (
        <Card gap={t.spacing.sm}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Removed services (${removed.length})`}
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
        <EditorPanel
          stepIndex={stepIndex}
          step={step}
          stepCopy={stepCopy}
          state={ed}
          errors={errors}
          data={data}
          activeCategoryIds={new Set(active.map((service) => service.category_id))}
          editingService={editingService}
          schema={schema}
          categoryName={category?.name ?? 'Service'}
          radiusKm={radiusKm}
          city={city}
          guidance={null}
          saving={saving}
          onState={setEd}
          onToggle={toggle}
          onSelectCategory={selectCategory}
          onCancel={close}
          onBack={() => goToStep(stepIndex - 1)}
          onContinue={continueStep}
          onSave={() => void save()}
        />
      ) : null}
    </Screen>
  );
}
