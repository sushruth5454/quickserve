import { View } from 'react-native';
import { Input } from '../../components/ui';
import { useTheme } from '../../theme';
import type { ProductCategory } from './api';

export function cleanSpecs(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, text]) => [key, text.trim()] as const)
      .filter(([, text]) => text.length > 0),
  );
}

function humanise(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SpecFields({
  schema,
  value,
  onChange,
}: {
  schema: ProductCategory['attribute_schema'];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const t = useTheme();
  const properties = Object.entries(schema.properties ?? {});
  if (!properties.length) return null;

  return (
    <View style={{ gap: t.spacing.sm }}>
      {properties.map(([key, property]) => (
        <Input
          key={key}
          label={humanise(key)}
          maxLength={property.maxLength}
          value={value[key] ?? ''}
          onChangeText={(text) => onChange({ ...value, [key]: text })}
        />
      ))}
    </View>
  );
}
