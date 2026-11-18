import type { Dispatch, SetStateAction } from 'react';
import { View } from 'react-native';
import { Chip, InlineAlert, Input, Text } from '../../../components/ui';
import type { CategorySkill, ProfileSchema } from '../../../lib/onboarding';
import { SERVICE_EDITOR_COPY } from '../../../lib/onboarding/copy';
import { useTheme } from '../../../theme';
import { FieldLabel, MultiChips } from '../parts';
import {
  attributeExample,
  configuredFieldIsExpertise,
  humanize,
  profileFieldOptions,
  skillsForCategory,
  type ServiceEditorState,
} from '../serviceEditor';

export function DetailsStep({ state, schema, skills, error, onState, onToggle }: {
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
