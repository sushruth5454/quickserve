export interface SchemaField {
  type: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  title?: string;
  description?: string;
  enum?: Array<string | number>;
  properties?: Record<string, SchemaField>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  format?: 'date' | 'date-time';
  items?: Omit<SchemaField, 'properties' | 'required'>;
  'x-private'?: boolean;
}

export interface SchemaIssue {
  path: string;
  message: string;
}

const ROOT_KEYS = new Set(['type', 'properties', 'required', 'title', 'description']);
const FIELD_KEYS = new Set([
  'type', 'title', 'description', 'enum', 'properties', 'required', 'minimum', 'maximum',
  'minLength', 'maxLength', 'format', 'items', 'minItems', 'maxItems', 'uniqueItems', 'x-private',
]);

export function validateSchema(schema: unknown): SchemaIssue[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [{ path: '$', message: 'Schema is unavailable' }];
  const root = schema as Record<string, unknown>;
  if (root.type !== 'object') return [{ path: '$', message: 'Only object-root schemas are supported' }];
  const issues: SchemaIssue[] = [];
  for (const key of Object.keys(root)) if (!ROOT_KEYS.has(key)) issues.push({ path: '$', message: `Unsupported keyword: ${key}` });
  for (const [name, value] of Object.entries((root.properties ?? {}) as Record<string, unknown>)) inspect(name, value, issues);
  const required = Array.isArray(root.required) ? root.required : [];
  const properties = (root.properties ?? {}) as Record<string, unknown>;
  required.forEach((name) => {
    if (typeof name !== 'string' || !(name in properties)) issues.push({ path: '$', message: `Unknown required field: ${String(name)}` });
  });
  return issues;
}

function inspect(path: string, raw: unknown, issues: SchemaIssue[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ path, message: 'Field schema must be an object' });
    return;
  }
  const field = raw as Record<string, unknown>;
  for (const key of Object.keys(field)) if (!FIELD_KEYS.has(key)) issues.push({ path, message: `Unsupported keyword: ${key}` });
  if (!['string', 'integer', 'number', 'boolean', 'array', 'object'].includes(String(field.type))) issues.push({ path, message: 'Unsupported field type' });
  if (field.type === 'array') {
    if (!field.items || typeof field.items !== 'object' || Array.isArray(field.items)) issues.push({ path, message: 'Array field requires scalar items' });
    else inspect(`${path}[]`, field.items, issues);
  }
  if (field.type === 'object') {
    for (const [child, value] of Object.entries((field.properties ?? {}) as Record<string, unknown>)) inspect(`${path}.${child}`, value, issues);
  }
}

export function validateValues(schema: unknown, value: Record<string, unknown>): SchemaIssue[] {
  if (validateSchema(schema).length > 0) return validateSchema(schema);
  const root = schema as SchemaField;
  const issues: SchemaIssue[] = [];
  for (const key of root.required ?? []) {
    if (value[key] == null || value[key] === '' || Array.isArray(value[key]) && value[key].length === 0) issues.push({ path: key, message: 'Required' });
  }
  for (const [key, field] of Object.entries(root.properties ?? {})) {
    const current = value[key];
    if (current == null || current === '') continue;
    if (field.enum && field.type !== 'array' && !field.enum.includes(current as never)) issues.push({ path: key, message: 'Choose one of the allowed values' });
    if (field.type === 'integer' && !Number.isInteger(Number(current))) issues.push({ path: key, message: 'Enter a whole number' });
    if (field.type === 'number' && !Number.isFinite(Number(current))) issues.push({ path: key, message: 'Enter a number' });
    if ((field.type === 'integer' || field.type === 'number') && field.minimum != null && Number(current) < field.minimum) issues.push({ path: key, message: `Minimum is ${field.minimum}` });
    if ((field.type === 'integer' || field.type === 'number') && field.maximum != null && Number(current) > field.maximum) issues.push({ path: key, message: `Maximum is ${field.maximum}` });
    if (field.type === 'string' && field.minLength != null && String(current).length < field.minLength) issues.push({ path: key, message: `Use at least ${field.minLength} characters` });
    if (field.type === 'string' && field.maxLength != null && String(current).length > field.maxLength) issues.push({ path: key, message: `Use at most ${field.maxLength} characters` });
    if (field.type === 'array' && !Array.isArray(current)) issues.push({ path: key, message: 'Choose one or more values' });
    if (field.type === 'array' && Array.isArray(current)) {
      if (field.minItems != null && current.length < field.minItems) issues.push({ path: key, message: `Choose at least ${field.minItems}` });
      if (field.maxItems != null && current.length > field.maxItems) issues.push({ path: key, message: `Choose at most ${field.maxItems}` });
      if (field.uniqueItems && new Set(current).size !== current.length) issues.push({ path: key, message: 'Values must be unique' });
      if (field.items?.enum && current.some((item) => !field.items?.enum?.includes(item as string | number))) issues.push({ path: key, message: 'Contains an unsupported value' });
    }
  }
  return issues;
}
