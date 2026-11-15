import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../components/CategoryIcon';
import { SkillBadge } from '../../components/ProviderCard';
import { Badge, Button, Card, Chip, InlineAlert, Input, Screen, SegmentedControl, Text, useConfirm, useToast } from '../../components/ui';
import { addRateCardItem, deleteService } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { formatINR } from '../../lib/money';
import { onboardingApi, type PriceGuidance } from '../../lib/onboarding';
import { SKILL_LEVEL_INFO } from '../../lib/onboarding/copy';
import { parseRupees, validateFees, validateProfileAttributes } from '../../lib/onboarding/validation';
import type { ProviderService, RateUnit, SkillLevel } from '../../lib/types';
import type { ProfileSchema } from '../../lib/onboarding';
import { useTheme } from '../../theme';
import { FieldLabel, Intro, MultiChips, SectionFooter, type SectionProps } from './parts';

const LEVELS: SkillLevel[] = ['beginner', 'skilled', 'expert', 'certified'];
type Svc = ProviderService & { specialisations?: string[]; brands?: string[]; tools?: string[] };

interface EditorState {
  categoryId: string | null;
  level: SkillLevel;
  visitFee: string;
  labour: string;
  unit: RateUnit;
  specialisations: string[];
  brands: string[];
  tools: string[];
  attributes: Record<string, unknown>;
}

const EMPTY: EditorState = { categoryId: null, level: 'skilled', visitFee: '', labour: '', unit: 'job', specialisations: [], brands: [], tools: [], attributes: {} };

export function ServicesSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const services = data.services as Svc[];
  const active = services.filter((s) => s.active);
  const [ed, setEd] = useState<EditorState>(EMPTY);
  const [editorOpen, setEditorOpen] = useState(active.length === 0);
  const [errors, setErrors] = useState<{ visitFee?: string; labourRate?: string; category?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guidance, setGuidance] = useState<PriceGuidance | null>(null);
  const selected = useSelectedLocation();
  // Before the service-area step the provider has no city yet: fall back to the app's selected location.
  const city = data.state.provider?.city || (selected.location.source !== 'default' ? selected.location.city : '');
  const category = data.categories.find((c) => c.id === ed.categoryId);
  const skillsFor = (kind: 'skill' | 'brand' | 'tool' | 'rate_item') =>
    data.skills.filter((s) => s.category_id === ed.categoryId && s.kind === kind).map((s) => ({ value: kind === 'skill' ? s.slug : s.label, label: s.label }));

  useEffect(() => {
    setGuidance(null);
    if (!ed.categoryId || !city) return;
    let live = true;
    onboardingApi
      .getPriceGuidance(ed.categoryId, city, ed.unit)
      .then((g) => live && setGuidance(g))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ed.categoryId, ed.unit, city]);

  const open = (s?: Svc) => {
    setErrors({});
    setEd(
      s
        ? {
            categoryId: s.category_id,
            level: s.skill_level,
            visitFee: String(s.visit_fee / 100),
            labour: String(s.labour_rate / 100),
            unit: s.rate_unit,
            specialisations: s.specialisations ?? [],
            brands: s.brands ?? [],
            tools: s.tools ?? [],
            attributes: s.attributes ?? {},
          }
        : EMPTY,
    );
    setEditorOpen(true);
  };

  const save = async () => {
    const attrError = category ? validateProfileAttributes((category.profile_schema ?? { type: 'object', properties: {} }) as ProfileSchema, ed.attributes) : null;
    const e = {
      ...validateFees(ed.visitFee, ed.labour),
      ...(ed.categoryId ? {} : { category: 'Pick a service.' }),
      ...(attrError ? { category: attrError } : {}),
    };
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError(null);
    try {
      await onboardingApi.saveService({
        categoryId: ed.categoryId!,
        skillLevel: ed.level,
        visitFee: parseRupees(ed.visitFee)!,
        labourRate: parseRupees(ed.labour)!,
        rateUnit: ed.unit,
        specialisations: ed.specialisations,
        brands: ed.brands,
        tools: ed.tools,
        attributes: ed.attributes,
      });
      await reload();
      setEditorOpen(false);
      setEd(EMPTY);
      toast({ message: `${category?.name ?? 'Service'} saved`, tone: 'success' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (k: 'specialisations' | 'brands' | 'tools', v: string) =>
    setEd((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  const schema = (category?.profile_schema ?? { type: 'object', properties: {} }) as ProfileSchema;
  const attrLabel = (key: string) => key.replaceAll('_', ' ').replace(/^\w/, (x) => x.toUpperCase());
  const dirty = editorOpen && (ed.categoryId != null || ed.labour !== '');

  const continueNext = async () => {
    if (active.length === 0) return setError('Add at least one service to continue.');
    if (mode === 'wizard') await onboardingApi.setStep(2).catch(() => undefined);
    onDone();
  };

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={
        <SectionFooter
          primary={mode === 'wizard' ? 'Continue' : 'Done'}
          onPrimary={() => void continueNext()}
          disabled={active.length === 0 || dirty}
          onBack={onBack}
        />
      }
    >
      <Intro title="Services & skills" subtitle="Add each service you offer. Customers compare your fees and specialisations." />
      <InlineAlert message={error} />

      {services.map((s) => (
        <ServiceCard
          key={s.id}
          service={s}
          skillLabels={data.skills.filter((k) => k.category_id === s.category_id && k.kind === 'skill' && (s.specialisations ?? []).includes(k.slug)).map((k) => k.label)}
          rateSuggestions={data.skills.filter((k) => k.category_id === s.category_id && k.kind === 'rate_item').map((k) => k.label)}
          onEdit={() => open(s)}
          onRemove={async () => {
            const ok = await confirm({ title: `Remove ${s.categories?.name}?`, message: 'Customers will no longer find you for this service.', confirmLabel: 'Remove', destructive: true });
            if (!ok) return;
            await deleteService(s.id).catch((e: Error) => setError(e.message));
            await reload();
          }}
          onChanged={reload}
        />
      ))}

      {editorOpen ? (
        <Card gap={t.spacing.lg} variant="elevated">
          <Text variant="title3">{services.some((s) => s.category_id === ed.categoryId) ? 'Edit service' : 'Add a service'}</Text>
          <View style={{ gap: t.spacing.sm }}>
            <FieldLabel error={errors.category}>Service</FieldLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {data.categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={ed.categoryId === c.id}
                  icon={services.some((s) => s.category_id === c.id && s.active) ? 'checkmark-circle' : undefined}
                  onPress={() => setEd((s) => ({ ...s, categoryId: c.id, specialisations: [], brands: [], tools: [], attributes: {} }))}
                />
              ))}
            </ScrollView>
            {category && (category.requires_docs?.length || category.recommended_docs?.length) ? (
              <Text variant="footnote" color="muted">
                {category.requires_docs?.length
                  ? `Required for ${category.name}: ${docNames(category.requires_docs, data.docTypes)}. Upload under Work & docs.`
                  : `Recommended for ${category.name}: ${docNames(category.recommended_docs ?? [], data.docTypes)} (adds a credential to your profile).`}
              </Text>
            ) : null}
          </View>

          {Object.entries(schema.properties).length ? (
            <View style={{ gap: t.spacing.md }}>
              {Object.entries(schema.properties).map(([key, spec]) => {
                const current = ed.attributes[key];
                if (spec.type === 'array') {
                  const values = spec.enum ?? spec.items?.enum ?? [];
                  return (
                    <View key={key} style={{ gap: t.spacing.sm }}>
                      <FieldLabel hint="These help us match the right customers.">{attrLabel(key)}</FieldLabel>
                      <MultiChips
                        label={attrLabel(key)}
                        options={values.map((value) => ({ value, label: value.replaceAll('_', ' ') }))}
                        selected={Array.isArray(current) ? (current as string[]) : []}
                        onToggle={(value) =>
                          setEd((s) => {
                            const selected = Array.isArray(s.attributes[key]) ? (s.attributes[key] as string[]) : [];
                            return {
                              ...s,
                              attributes: {
                                ...s.attributes,
                                [key]: selected.includes(value) ? selected.filter((x) => x !== value) : [...selected, value],
                              },
                            };
                          })
                        }
                      />
                    </View>
                  );
                }
                if (spec.type === 'string' && spec.enum?.length) {
                  return (
                    <View key={key} style={{ gap: t.spacing.sm }}>
                      <FieldLabel>{attrLabel(key)}</FieldLabel>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                        {spec.enum.map((value) => (
                          <Chip
                            key={value}
                            label={value.replaceAll('_', ' ')}
                            selected={current === value}
                            onPress={() => setEd((s) => ({ ...s, attributes: { ...s.attributes, [key]: value } }))}
                          />
                        ))}
                      </View>
                    </View>
                  );
                }
                return null;
              })}
            </View>
          ) : null}

          <View style={{ gap: t.spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Skill level">
            <FieldLabel>Skill level</FieldLabel>
            {LEVELS.map((l) => {
              const sel = ed.level === l;
              return (
                <Pressable
                  key={l}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: sel }}
                  onPress={() => setEd((s) => ({ ...s, level: l }))}
                  style={{
                    borderWidth: sel ? 1.5 : 1,
                    borderColor: sel ? t.colors.primary : t.colors.border,
                    backgroundColor: sel ? t.colors.primarySoft : t.colors.surface,
                    borderRadius: t.radii.md,
                    padding: t.spacing.md,
                    gap: 2,
                  }}
                >
                  <Text variant="calloutStrong" color={sel ? 'primaryText' : 'text'}>
                    {SKILL_LEVEL_INFO[l].title}
                  </Text>
                  <Text variant="footnote" color="muted">
                    {SKILL_LEVEL_INFO[l].description}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {skillsFor('skill').length ? (
            <View style={{ gap: t.spacing.sm }}>
              <FieldLabel hint="Pick everything you handle.">Specialisations</FieldLabel>
              <MultiChips label="Specialisations" options={skillsFor('skill')} selected={ed.specialisations} onToggle={(v) => toggle('specialisations', v)} />
            </View>
          ) : null}
          {skillsFor('brand').length ? (
            <View style={{ gap: t.spacing.sm }}>
              <FieldLabel hint="Optional">Brands you work on</FieldLabel>
              <MultiChips label="Brands" options={skillsFor('brand')} selected={ed.brands} onToggle={(v) => toggle('brands', v)} />
            </View>
          ) : null}
          {skillsFor('tool').length ? (
            <View style={{ gap: t.spacing.sm }}>
              <FieldLabel hint="Optional">Tools you carry</FieldLabel>
              <MultiChips label="Tools" options={skillsFor('tool')} selected={ed.tools} onToggle={(v) => toggle('tools', v)} />
            </View>
          ) : null}

          <View style={{ gap: t.spacing.sm }}>
            <FieldLabel>Labour charged</FieldLabel>
            <SegmentedControl<RateUnit>
              options={[
                { value: 'job', label: 'Per job' },
                { value: 'hour', label: 'Per hour' },
              ]}
              value={ed.unit}
              onChange={(u) => setEd((s) => ({ ...s, unit: u }))}
              accessibilityLabel="Labour charged per"
            />
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Input
              label="Visit fee"
              prefix="₹"
              keyboardType="decimal-pad"
              value={ed.visitFee}
              onChangeText={(v) => setEd((s) => ({ ...s, visitFee: v.replace(/[^\d.]/g, '') }))}
              error={errors.visitFee}
              helper="Adjusted in the final bill"
              containerStyle={{ flex: 1 }}
            />
            <Input
              label={`Labour / ${ed.unit}`}
              prefix="₹"
              keyboardType="decimal-pad"
              value={ed.labour}
              onChangeText={(v) => setEd((s) => ({ ...s, labour: v.replace(/[^\d.]/g, '') }))}
              error={errors.labourRate}
              containerStyle={{ flex: 1 }}
            />
          </View>
          <PriceGuidanceCard guidance={guidance} city={city} hasCategory={!!ed.categoryId} />

          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            {active.length > 0 ? <Button title="Cancel" variant="outline" onPress={() => { setEditorOpen(false); setEd(EMPTY); }} style={{ flex: 1 }} /> : null}
            <Button title="Save service" leftIcon="checkmark" onPress={() => void save()} loading={saving} style={{ flex: 2 }} />
          </View>
        </Card>
      ) : (
        <Button title={active.length ? 'Add another service' : 'Add a service'} variant="outline" leftIcon="add" onPress={() => open()} />
      )}
    </Screen>
  );
}

function docNames(codes: string[], types: { code: string; label: string }[]): string {
  return codes.map((c) => types.find((x) => x.code === c)?.label ?? c).join(', ');
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
    <View style={{ backgroundColor: t.colors.infoSoft, borderRadius: t.radii.md, padding: t.spacing.md, gap: 4 }}>
      <Text variant="footnoteStrong" color="infoText">
        Local prices in {city || 'your city'}
      </Text>
      <Text variant="footnote" color="textSecondary">
        {body}
      </Text>
    </View>
  );
}

function ServiceCard(props: {
  service: Svc;
  skillLabels: string[];
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
        <Text variant="footnote" color="muted">
          {props.skillLabels.join(' · ')}
        </Text>
      ) : (
        <Text variant="footnote" color="warningText">
          No specialisations yet — tap Edit to add them.
        </Text>
      )}
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
