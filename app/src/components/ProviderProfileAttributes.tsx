import { View } from 'react-native';
import type { ProfileSchema } from '../lib/onboarding';
import { Chip, Text } from './ui';

function labelFor(key: string) {
  return key
    .replaceAll('_', ' ')
    .replace(/^\w/, (character) => character.toUpperCase());
}

export function profileAttributeEntries(schema: ProfileSchema, attributes: Record<string, unknown>) {
  const schemaKeys = Object.keys(schema.properties);
  return Object.entries(attributes)
    .filter(([key]) => schemaKeys.length === 0 || schemaKeys.includes(key))
    .flatMap(([key, value]) => {
      const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
      return values.map((item) => ({
        key: `${key}-${String(item)}`,
        label: `${labelFor(key)}: ${typeof item === 'boolean' ? (item ? 'Yes' : 'No') : String(item).replaceAll('_', ' ')}`,
      }));
    });
}

export function ProviderProfileAttributes({
  schema,
  attributes,
  title = 'Specialities & provider-submitted details',
}: {
  schema: ProfileSchema;
  attributes: Record<string, unknown>;
  title?: string;
}) {
  const entries = profileAttributeEntries(schema, attributes);
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="footnoteStrong" color="muted">
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {entries.map((entry) => <Chip key={entry.key} label={entry.label} selected={false} check={false} />)}
      </View>
    </View>
  );
}
