import { Switch, View } from 'react-native';
import { Chip, EmptyState, Input, Text } from '../../components/ui';
import { useTheme } from '../../theme';
import { titleCase } from './model';
import { type SchemaField, validateSchema } from './schema';

export function SchemaForm({
  schema,
  value,
  onChange,
  blocked = 'This service is temporarily unavailable',
}: {
  schema: unknown;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  blocked?: string;
}) {
  const t = useTheme();
  const issues = validateSchema(schema);
  if (issues.length > 0) return <EmptyState icon="alert-circle-outline" title={blocked} message="Its configuration could not be loaded safely. Please try again later." />;
  const root = schema as SchemaField;
  return (
    <View style={{ gap: t.spacing.lg }}>
      {Object.entries(root.properties ?? {}).map(([name, field]) => (
        <Field
          key={name}
          name={name}
          field={field}
          required={root.required?.includes(name) ?? false}
          value={value[name]}
          onChange={(next) => onChange({ ...value, [name]: next })}
        />
      ))}
    </View>
  );
}

function Field({ name, field, required, value, onChange }: {
  name: string;
  field: SchemaField;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useTheme();
  const label = `${field.title ?? titleCase(name)}${required ? ' *' : ''}`;
  if (field.type === 'object') {
    return (
      <View style={{ gap: t.spacing.md }}>
        <Text variant="subheadStrong">{label}</Text>
        <SchemaForm schema={field} value={(value ?? {}) as Record<string, unknown>} onChange={onChange} />
      </View>
    );
  }
  if (field.type === 'boolean') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheadStrong">{label}</Text>
          {field.description ? <Text variant="footnote" color="muted">{field.description}</Text> : null}
        </View>
        <Switch value={value === true} onValueChange={onChange} trackColor={{ true: t.colors.primary, false: t.colors.outline }} />
      </View>
    );
  }
  if (field.enum || field.type === 'array' && field.items?.enum) {
    const options = (field.enum ?? field.items?.enum ?? []).map(String);
    const selected = field.type === 'array' ? (Array.isArray(value) ? value.map(String) : []) : value == null ? [] : [String(value)];
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="subheadStrong">{label}</Text>
        {field.description ? <Text variant="footnote" color="muted">{field.description}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {options.map((option) => (
            <Chip
              key={option}
              label={titleCase(option)}
              selected={selected.includes(option)}
              onPress={() => {
                if (field.type !== 'array') return onChange(selected.includes(option) ? undefined : option);
                const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
                if (field.maxItems == null || next.length <= field.maxItems) onChange(next);
              }}
            />
          ))}
        </View>
      </View>
    );
  }
  return (
    <Input
      label={label}
      helper={field.description}
      value={value == null ? '' : String(value)}
      onChangeText={(text) => onChange(field.type === 'integer' || field.type === 'number' ? text === '' ? undefined : Number(text) : text)}
      keyboardType={field.type === 'integer' || field.type === 'number' ? 'numeric' : 'default'}
      maxLength={field.maxLength}
      placeholder={field.format === 'date' ? 'YYYY-MM-DD' : field.format === 'date-time' ? 'YYYY-MM-DDTHH:MM' : undefined}
    />
  );
}
